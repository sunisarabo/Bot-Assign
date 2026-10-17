# WC/Porter · 07 · Plug-in (C#) — ตัวจัดการ Custom API + กันกติกาชั้น DB

2 ส่วน:
1. **ตัวจัดการ Custom API** (`PorterAck` / `PorterStart` / `PorterEnd`) — logic ของ `wc-06` รันในทรานแซกชันเดียว (กัน race) ด้วยสิทธิ์ SYSTEM
2. **Guard plug-in** บน Update/Create — บังคับกติกา (สถานะไม่ถอยหลัง · รถเข็นเริ่มซ้ำ) กับ **ทุก** ทางเขียน (canvas / Web API / แก้มือ)

> โปรเจกต์: Class Library **.NET Framework 4.6.2** · อ้างอิง NuGet `Microsoft.CrmSdk.CoreAssemblies` · sign assembly (strong name) · register ด้วย **Plug-in Registration Tool**

---

## 0) ปรับชื่อ logical name ให้ตรงของจริงก่อน (สำคัญ)
เปิด Tables → ดู **Logical name** ของตาราง/คอลัมน์/ค่า choice แล้วแก้ค่าคงที่ด้านล่าง
ค่า choice (OptionSet) เป็น **ตัวเลข** — เปิดคอลัมน์ choice ดู value ของแต่ละlabel

```csharp
internal static class N {   // logical names — แก้ให้ตรง environment ของคุณ
  // tables
  public const string Case="pas_wc_case", Trip="pas_wc_trip", Queue="pas_wc_queue",
                      Wheelchair="pas_wheelchair", Staff="pas_wc_staff", CasePorter="pas_wc_caseporter";
  // pas_wc_case
  public const string CaseId="pas_wc_caseid", Status="pas_status", Ack="pas_acknowledged",
    AckAt="pas_ack_at", AckBy="pas_ack_by", AssignedWc="pas_assigned_wc", FlightNo="pas_flightno",
    PickupTime="pas_pickuptime", DeliverTime="pas_delivertime";
  // pas_wc_trip
  public const string TripId="pas_wc_tripid", TripCode="pas_tripid", TripDate="pas_tripdate",
    TStart="pas_starttime", TEnd="pas_endtime", TDur="pas_durationmin", TStatus="pas_tripstatus",
    TWc="pas_wheelchair", TStaff="pas_staff", TCase="pas_case", TFlight="pas_flightcode";
  // pas_wc_queue
  public const string QStaff="pas_staff", QState="pas_state", QTrips="pas_tripstoday", QUpd="pas_updatedat";
  // pas_wheelchair / staff
  public const string WcId="pas_wheelchairid", ControlNo="pas_controlno", ShortNo="pas_shortno", WcActive="pas_isactive";
  public const string StaffId_="pas_wc_staffid", StaffBiz="pas_staffid", Pin="pas_pin", StaffActive="pas_isactive", NickTh="pas_nickth";
  // caseporter
  public const string CpCase="pas_case", CpStaff="pas_staff";
}
internal static class OPT {   // ★ แก้เป็นค่า option จริงของคุณ
  // pas_status
  public const int STANDBY=1, ASSIGNED=2, ON_PROCESS=3, COMPLETED=4, CANCELLED=5;
  // pas_wc_queue.pas_state
  public const int Q_FREE=1, Q_WAIT_ACK=2, Q_SERVING=3;
  // pas_wc_trip.pas_tripstatus
  public const int T_SERVING=1, T_DONE=2, T_STALE=3;
}
```

---

