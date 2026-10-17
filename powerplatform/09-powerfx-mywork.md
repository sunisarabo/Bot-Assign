# 09 · งานของฉัน — Power Fx (ดูย้อนหลังได้ · ล่วงหน้าแค่วันนี้+1)

หน้า **"งานของฉัน"** บน Power Apps — พนักงานใส่รหัสดูงานตัวเอง/ทีม
กฎสิทธิ์ (ตาม `07-access-roles.md`): **ย้อนหลังได้ทุกวัน · ล่วงหน้าได้แค่ วันนี้+1**

> ใช้ตาราง Dataverse จริงของโปรเจกต์ (ดู `tables.def.json` / `01` / `02`):
> - **`pas_duties`** — `pas_work_date` · รหัส = lookup `pas_employee.pas_name` · `pas_emp_name`
>   · ทีม = `pas_team.pas_name` / ไทย `pas_team.pas_label_th` · ตำแหน่ง `pas_employee.pas_position`
>   · `pas_shift_code` · `pas_shift_start`/`pas_shift_end` (นาที) · `pas_shift_hours` · `pas_ot_hours`
>   · `pas_bucket.Value` (WORKING/OT_OFF/OFF/SICK/VACATION/LEAVE/TRAINING) · `pas_duty_min`/`pas_busy_min`
> - **`pas_assignments`** — ผูกกับ duty: `pas_duty.pas_duty` · ไฟลท์ `pas_flight_leg`/`pas_name`
>   · `pas_task` · `pas_sta`/`pas_std` (นาที) · `pas_is_flight`

---

## 1) `OnVisible` ของ Screen — ตั้งวันนี้ + เพดาน + แถบวันที่
```powerapps
Set(varToday, Today());
Set(varCap,   DateAdd(varToday, 1, Days));          // เพดาน = พรุ่งนี้
Set(varDate,  varToday);
Set(varStart, DateAdd(varToday, -5, Days));         // ให้ปุ่มสุดท้ายของแถบ = พรุ่งนี้พอดี
Set(varCode,  "");
Set(varRec,   Blank());
Clear(colMyJobs);
// แถบ 7 วัน
ClearCollect(colStrip, ForAll(Sequence(7, 0), { d: DateAdd(varStart, Value, Days) }))
```

## 2) แถบวันที่ (แนวนอน) — Gallery `galStrip`
- **Items:** `colStrip`
- ปุ่มวันในแต่ละแถว (`btnDay`):
  - **Text:** `Text(ThisItem.d, "ddd") & Char(10) & Day(ThisItem.d) & Char(10) & Text(ThisItem.d,"mmm")`
  - **DisplayMode:** `If(ThisItem.d > varCap, DisplayMode.Disabled, DisplayMode.Edit)`  ← วันเกินพรุ่งนี้ กดไม่ได้
  - **Fill:**
    ```powerapps
    If(ThisItem.d = varDate, RGBA(29,66,138,1),
       If(ThisItem.d > varCap, RGBA(241,245,249,1), RGBA(255,255,255,1)))
    ```
  - **Color:** `If(ThisItem.d = varDate, White, If(ThisItem.d > varCap, RGBA(148,163,184,1), RGBA(15,23,42,1)))`
  - **OnSelect:** `If(ThisItem.d <= varCap, Set(varDate, ThisItem.d); LoadMyWork())`  ← ดู §4 เรื่อง LoadMyWork
  - (ป้ายล็อก) ไอคอน 🔒 `Visible = ThisItem.d > varCap`

## 3) ปุ่มเลื่อน + "วันนี้"
```powerapps
// ‹ ย้อนหลัง (ได้ไม่จำกัด)
btnPrev.OnSelect = Set(varStart, DateAdd(varStart, -7, Days));
                   ClearCollect(colStrip, ForAll(Sequence(7,0), { d: DateAdd(varStart, Value, Days) }))

// › ถัดไป — ปิดเมื่อถึงพรุ่งนี้แล้ว
btnNext.DisplayMode = If(DateAdd(varStart, 6, Days) >= varCap, DisplayMode.Disabled, DisplayMode.Edit)
btnNext.OnSelect = Set(varStart, DateAdd(varStart, 7, Days));
                   ClearCollect(colStrip, ForAll(Sequence(7,0), { d: DateAdd(varStart, Value, Days) }))

// วันนี้
btnToday.OnSelect = Set(varDate, varToday);
                    Set(varStart, DateAdd(varToday, -5, Days));
                    ClearCollect(colStrip, ForAll(Sequence(7,0), { d: DateAdd(varStart, Value, Days) }));
                    LoadMyWork()
```

## 4) โหลดงานของคน — `LoadMyWork` (วาง OnSelect ปุ่ม "ดูงาน" และเรียกซ้ำตอนเปลี่ยนวัน)
> ไม่มี user-function ใน canvas → วางชุดนี้ไว้ที่ **`btnSearch.OnSelect`** และ **คัดลอกไปใส่ OnSelect ปุ่มวัน/ปุ่มวันนี้** (แทนคำว่า `LoadMyWork()` ข้างบน)
```powerapps
Set(varCode, Trim(TextInput_Code.Text));
If(varDate > varCap, Set(varDate, varCap));                    // guard เพดานอีกชั้น
// หา duty ของคนนี้ในวันนั้น (filter วันที่ delegable → แล้วค่อย LookUp รหัสในชุดเล็ก)
Set(varRec, LookUp(Filter(pas_duties, pas_work_date = varDate),
                   Trim(pas_employee.pas_name) = varCode));
// งานที่รับ (ผูกกับ duty นั้น)
Clear(colMyJobs);
If(!IsBlank(varRec),
   ClearCollect(colMyJobs,
      AddColumns(
         Filter(pas_assignments, pas_duty.pas_duty = varRec.pas_duty),
         "label",  Coalesce(pas_flight_leg, pas_name),
         "real",   pas_is_flight,
         "timeTxt",
            With({ s: pas_sta, d: pas_std },
               If(!IsBlank(s) && !IsBlank(d),
                  Text(RoundDown(s/60,0),"00") & ":" & Text(Mod(s,60),"00") & "–" &
                  Text(RoundDown(d/60,0),"00") & ":" & Text(Mod(d,60),"00"),
                  ""))
      )
   )
)
```

