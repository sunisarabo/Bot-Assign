# WC/Porter · 03 · หน้าพอตเตอร์ (ไม่ล็อกอิน) + แจ้งเตือน — Power Fx

> 📱 หน้านี้ = แบบ **canvas/จอรวม** (เครื่องคีออสก์ล็อกอินบัญชีเดียว) · ถ้าพอตเตอร์เปิดจาก **มือถือส่วนตัว (ไม่มีบัญชี)** ให้ใช้ **`wc-04-porter-powerpages.md`** (Power Pages anonymous · Dataverse ชุดเดียวกัน) แทน

พอตเตอร์ ~76 คน **ไม่มีบัญชี M365** → เลือกตัวตนจากรายชื่อ (ไม่ล็อกอิน) บนแอป/จอรวม
เห็นเคสของตัวเอง · เด้งแจ้งเตือนเคสใหม่ · กด **รับเคส → เริ่มงาน → จบงาน** · บังคับกติกาจริง

> ตาราง: `pas_wc_staffs` · `pas_wc_cases` · `pas_wc_caseporters` · `pas_wc_trips` · `pas_wheelchairs`

## 1) เลือกตัวตน (ไม่ล็อกอิน)
```powerapps
// หน้าแรก/แถบบน: ค้นชื่อ-รหัส แล้วเลือก
ddMe.Items = SortByColumns(Filter(pas_wc_staffs, IsActive = true), "NickTh")
btnMe.OnSelect = Set(varMe, ddMe.Selected); Set(varPorterReady, true)
// ปุ่ม "เปลี่ยนคน": Set(varPorterReady, false)
lblWho.Text = "พอตเตอร์: " & varMe.NickTh & " (" & varMe.StaffId & ")"
```
> จอรวมหน้างาน = คนกดเลือกชื่อตัวเองก่อนรับงาน · เครื่องส่วนตัวตั้งครั้งเดียว

## 2) แจ้งเตือนเคสใหม่ (In-app live — Timer)
```powerapps
// tmrPoll: Duration=15000 · Repeat=true · AutoStart=varPorterReady
tmrPoll.OnTimerEnd = |-
  =ClearCollect(colMine,
    AddColumns(
      Filter(pas_wc_caseporters, Staff.StaffId = varMe.StaffId,
             DateValue(AssignedAt) = Today()),
      "case", LookUp(pas_wc_cases, CaseId = Case.CaseId)));
  ClearCollect(colMineOpen, Filter(colMine, case.Status.Value in ["STANDBY","ON_PROCESS"]));
  If(CountRows(Filter(colMineOpen, case.pas_acknowledged <> true)) > varPrevN,
     Notify("🔔 มีเคสใหม่ให้รับ — ไปที่เกท " & First(colMineOpen).case.Gate, NotificationType.Information, 10000);
     Set(varPlaySound, true));
  Set(varPrevN, CountRows(Filter(colMineOpen, case.pas_acknowledged <> true)))
// audAlert.Start = varPlaySound · OnEnd = Set(varPlaySound,false)
```
> + **LINE แจ้งเข้ากลุ่มทีม** (เผื่อไม่ได้เปิดแอป) ทำที่ฝั่ง flow — ดู `18-notify-steps.md` ส่วนที่ 2