## 1) Helper ร่วม
```csharp
using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

internal static class Wc {
  // โยน error = ส่งโค้ดกลับให้ caller (map เป็นข้อความไทยที่หน้าเพจ)
  public static void Fail(string code) => throw new InvalidPluginExecutionException(code);

  public static string S(IPluginExecutionContext c, string k) =>
    c.InputParameters.Contains(k) ? (c.InputParameters[k] as string)?.Trim() : null;

  // ตรวจตัวตน: StaffId + PIN → คืน EntityReference ของ staff (SYSTEM service)
  public static Entity VerifyStaff(IOrganizationService svc, string staffId, string pin) {
    if (string.IsNullOrEmpty(staffId) || string.IsNullOrEmpty(pin)) Fail("bad_pin");
    var q = new QueryExpression(N.Staff){ ColumnSet=new ColumnSet(N.Pin,N.StaffActive,N.NickTh,N.StaffBiz), TopCount=1 };
    q.Criteria.AddCondition(N.StaffBiz, ConditionOperator.Equal, staffId);
    var s = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
    if (s==null) Fail("bad_pin");
    if (!(s.GetAttributeValue<bool?>(N.StaffActive) ?? false)) Fail("bad_pin");
    if (s.GetAttributeValue<string>(N.Pin) != pin) Fail("bad_pin");
    return s;
  }

  // caseporter ของเคสนี้ต้องเป็นของ staff คนนี้
  public static void AssertOwnsCase(IOrganizationService svc, Guid caseId, Guid staffId) {
    var q = new QueryExpression(N.CasePorter){ ColumnSet=new ColumnSet(false), TopCount=1 };
    q.Criteria.AddCondition(N.CpCase, ConditionOperator.Equal, caseId);
    q.Criteria.AddCondition(N.CpStaff, ConditionOperator.Equal, staffId);
    if (svc.RetrieveMultiple(q).Entities.Count==0) Fail("not_your_case");
  }

  // รถเข็นว่างไหม (ไม่มี trip เปิดที่เริ่มมา < 12 ชม.) — true=ว่าง
  public static bool WcFree(IOrganizationService svc, Guid wcId) {
    var q = new QueryExpression(N.Trip){ ColumnSet=new ColumnSet(N.TStart) };
    q.Criteria.AddCondition(N.TWc, ConditionOperator.Equal, wcId);
    q.Criteria.AddCondition(N.TEnd, ConditionOperator.Null);
    foreach (var t in svc.RetrieveMultiple(q).Entities) {
      var st = t.GetAttributeValue<DateTime?>(N.TStart);
      if (st==null || (DateTime.UtcNow - st.Value).TotalHours < 12) return false;  // ยังใช้อยู่
    }
    return true;
  }

  public static int TripSeqToday(IOrganizationService svc) {
    var today = DateTime.UtcNow.Date;
    var q = new QueryExpression(N.Trip){ ColumnSet=new ColumnSet(false) };
    q.Criteria.AddCondition(N.TripDate, ConditionOperator.On, today);
    return svc.RetrieveMultiple(q).Entities.Count;
  }

  // สร้าง trip + เคส ON_PROCESS + คิว serving (ใช้ทั้ง Ack(LPจอง) และ Start(หยิบเอง))
  public static string StartTrip(IOrganizationService svc, Entity kase, EntityReference wc,
                                 string wcShort, EntityReference staffRef) {
    if (!WcFree(svc, wc.Id)) Fail("wc_in_use");
    var code = "TRP-" + DateTime.UtcNow.ToString("yyyyMMdd") + "-" + (TripSeqToday(svc)+1).ToString("000");
    var trip = new Entity(N.Trip);
    trip[N.TripCode]=code; trip[N.TripDate]=DateTime.UtcNow.Date;
    trip[N.TWc]=wc; trip[N.TStaff]=staffRef; trip[N.TCase]=kase.ToEntityReference();
    trip[N.TFlight]=kase.GetAttributeValue<string>(N.FlightNo);
    trip[N.TStart]=DateTime.UtcNow; trip[N.TStatus]=new OptionSetValue(OPT.T_SERVING);
    svc.Create(trip);

    var cu = new Entity(N.Case, kase.Id);
    cu[N.Status]=new OptionSetValue(OPT.ON_PROCESS);
    if (kase.GetAttributeValue<string>(N.PickupTime)==null) cu[N.PickupTime]=DateTime.UtcNow.ToString("HH:mm");
    svc.Update(cu);

    SetQueue(svc, staffRef.Id, OPT.Q_SERVING, +1);
    return code;
  }

  public static void SetQueue(IOrganizationService svc, Guid staffId, int state, int tripDelta) {
    var q = new QueryExpression(N.Queue){ ColumnSet=new ColumnSet(N.QTrips), TopCount=1 };
    q.Criteria.AddCondition(N.QStaff, ConditionOperator.Equal, staffId);
    var row = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
    if (row==null) return;
    var u = new Entity(N.Queue, row.Id);
    u[N.QState]=new OptionSetValue(state);
    if (tripDelta!=0) u[N.QTrips]=(row.GetAttributeValue<int?>(N.QTrips) ?? 0) + tripDelta;
    u[N.QUpd]=DateTime.UtcNow;
    svc.Update(u);
  }
}
```

