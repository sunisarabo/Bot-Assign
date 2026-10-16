# 09 · งานของฉัน — Power Fx (ดูย้อนหลังได้ · ล่วงหน้าแค่วันนี้+1)

หน้า **"งานของฉัน"** บน Power Apps — พนักงานใส่รหัสดูงานตัวเอง/ทีม
กฎสิทธิ์ (ตาม `07-access-roles.md`): **ย้อนหลังได้ทุกวัน · ล่วงหน้าได้แค่ วันนี้+1**

> สมมติ data source (ปรับชื่อให้ตรงของจริง):
> - **`Duty`** — ไฟล์เวรรายคน: `work_date` · `emp_code` · `emp_name` · `team` · `position` · `shift_time` · `shift_hrs` · `ot_plan` · `util_pct` · `bucket`
> - **`Assignment`** — งานที่รับ: `work_date` · `emp_code` · `flight` · `task` · `time_text`

---

## 1) `OnVisible` ของ Screen — ตั้งวันนี้ + เพดาน + แถบวันที่
```powerapps
Set(varToday, Today());
Set(varCap,   DateAdd(varToday, 1, Days));          // เพดาน = พรุ่งนี้
Set(varDate,  varToday);
Set(varStart, DateAdd(varToday, -5, Days));         // ให้ปุ่มสุดท้ายของแถบ = พรุ่งนี้พอดี
Set(varCode,  "");
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
  - **OnSelect:** `If(ThisItem.d <= varCap, Set(varDate, ThisItem.d); Reset(TextInput_Code); Set(varCode,""))`
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
                    ClearCollect(colStrip, ForAll(Sequence(7,0), { d: DateAdd(varStart, Value, Days) }))
```

## 4) ช่องค้นหา + ปุ่ม "ดูงาน"
```powerapps
// ปุ่มดูงาน (หรือ TextInput_Code.OnChange)
btnSearch.OnSelect =
    Set(varCode, Trim(TextInput_Code.Text));
    // guard เพดานวันอีกชั้น (กันแก้ค่าภายนอก)
    If(varDate > varCap, Set(varDate, varCap));
    Set(varRec, LookUp(Duty, work_date = varDate, Trim(emp_code) = varCode));
    ClearCollect(colMyJobs, Filter(Assignment, work_date = varDate, Trim(emp_code) = varCode))
```
> ถ้าอยากให้เปลี่ยนวันแล้วโหลดคนเดิมอัตโนมัติ ให้ย้าย 3 บรรทัดท้าย (LookUp/ClearCollect) ไปไว้ใน `OnSelect` ของปุ่มวัน + ปุ่มเลื่อน ด้วย โดยใช้ `varCode` เดิม

## 5) การ์ดหัว + กะ + KPI (Label)
```powerapps
// หัว: ชื่อ · รหัส · ทีม · ตำแหน่ง
lblName.Text  = If(IsBlank(varRec), "—", varRec.emp_name)
lblMeta.Text  = varCode & If(IsBlank(varRec), "", " · " & varRec.team & " · " & varRec.position)

// กะของวันที่เลือก
lblShift.Text = If(IsBlank(varRec), "ไม่มีข้อมูล",
                   If(varRec.bucket in ["working","ot_off"], Coalesce(varRec.shift_time,"(ไม่ระบุเวลา)"), "—"))
lblStatus.Text= Switch(varRec.bucket,
                   "working","ขึ้นงาน", "ot_off","OT (วันหยุด)",
                   "off","วันหยุด (OFF)", "sick","ลาป่วย", "leave","ลา", "ไม่ขึ้นงาน")

// KPI
lblShiftHrs.Text = If(IsBlank(varRec) || Coalesce(varRec.shift_hrs,0)=0, "—", Text(varRec.shift_hrs) & " ชม.")
lblOtHrs.Text    = If(Coalesce(varRec.ot_plan,0)>0, Text(varRec.ot_plan) & " ชม.", "—")
lblUtil.Text     = If(IsBlank(varRec) || IsBlank(varRec.util_pct), "—", Text(varRec.util_pct) & "%")
```

## 6) ตารางงานที่ได้รับ (Gallery `galJobs`)
```powerapps
galJobs.Items = colMyJobs          // ช่อง: flight · time_text · task
lblJobCount.Text = CountRows(colMyJobs) & " งาน"
// ว่าง: Label "ไม่มีไฟลท์/งานในวันนี้"  Visible = CountRows(colMyJobs)=0
```

## 7) DatePicker (ถ้าใช้แทน/เสริมแถบ) — คุมเพดานในตัว
```powerapps
DatePicker_Pick.Max = varCap        // เลือกเกินพรุ่งนี้ไม่ได้
DatePicker_Pick.OnChange = If(DatePicker_Pick.SelectedDate <= varCap, Set(varDate, DatePicker_Pick.SelectedDate))
```

---

## เพดาน "วันนี้+1" บังคับ 3 ชั้น
1. **ปุ่มวันในแถบ** — `DisplayMode.Disabled` เมื่อ `d > varCap` (กดไม่ได้ + สีจาง + 🔒)
2. **ปุ่ม ›** ปิดเมื่อแถบถึงพรุ่งนี้แล้ว · **DatePicker.Max = varCap**
3. **ก่อนโหลดข้อมูล** — `If(varDate > varCap, Set(varDate, varCap))` กันค่าถูกตั้งจากที่อื่น

## หมายเหตุ
- ย้อนหลังไม่จำกัด (ปุ่ม ‹ เลื่อนได้เรื่อย ๆ) ตรงตามกฎ "ดูย้อนหลังได้ตามต้องการ"
- ถ้า `Duty`/`Assignment` อยู่บน Excel ที่แถวเยอะ ให้กรอง **รายวัน** (เท่ากับ `work_date = varDate`) และทำผ่าน flow แบบเดียวกับ `08-powerfx-ot-actual.md` เพื่อเลี่ยง delegation 2,000 แถว · ถ้าเป็น SharePoint List ที่ index `work_date` แล้ว `Filter()` delegable ตรง ๆ ได้
- "งานของฉัน" จริง ๆ = กรองด้วย `varCode` → พนักงานเปิดด้วยเมลกลางทีม/จอรวม แล้วพิมพ์รหัสตัวเอง (ไม่ต้องล็อกอินรายคน)