## 3) เคสของฉัน (galMine) + รับเคส/เริ่ม/จบ
```powerapps
galMine.Items = SortByColumns(colMineOpen, "case.NotifiedTime")
// แถว: flight · service · gate · สถานะ · แบนเนอร์ "ยังไม่รับทราบ"
lblMineBanner.Visible = ThisItem.case.pas_acknowledged <> true

// (ก) รับเคส = Acknowledge (บังคับก่อนเริ่ม)
//     - เคสที่ LP จ่าย (มี pas_assigned_wc) → รับทราบแล้ว "เริ่มงานเลย" ด้วยรถเข็นที่ LP จองไว้
//     - เคสที่พอตเตอร์หยิบเอง (ไม่มี pas_assigned_wc) → รับทราบอย่างเดียว แล้วไปกด เริ่มงาน (ข) เลือกรถเข็นเอง
btnAck.Visible  = ThisItem.case.pas_acknowledged <> true
btnAck.OnSelect = |-
  =With({ c: ThisItem.case, w: LookUp(pas_wheelchairs, ControlNo = ThisItem.case.pas_assigned_wc) },
    // บันทึกรับทราบก่อนเสมอ
    Patch(pas_wc_cases, c, { pas_acknowledged: true, pas_ack_at: Now(), pas_ack_by: varMe.StaffId });
    If(IsBlank(c.pas_assigned_wc),
       // เคสหยิบเอง: แค่รับทราบ
       Notify("รับทราบเคส " & c.FlightNo & " — กดเริ่มงาน + เลือกรถเข็น", NotificationType.Success),
       // เคส LP จ่าย: รับทราบ = เริ่มงานเลย (ถ้ารถเข็นที่จองยังว่าง)
       !IsBlank(LookUp(pas_wc_trips, Wheelchair.ControlNo = w.ControlNo, IsBlank(EndTime) && DateDiff(StartTime, Now(), TimeUnit.Hours) < 12)),
           Notify("รถเข็น " & w.ShortNo & " ถูกใช้แล้ว — แจ้ง LP เปลี่ยนรถเข็น", NotificationType.Error),
       // ล็อกรถเข็น + เริ่ม trip + เคส ON_PROCESS + คิวนับงาน
       Patch(pas_wc_trips, Defaults(pas_wc_trips),
         { TripId: "TRP-" & Text(Now(),"yyyymmdd") & "-" & Text(CountRows(Filter(pas_wc_trips, TripDate=Today()))+1,"000"),
           TripDate: Today(), Wheelchair: w, Staff: varMe, FlightCode: c.FlightNo,
           StartTime: Now(), TripStatus: { Value: "กำลังบริการ" }, Case: c });
       Patch(pas_wc_cases, c, { Status: { Value: "ON_PROCESS" }, PickupTime: Coalesce(c.PickupTime, Text(Now(),"hh:mm")) });
       Patch(pas_wc_queues, LookUp(pas_wc_queues, Staff.StaffId = varMe.StaffId),
         { State: { Value: "กำลังบริการ" }, TripsToday: Coalesce(LookUp(pas_wc_queues, Staff.StaffId = varMe.StaffId).TripsToday,0)+1, UpdatedAt: Now() });
       Notify("รับทราบ + เริ่มงาน " & c.FlightNo & " · รถเข็น " & w.ShortNo, NotificationType.Success)));
   Select(tmrPoll)

// (ข) เริ่มงาน — เฉพาะเคส "หยิบเอง" (ไม่มี pas_assigned_wc) + ต้องรับทราบก่อน + เลือกรถเข็นว่าง
//     เคส LP จ่าย เริ่มไปแล้วตั้งแต่กดรับทราบ (ก) → ปุ่มนี้ซ่อน
btnStart.Visible = IsBlank(ThisItem.case.pas_assigned_wc)
btnStart.DisplayMode = If(ThisItem.case.pas_acknowledged = true &&
     IsBlank(LookUp(pas_wc_trips, Case.CaseId = ThisItem.case.CaseId, IsBlank(EndTime))),
     DisplayMode.Edit, DisplayMode.Disabled)
btnStart.OnSelect = |-
  =With({ c: ThisItem.case, w: ddWCFree.Selected },
    If(IsBlank(w), Notify("เลือกรถเข็น", NotificationType.Warning),
       !IsBlank(LookUp(pas_wc_trips, Wheelchair.ControlNo = w.ControlNo, IsBlank(EndTime) && DateDiff(StartTime, Now(), TimeUnit.Hours) < 12)),
           Notify("รถเข็น " & w.ShortNo & " กำลังใช้งาน", NotificationType.Error),
       Patch(pas_wc_trips, Defaults(pas_wc_trips),
         { TripId: "TRP-" & Text(Now(),"yyyymmdd") & "-" & Text(CountRows(Filter(pas_wc_trips, TripDate=Today()))+1,"000"),
           TripDate: Today(), Wheelchair: w, Staff: varMe, FlightCode: c.FlightNo,
           StartTime: Now(), TripStatus: { Value: "กำลังบริการ" }, Case: c });
       Patch(pas_wc_cases, c, { Status: { Value: "ON_PROCESS" }, PickupTime: Coalesce(c.PickupTime, Text(Now(),"hh:mm")) });
       Notify("เริ่มงาน " & c.FlightNo & " · รถเข็น " & w.ShortNo, NotificationType.Success); Select(tmrPoll)))

// รถเข็นว่าง (ddWCFree)
ddWCFree.Items = Filter(pas_wheelchairs, IsActive = true,
  IsBlank(LookUp(pas_wc_trips, Wheelchair.ControlNo = ControlNo, IsBlank(EndTime) && DateDiff(StartTime, Now(), TimeUnit.Hours) < 12)))
```

