# WC/Porter · 02 · หน้า LP จ่ายงาน / คิว — Power Fx

LP เห็น **คิวพอตเตอร์** (เรียงเคสน้อยสุดก่อน) + **เคสรอจ่าย** → จ่ายงาน (ล็อกรถเข็น + เริ่ม trip) → จบงาน
บังคับกติกาจริง: เคสน้อยสุดขึ้นก่อน (ไม่ใช่ FIFO) · รถเข็นใช้อยู่เริ่มซ้ำไม่ได้ · งานค้าง >12 ชม. ไม่นับ · สถานะไม่ถอยหลัง

> ตาราง: `pas_wc_cases` · `pas_wc_queues` · `pas_wc_trips` · `pas_wheelchairs` · `pas_wc_staffs` · `pas_wc_caseporters`

## 1) โหลดข้อมูลวันนี้ (OnVisible / btnWLoad)
```powerapps
Set(varWDate, Today());
Concurrent(
  ClearCollect(colCases, Filter(pas_wc_cases, CaseDate = varWDate)),
  ClearCollect(colQ, Filter(pas_wc_queues, QueueDate = varWDate)),
  ClearCollect(colTripAct, Filter(pas_wc_trips, TripDate = varWDate, IsBlank(EndTime))),
  ClearCollect(colWC, Filter(pas_wheelchairs, IsActive = true))
);
// คิวเรียง "เคสน้อยสุดก่อน" แยกตามกะ (ไม่ใช่ FIFO)
ClearCollect(colQueue, SortByColumns(colQ, "TripsToday", SortOrder.Ascending, "SortOrder", SortOrder.Ascending));
// รถเข็นว่าง = ไม่อยู่ใน trip ที่ยังไม่จบและเริ่มมา < 12 ชม.
ClearCollect(colWCFree,
  Filter(colWC, IsBlank(LookUp(colTripAct, Wheelchair.ControlNo = ControlNo && DateDiff(StartTime, Now(), TimeUnit.Hours) < 12))));
Set(varNextP, First(Filter(colQueue, State.Value = "ว่าง")))     // คนถัดไปที่ควรได้งาน
```

## 2) คิวพอตเตอร์ (galQueue)
```powerapps
galQueue.Items = colQueue
// ในแถว: nick + สถานะ + เคสวันนี้
lblQName.Text  = ThisItem.Staff.NickTh
lblQState.Text = ThisItem.State.Value & " · เคสวันนี้ " & Coalesce(ThisItem.TripsToday, 0)
// ไฮไลต์คนถัดไป
galQueue.TemplateFill = If(ThisItem.Staff.StaffId = varNextP.Staff.StaffId, RGBA(226,239,218,1), White)
```

## 3) เคสรอจ่าย (galCases) → จ่ายงาน
```powerapps
galCases.Items = SortByColumns(Filter(colCases, Status.Value = "STANDBY"), "NotifiedTime")
// เลือกรถเข็น: ddWC.Items = colWCFree (แสดง ShortNo + Type)
// ปุ่มจ่ายงาน (ให้ "คนถัดไป" หรือเลือกเองจาก ddPorter.Items = Filter(colQueue, State.Value="ว่าง"))
btnAssign.OnSelect = |-
  =With({ c: galCases.Selected,
          p: Coalesce(ddPorter.Selected, varNextP),
          w: ddWC.Selected },
    If(IsBlank(p) || IsBlank(w), Notify("เลือกพอตเตอร์ + รถเข็น", NotificationType.Warning),
       c.Status.Value in ["COMPLETED","CANCELLED"], Notify("เคสจบ/ยกเลิกแล้ว", NotificationType.Error),
       !IsBlank(LookUp(colTripAct, Wheelchair.ControlNo = w.ControlNo)),
           Notify("รถเข็น " & w.ShortNo & " กำลังใช้งาน เริ่มซ้ำไม่ได้", NotificationType.Error),
       // (1) ผูกคน-เคส
       Patch(pas_wc_caseporters, Defaults(pas_wc_caseporters),
         { Case: c, Staff: p.Staff, AssignedAt: Now(), AssignedBy: User().Email });
       // (2) เริ่ม trip (ล็อกรถเข็น)
       Patch(pas_wc_trips, Defaults(pas_wc_trips),
         { TripId: "TRP-" & Text(Now(),"yyyymmdd") & "-" & Text(CountRows(Filter(pas_wc_trips, TripDate=varWDate))+1, "000"),
           TripDate: varWDate, Wheelchair: w, Staff: p.Staff, FlightCode: c.FlightNo,
           StartTime: Now(), TripStatus: { Value: "กำลังบริการ" }, Case: c });
       // (3) เคส → ON_PROCESS + เวลารับ (ไม่ทับถ้ามีแล้ว)
       Patch(pas_wc_cases, c, { Status: { Value: "ON_PROCESS" },
           PickupTime: Coalesce(c.PickupTime, Text(Now(),"hh:mm")) });
       // (4) คิว: คนนั้นไม่ว่าง + เคส+1 + ดัน SortOrder ท้ายสุด
       Patch(pas_wc_queues, LookUp(colQ, Staff.StaffId = p.Staff.StaffId),
         { State: { Value: "กำลังบริการ" }, TripsToday: Coalesce(p.TripsToday,0)+1,
           SortOrder: Max(colQ, SortOrder) + 1, UpdatedAt: Now() });
       Notify("จ่ายงานเคส " & c.FlightNo & " → " & p.Staff.NickTh & " (" & w.ShortNo & ")", NotificationType.Success);
       Select(btnWLoad)))
```