---

## 2) `pas_PorterAck` — plug-in handler
```csharp
public class PorterAck : IPlugin {
  public void Execute(IServiceProvider sp) {
    var ctx = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var fac = (IOrganizationServiceFactory)sp.GetService(typeof(IOrganizationServiceFactory));
    var svc = fac.CreateOrganizationService(null);   // ★ null = รันเป็น SYSTEM (สิทธิ์เต็ม)

    var caseId  = Wc.S(ctx,"CaseId");
    var staffId = Wc.S(ctx,"StaffId");
    var pin     = Wc.S(ctx,"Pin");
    if (!Guid.TryParse(caseId, out var cid)) Wc.Fail("not_your_case");

    var staff = Wc.VerifyStaff(svc, staffId, pin);
    Wc.AssertOwnsCase(svc, cid, staff.Id);

    var kase = svc.Retrieve(N.Case, cid, new ColumnSet(N.Status,N.Ack,N.AssignedWc,N.FlightNo,N.PickupTime));
    int st = kase.GetAttributeValue<OptionSetValue>(N.Status)?.Value ?? 0;
    bool ack = kase.GetAttributeValue<bool?>(N.Ack) ?? false;
    if (st==OPT.COMPLETED || st==OPT.CANCELLED || ack) Wc.Fail("already_done_or_ack");

    // บันทึกรับทราบ
    var cu = new Entity(N.Case, cid);
    cu[N.Ack]=true; cu[N.AckAt]=DateTime.UtcNow; cu[N.AckBy]=staffId;
    svc.Update(cu);

    var wcRef = kase.GetAttributeValue<EntityReference>(N.AssignedWc);
    if (wcRef != null) {
      var wc = svc.Retrieve(N.Wheelchair, wcRef.Id, new ColumnSet(N.ShortNo));
      var code = Wc.StartTrip(svc, kase, wcRef, wc.GetAttributeValue<string>(N.ShortNo),
                              new EntityReference(N.Staff, staff.Id));
      Out(ctx, true, "started", code, wc.GetAttributeValue<string>(N.ShortNo), "");
    } else {
      Wc.SetQueue(svc, staff.Id, OPT.Q_WAIT_ACK, 0);   // ยังรอเริ่มเอง
      Out(ctx, true, "ack_only", null, null, "รับทราบแล้ว กดเริ่มงาน + เลือกรถเข็น");
    }
  }
  static void Out(IPluginExecutionContext c, bool ok, string mode, string trip, string wc, string msg){
    c.OutputParameters["Ok"]=ok; c.OutputParameters["Mode"]=mode??"";
    c.OutputParameters["TripId"]=trip??""; c.OutputParameters["Wc"]=wc??""; c.OutputParameters["Message"]=msg??"";
  }
}
```