## 4) งานที่กำลังทำของฉัน → จบงาน
```powerapps
galMyTrip.Items = Filter(pas_wc_trips, Staff.StaffId = varMe.StaffId, TripDate = Today(), IsBlank(EndTime))
btnMyEnd.OnSelect = |-
  =With({ t: ThisItem },
    Patch(pas_wc_trips, t,
      { EndTime: Now(), DurationMin: DateDiff(t.StartTime, Now(), TimeUnit.Minutes), TripStatus: { Value: "เสร็จสิ้น" } });
    Patch(pas_wc_cases, LookUp(pas_wc_cases, CaseId = t.Case.CaseId),
      { Status: { Value: "COMPLETED" }, DeliverTime: Text(Now(),"hh:mm") });
    Notify("จบงาน · " & DateDiff(t.StartTime, Now(), TimeUnit.Minutes) & " นาที", NotificationType.Success); Select(tmrPoll))
```

## กติกาที่บังคับ (ฝั่งพอตเตอร์)
| กติกา | ทำที่ |
|---|---|
| เริ่มได้เฉพาะเคสตัวเอง | galMine = caseporter ของ varMe เท่านั้น |
| ต้องรับทราบก่อนเริ่ม (ทั้ง LP จ่าย + หยิบเอง) | `btnAck` บังคับก่อน · เคส LP จ่าย: รับทราบ = เริ่มเลย · เคสหยิบเอง: `btnStart` เช็ก `pas_acknowledged` |
| รถเข็นใช้อยู่ เริ่มซ้ำไม่ได้ | เช็ก active trip ก่อน Patch + ddWCFree กรองแล้ว |
| ไม่เขียนทับเวลาที่กรอก | `Coalesce(c.PickupTime, …)` |
| ปิดงานค้างได้เฉพาะ LP | พอตเตอร์ไม่มีปุ่มปิดค้าง (อยู่ wc-02) |

## ⚠️ สำคัญ: กติกาต้องอยู่ "หลังบ้าน" ด้วย
พอตเตอร์เป็นแอป**แยก**ที่เขียนตารางเดียวกับ LP → ซ่อนปุ่มในจออย่างเดียว**ไม่พอ**
กติกา 1-6 (ห้ามเปลี่ยนคนเคสที่ส่งแล้ว · รถเข็นเริ่มซ้ำ · สถานะไม่ถอยหลัง ฯลฯ) ต้องทำเป็น
**plug-in / Power Automate / business rule** บน Dataverse ด้วย (ดู `wc-04-porter-powerpages.md` ข้อ 4 — กติกาหลังบ้าน ใช้ร่วมกันทั้ง canvas + Power Pages)