## 4) จบงาน (galActive — trip ที่กำลังบริการ)
```powerapps
galActive.Items = colTripAct
btnEnd.OnSelect = |-
  =With({ t: galActive.Selected },
    Patch(pas_wc_trips, t,
      { EndTime: Now(), DurationMin: DateDiff(t.StartTime, Now(), TimeUnit.Minutes),
        TripStatus: { Value: "เสร็จสิ้น" } });
    Patch(pas_wc_cases, LookUp(colCases, CaseId = t.Case.CaseId),
      { Status: { Value: "COMPLETED" }, DeliverTime: Text(Now(),"hh:mm") });
    Patch(pas_wc_queues, LookUp(colQ, Staff.StaffId = t.Staff.StaffId),
      { State: { Value: "ว่าง" }, UpdatedAt: Now() });   // รถเข็นปลดล็อกเพราะ EndTime มีค่าแล้ว
    Notify("จบงาน · ใช้เวลา " & DateDiff(t.StartTime, Now(), TimeUnit.Minutes) & " นาที", NotificationType.Success);
    Select(btnWLoad))
```

## 5) ปิดงานค้าง >12 ชม. (LP เท่านั้น · ไม่เดาเวลาจบ)
```powerapps
btnStale.Visible  = varPrivLP        // LP/ซุป เท่านั้น
btnStale.OnSelect =
  ForAll(Filter(colTripAct, DateDiff(StartTime, Now(), TimeUnit.Hours) >= 12) As t,
    Patch(pas_wc_trips, t, { TripStatus: { Value: "ค้าง — ไม่ได้กดจบ" } }));  // EndTime ปล่อยว่าง (ไม่แต่งตัวเลข)
  Notify("ปิดงานค้างแล้ว · รถเข็นปลดล็อก", NotificationType.Information); Select(btnWLoad)
```
> หลังปิด งานค้าง: `colWCFree` จะรวมรถเข็นคืน เพราะ filter ใช้ `DateDiff < 12` อยู่แล้ว (รถเข็นที่ค้าง >12 ชม. ถือว่าว่าง)

## กติกาที่บังคับในหน้านี้
| กติกา | ทำที่ |
|---|---|
| เคสน้อยสุดขึ้นก่อน (ไม่ FIFO) | `colQueue` sort TripsToday↑ |
| รถเข็นใช้อยู่ เริ่มซ้ำไม่ได้ + บอกใครใช้ | เช็ก `colTripAct` ก่อน Patch |
| งานค้าง >12 ชม. ไม่นับว่าทำ + ปิดได้ | `colWCFree` filter <12h · ปุ่มปิดค้าง |
| สถานะไม่ถอยหลัง | เช็ก `Status.Value in [COMPLETED,CANCELLED]` ก่อนจ่าย |
| ไม่เขียนทับเวลาที่กรอกแล้ว | `Coalesce(c.PickupTime, …)` |
| LP ปิดค้างได้ พอตเตอร์ไม่ได้ | `btnStale.Visible = varPrivLP` |

> งาน "เพิ่มคนช่วย" (เคสเดียวหลายคน) = เพิ่มแถว `pas_wc_caseporter` ได้ แต่ **ถอดคนที่ทำอยู่ไม่ได้** (ปุ่มลบปิดถ้า trip เริ่มแล้ว)
> ฝั่งพอตเตอร์กด "รับเคส/เริ่ม/จบ" เอง (ไม่ล็อกอิน) → หน้า `wc-03` + แจ้งเตือน `18`