## 3) `pas_PorterStart` — เริ่มเอง (เลือกรถเข็น)
```csharp
public class PorterStart : IPlugin {
  public void Execute(IServiceProvider sp) {
    var ctx = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var svc = ((IOrganizationServiceFactory)sp.GetService(typeof(IOrganizationServiceFactory))).CreateOrganizationService(null);

    if (!Guid.TryParse(Wc.S(ctx,"CaseId"), out var cid)) Wc.Fail("not_your_case");
    var staff = Wc.VerifyStaff(svc, Wc.S(ctx,"StaffId"), Wc.S(ctx,"Pin"));
    Wc.AssertOwnsCase(svc, cid, staff.Id);

    var kase = svc.Retrieve(N.Case, cid, new ColumnSet(N.Status,N.Ack,N.FlightNo,N.PickupTime));
    if (!(kase.GetAttributeValue<bool?>(N.Ack) ?? false)) Wc.Fail("not_acknowledged");
    int st = kase.GetAttributeValue<OptionSetValue>(N.Status)?.Value ?? 0;
    if (st==OPT.COMPLETED || st==OPT.CANCELLED) Wc.Fail("already_done_or_ack");

    // ยังไม่มี trip เปิดของเคสนี้
    var qc = new QueryExpression(N.Trip){ ColumnSet=new ColumnSet(false), TopCount=1 };
    qc.Criteria.AddCondition(N.TCase, ConditionOperator.Equal, cid);
    qc.Criteria.AddCondition(N.TEnd, ConditionOperator.Null);
    if (svc.RetrieveMultiple(qc).Entities.Count>0) Wc.Fail("already_started");

    // หา wheelchair ตาม ControlNo
    var qw = new QueryExpression(N.Wheelchair){ ColumnSet=new ColumnSet(N.ShortNo), TopCount=1 };
    qw.Criteria.AddCondition(N.ControlNo, ConditionOperator.Equal, Wc.S(ctx,"WheelchairControlNo"));
    qw.Criteria.AddCondition(N.WcActive, ConditionOperator.Equal, true);
    var wc = svc.RetrieveMultiple(qw).Entities.FirstOrDefault();
    if (wc==null) Wc.Fail("bad_wc");

    var code = Wc.StartTrip(svc, kase, wc.ToEntityReference(),
                            wc.GetAttributeValue<string>(N.ShortNo), new EntityReference(N.Staff, staff.Id));
    ctx.OutputParameters["Ok"]=true; ctx.OutputParameters["TripId"]=code;
    ctx.OutputParameters["Wc"]=wc.GetAttributeValue<string>(N.ShortNo); ctx.OutputParameters["Message"]="";
  }
}
```

## 4) `pas_PorterEnd` — จบงาน
```csharp
public class PorterEnd : IPlugin {
  public void Execute(IServiceProvider sp) {
    var ctx = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var svc = ((IOrganizationServiceFactory)sp.GetService(typeof(IOrganizationServiceFactory))).CreateOrganizationService(null);

    if (!Guid.TryParse(Wc.S(ctx,"TripId"), out var tid)) Wc.Fail("not_your_trip");
    var staff = Wc.VerifyStaff(svc, Wc.S(ctx,"StaffId"), Wc.S(ctx,"Pin"));

    var trip = svc.Retrieve(N.Trip, tid, new ColumnSet(N.TStaff,N.TEnd,N.TStart,N.TCase));
    var ts = trip.GetAttributeValue<EntityReference>(N.TStaff);
    if (ts==null || ts.Id != staff.Id) Wc.Fail("not_your_trip");
    if (trip.GetAttributeValue<DateTime?>(N.TEnd) != null) Wc.Fail("already_ended");

    var start = trip.GetAttributeValue<DateTime?>(N.TStart) ?? DateTime.UtcNow;
    int dur = (int)(DateTime.UtcNow - start).TotalMinutes;

    var tu = new Entity(N.Trip, tid);
    tu[N.TEnd]=DateTime.UtcNow; tu[N.TDur]=dur; tu[N.TStatus]=new OptionSetValue(OPT.T_DONE);
    svc.Update(tu);

    var caseRef = trip.GetAttributeValue<EntityReference>(N.TCase);
    if (caseRef!=null) {
      var cu = new Entity(N.Case, caseRef.Id);
      cu[N.Status]=new OptionSetValue(OPT.COMPLETED); cu[N.DeliverTime]=DateTime.UtcNow.ToString("HH:mm");
      svc.Update(cu);
    }
    Wc.SetQueue(svc, staff.Id, OPT.Q_FREE, 0);
    ctx.OutputParameters["Ok"]=true; ctx.OutputParameters["DurationMin"]=dur; ctx.OutputParameters["Message"]="";
  }
}
```

---

## 5) Guard plug-in — กันกติกาชั้น DB (ทุกทางเขียน)
รันแม้มาจาก canvas/Web API/แก้มือ → กติกาแน่นสุด