## 5) การ์ดหัว + กะ + KPI (Label)
```powerapps
// หัว: ชื่อ · รหัส · ทีม · ตำแหน่ง
lblName.Text  = If(IsBlank(varRec), "—", varRec.pas_emp_name)
lblMeta.Text  = varCode & If(IsBlank(varRec), "",
                  " · " & varRec.pas_team.pas_name & " · " & varRec.pas_employee.pas_position)

// กะของวันที่เลือก (HH:MM จากนาที)
lblShift.Text = If(IsBlank(varRec), "ไม่มีข้อมูล",
   If(varRec.pas_bucket.Value in ["WORKING","OT_OFF"] && !IsBlank(varRec.pas_shift_start),
      Text(RoundDown(varRec.pas_shift_start/60,0),"00") & ":" & Text(Mod(varRec.pas_shift_start,60),"00") & "–" &
      Text(RoundDown(varRec.pas_shift_end/60,0),"00") & ":" & Text(Mod(varRec.pas_shift_end,60),"00"),
      If(varRec.pas_bucket.Value in ["WORKING","OT_OFF"], Coalesce(varRec.pas_shift_code,"(ไม่ระบุเวลา)"), "—")))

lblStatus.Text= Switch(varRec.pas_bucket.Value,
                   "WORKING","ขึ้นงาน", "OT_OFF","OT (วันหยุด)",
                   "OFF","วันหยุด (OFF)", "SICK","ลาป่วย",
                   "VACATION","ลาพักร้อน", "LEAVE","ลา", "TRAINING","อบรม", "ไม่ขึ้นงาน")

// KPI
lblShiftHrs.Text = If(IsBlank(varRec) || Coalesce(varRec.pas_shift_hours,0)=0, "—", Text(varRec.pas_shift_hours) & " ชม.")
lblOtHrs.Text    = If(Coalesce(varRec.pas_ot_hours,0)>0, Text(varRec.pas_ot_hours) & " ชม.", "—")
lblUtil.Text     = If(IsBlank(varRec) || Coalesce(varRec.pas_duty_min,0)=0, "—",
                      Text(RoundDown(varRec.pas_busy_min/varRec.pas_duty_min*100,0)) & "%")
```

## 6) ตารางงานที่ได้รับ (Gallery `galJobs`)
```powerapps
galJobs.Items = colMyJobs          // ช่อง: label (ไฟลท์/งาน) · timeTxt · pas_task
lblJobCount.Text = CountRows(colMyJobs) & " งาน"
// ว่าง: Label "ไม่มีไฟลท์/งานในวันนี้"  Visible = CountRows(colMyJobs)=0
// แยกงานไฟลท์จริง vs งานอื่น: ThisItem.real  (pas_is_flight)
```

## 7) DatePicker (ถ้าใช้แทน/เสริมแถบ) — คุมเพดานในตัว
```powerapps
dpDate.Max = varCap        // เลือกเกินพรุ่งนี้ไม่ได้
dpDate.OnChange = If(dpDate.SelectedDate <= varCap, Set(varDate, dpDate.SelectedDate); /* LoadMyWork() */)
```

---

## เพดาน "วันนี้+1" บังคับ 3 ชั้น
1. **ปุ่มวันในแถบ** — `DisplayMode.Disabled` เมื่อ `d > varCap` (กดไม่ได้ + สีจาง + 🔒)
2. **ปุ่ม ›** ปิดเมื่อแถบถึงพรุ่งนี้แล้ว · **dpDate.Max = varCap**
3. **ก่อนโหลดข้อมูล** — `If(varDate > varCap, Set(varDate, varCap))` กันค่าถูกตั้งจากที่อื่น

## หมายเหตุ
- ย้อนหลังไม่จำกัด (ปุ่ม ‹ เลื่อนได้เรื่อย ๆ) ตรงตามกฎ "ดูย้อนหลังได้ตามต้องการ"
- การกรอง `Filter(pas_duties, pas_work_date = varDate)` **delegable** ใน Dataverse (วันเดียว ~ไม่กี่ร้อยแถว) → `LookUp` ด้วย `pas_employee.pas_name` ทำในชุดเล็ก ปลอดภัย
- ถ้า Studio เตือน delegation ที่ `pas_employee.pas_name` ให้แน่ใจว่า `Filter(pas_duties, pas_work_date=varDate)` อยู่ชั้นในสุด (ดึงวันเดียวก่อน)
- "งานของฉัน" จริง ๆ = กรองด้วย `varCode` → พนักงานเปิดด้วยเมลกลางทีม/จอรวม แล้วพิมพ์รหัสตัวเอง (ไม่ต้องล็อกอินรายคน)