```csharp
// register: Message=Update · Table=pas_wc_case · Stage=Pre-operation · ต้องมี Pre-Image "pre" (pas_status)
public class CaseNoRollback : IPlugin {
  public void Execute(IServiceProvider sp) {
    var ctx = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var tgt = (Entity)ctx.InputParameters["Target"];
    if (!tgt.Contains(N.Status)) return;                      // ไม่ได้แก้สถานะ → ข้าม
    if (!ctx.PreEntityImages.Contains("pre")) return;
    int now = ctx.PreEntityImages["pre"].GetAttributeValue<OptionSetValue>(N.Status)?.Value ?? 0;
    int next = tgt.GetAttributeValue<OptionSetValue>(N.Status)?.Value ?? 0;
    if ((now==OPT.COMPLETED || now==OPT.CANCELLED) && next!=now)
      throw new InvalidPluginExecutionException("สถานะเคสจบ/ยกเลิกแล้ว เปลี่ยนไม่ได้");
    // กันถอยหลัง ON_PROCESS → STANDBY/ASSIGNED
    if (now==OPT.ON_PROCESS && (next==OPT.STANDBY || next==OPT.ASSIGNED))
      throw new InvalidPluginExecutionException("สถานะถอยหลังไม่ได้");
  }
}

// register: Message=Create · Table=pas_wc_trip · Stage=Pre-operation (ในทรานแซกชัน)
public class TripNoDoubleWc : IPlugin {
  public void Execute(IServiceProvider sp) {
    var ctx = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var svc = ((IOrganizationServiceFactory)sp.GetService(typeof(IOrganizationServiceFactory))).CreateOrganizationService(null);
    var tgt = (Entity)ctx.InputParameters["Target"];
    var wc = tgt.GetAttributeValue<EntityReference>(N.TWc);
    if (wc==null) return;
    if (tgt.GetAttributeValue<DateTime?>(N.TEnd)!=null) return;  // สร้างพร้อมจบ (import) ข้าม
    if (!Wc.WcFree(svc, wc.Id))
      throw new InvalidPluginExecutionException("wc_in_use");    // รถเข็นมี trip เปิด <12 ชม. อยู่แล้ว
  }
}
```

> Pre-operation ของ Create: แถวใหม่ยังไม่ commit → `WcFree` นับเฉพาะ trip เดิม → ถ้ามีเปิดอยู่ = บล็อก ✅

---

## 6) Register (Plug-in Registration Tool)
1. **Register New Assembly** → เลือก DLL (sandbox/isolation = **Sandbox**)
2. ผูก **Custom API** (`wc-06` ข้อ 1) เข้ากับ plugin type: ที่แถว Custom API ตั้ง **Plugin Type** = `PorterAck`/`PorterStart`/`PorterEnd`
   > Custom API เรียก plug-in ของมันเองตอน execute — ไม่ต้อง add step แยกสำหรับ 3 ตัวนี้
3. **Register New Step** สำหรับ guard:
   - `CaseNoRollback`: Message `Update`, Primary Entity `pas_wc_case`, **Pre-operation**, + **Register New Image** (Pre Image, alias `pre`, attribute `pas_status`)
   - `TripNoDoubleWc`: Message `Create`, Primary Entity `pas_wc_trip`, **Pre-operation**

## 7) Race / concurrency (รถเข็นเริ่มซ้ำพร้อมกัน)
- guard `TripNoDoubleWc` ปิดช่องเกือบหมด แต่ 2 create พร้อมกันจริง ๆ ยังหลุดได้ (ไม่มี lock)
- ปิดสนิท: เพิ่ม **Alternate Key** บน `pas_wc_trip` = (`pas_wheelchair` + `pas_tripdate` + `pas_flightcode`) → create ซ้ำคีย์เดียวกันจะ error ทันที (กัน dup เคส/วันเดียวกัน)
- หรือทำ step เป็น **Pre-validation + lock row** ของ wheelchair (Update dummy field ของ wheelchair ก่อน query) เพื่อ serialize — ใช้เมื่อ critical จริง

## 8) ทดสอบ
- เรียก action ผ่าน **Plug-in Registration Tool → (ไม่มี) / หรือ Postman** กับ Dataverse Web API `POST /api/data/v9.2/pas_PorterAck` body `{ "CaseId":"...","StaffId":"P076","Pin":"1234" }`
- เคส PIN ผิด → ต้องได้ error `bad_pin` · เคสจบแล้ว ack ซ้ำ → `already_done_or_ack` · รถเข็นไม่ว่าง → `wc_in_use`
- เทสต์ guard: ลองแก้ `pas_status` ของเคส COMPLETED กลับเป็น STANDBY จาก canvas → ต้องถูกบล็อก
