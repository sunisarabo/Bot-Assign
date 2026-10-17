# 27 · เติมฟีเจอร์ที่ยังขาด (ข) — จับคู่ชื่อคอนโทรลจริงในแอป

ตรวจหน้าที่ทำแล้วใน `PAS-screens-responsive.pa.yaml` (scrRoster · scrFlights · scrAssign · scrOT · scrWH)
พบว่า **ทำแล้ว**: แลกเวร (PAS_SwapLog) · ลา BL/VL/SL/ML/PL (PAS_LeaveLog) · ไฟลท์ เพิ่ม/แก้/ยกเลิก (status+cancelled) · ชม.ทำงาน/OT รายสัปดาห์ (scrWH, cap 48h/36h OT)
**ยังขาด 3 อย่าง** → เอกสารนี้เติมให้ครบ โดยใช้ **ชื่อ var/คอลัมน์เดิมของแอป**

| # | ฟีเจอร์ | อ้างอิง | สถานะเดิม |
|---|---------|--------|-----------|
| A | `varPriv` คุมสิทธิ์ (พนักงานดูอย่างเดียว · ซุปแก้ได้) | 07 | ยังไม่มี gating เลย |
| B | รับทราบก่อนทำงาน (acknowledge) + แจ้งเตือนพอตเตอร์วีลแชร์/ซัพพอร์ท | 17 · 19 | ยังไม่มี |
| C | ปุ่มเปลี่ยนกะของช่อง (จาก `pas_shift_template`) | 25 | ยังไม่มี (มีแค่แลกเวร/ลา) |

---

## A · `varPriv` คุมสิทธิ์ (07)

เป้า: คนไม่มี M365 / พนักงานทั่วไป = **ดูอย่างเดียว** · หัวหน้าทีม(ซุป)/แอดมิน = **แก้ได้**
ทำครั้งเดียวที่ `App.OnStart` แล้วเอา `varPriv` ไป gate ปุ่มแก้ทุกจุด

### 1) ตาราง/คอลัมน์สิทธิ์
ใช้ `PAS_Employees` ที่มีอยู่ — เพิ่มคอลัมน์ **`app_role`** (Choice: `STAFF` / `SUP` / `ADMIN`) ให้คนที่ล็อกอินด้วยอีเมล M365
> คนไม่มี M365 ไม่ได้ล็อกอิน → ไม่มีสิทธิ์แก้โดยอัตโนมัติ (ค่าปริยาย STAFF)

### 2) App → OnStart (วางต่อท้ายของเดิม)
```powerapps
// สิทธิ์ของผู้ใช้ที่ล็อกอิน — ซุป/แอดมินเท่านั้นที่แก้ได้
Set(varMe, LookUp(PAS_Employees, Lower(work_email) = Lower(User().Email)));
Set(varPriv, !IsBlank(varMe) && varMe.app_role.Value in ["SUP", "ADMIN"]);
Set(varMyCode, Coalesce(varMe.emp_code, ""));
Set(varMyTeam, Coalesce(varMe.team, ""))
```
> ถ้ายังไม่มีคอลัมน์ `work_email` ให้แม็ปกับฟิลด์อีเมลที่มี หรือชั่วคราวใช้รายชื่อซุป:
> `Set(varPriv, User().Email in ["sup1@aotga.com","sup2@aotga.com"])`

### 3) gate ปุ่มแก้ (เปลี่ยน `DisplayMode`/`Visible` — ไม่ต้องรื้อสูตรเดิม)

**scrRoster**
```powerapps
btnRSwapMode.DisplayMode  = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnRLeaveMode.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnRShiftMode.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)   // ปุ่มใหม่ส่วน C
// กันพลาด: ปุ่มยืนยันในแถบโหมดก็ปิดด้วย
btnRSwGo.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnRLvSave.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
```
**scrAssign** — ช่อง/ปุ่มที่ patch PAS_Assignment
```powerapps
// ป๊อปอัปลงตำแหน่ง + ปุ่มลบ + ลงงานอื่น → ปิดเมื่อไม่ใช่ซุป
galAStaff.DisplayMode     = =If(varPriv, DisplayMode.Edit, DisplayMode.View)
galAFvStaff.DisplayMode   = =If(varPriv, DisplayMode.Edit, DisplayMode.View)
btnAODel.DisplayMode      = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
// ปุ่มยืนยันในป๊อปอัปตำแหน่ง/งานอื่น ก็ใส่ If(varPriv,...) เหมือนกัน
```
**scrFlights** — ปุ่มบันทึก/ยกเลิกไฟลท์
```powerapps
btnFSave.DisplayMode   = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnFCancel.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
```
**ป้ายบอกโหมด (ทุกหน้า, ไม่บังคับ)**
```powerapps
lblMode.Text = =If(varPriv, "โหมดแก้ไข (ซุป)", "👁 ดูอย่างเดียว")
```
> พนักงานยังเปิดดู roster/assignment/OT ได้ครบ แค่ปุ่มแก้เป็นสีเทา/ซ่อน

---

## B · รับทราบก่อนทำงาน (17 · 19) + แจ้งเตือนพอตเตอร์

เป้า: ก่อนขึ้นงานไหน พนักงานต้องกด **"รับทราบ"** assignment ของตัวเองก่อน · พอตเตอร์เคสวีลแชร์/ซัพพอร์ทมีแจ้งเตือน

### 1) เพิ่มคอลัมน์ใน `PAS_Assignment`
- **`acknowledged`** (Yes/No, default No)
- **`ack_at`** (Date and Time)
- **`priority`** (Choice: `NORMAL` / `WHEELCHAIR` / `SUPPORT`) — ไว้ไฮไลต์เคสด่วน

> ตอนลงงาน (ปุ่ม patch เดิมใน scrAssign) เพิ่มคีย์ `acknowledged: false` ใน record ที่ Patch
> เคสวีลแชร์: เวลาลงตำแหน่งที่มี "WCHR/วีลแชร์" ให้ใส่ `priority: {Value:"WHEELCHAIR"}` (ดูข้อ 4)

### 2) หน้า "งานของฉันวันนี้" (scrMy) — กริดเล็ก ๆ ที่พนักงานเปิดเอง
วางแกลเลอรีเดียว (พนักงานไม่มี M365 เปิดผ่านลิงก์/เครื่องรวมก็เห็นของตัวเองถ้าเลือกรหัส)
```powerapps
// scrMy.OnVisible
Set(varMyKey, Text(Today(), "yyyy-mm-dd"));
ClearCollect(colMy, Filter(PAS_Assignment,
    day_key = varMyKey,
    emp_code = Coalesce(varMyCode, ddMyWho.Selected.code)))
```
**galMy.Items** = `=SortByColumns(colMy, "sta")`
แต่ละแถว:
```powerapps
lblMyFlt.Text  = =ThisItem.Title & " · " & Coalesce(ThisItem.task, "") & "  " & ThisItem.sta & "–" & ThisItem.std
// ไฮไลต์เคสด่วน
lblMyFlt.Fill  = =Switch(ThisItem.priority.Value, "WHEELCHAIR", RGBA(255,224,178,1), "SUPPORT", RGBA(255,236,179,1), RGBA(255,255,255,1))
// ปุ่มรับทราบ
btnMyAck.Text      = =If(ThisItem.acknowledged, "✓ รับทราบแล้ว", "กดรับทราบ")
btnMyAck.Fill      = =If(ThisItem.acknowledged, RGBA(198,224,180,1), RGBA(29,66,138,1))
btnMyAck.DisplayMode = =If(ThisItem.acknowledged, DisplayMode.Disabled, DisplayMode.Edit)
btnMyAck.OnSelect  =
  =With({u: Patch(PAS_Assignment, ThisItem, {acknowledged: true, ack_at: Now()})},
     Remove(colMy, ThisItem); Collect(colMy, u));
   Notify("รับทราบงาน " & ThisItem.Title & " แล้ว", NotificationType.Success)
```
แถบเตือนบนหัวจอ (ยังไม่กดครบ):
```powerapps
lblMyWarn.Text    = =With({n: CountRows(Filter(colMy, !acknowledged))}, If(n > 0, "⚠ ยังไม่รับทราบ " & n & " งาน — กดรับทราบก่อนเริ่มงาน", "รับทราบครบแล้ว ✓"))
lblMyWarn.Fill    = =If(CountRows(Filter(colMy, !acknowledged)) > 0, RGBA(253,226,226,1), RGBA(226,239,218,1))
```

### 3) gate "เริ่มงาน" ด้วยการรับทราบ
ที่ใดก็ตามที่ให้กด "เริ่ม/ไปงาน" ให้เช็คก่อน:
```powerapps
If(!ThisItem.acknowledged,
   Notify("ต้องกดรับทราบก่อนเริ่มงานนี้", NotificationType.Error),
   /* ...โค้ดเริ่มงานเดิม... */ )
```

### 4) แจ้งเตือนพอตเตอร์วีลแชร์ / ซัพพอร์ท
- **ตอนลงงานวีลแชร์** (scrAssign, ตำแหน่งมี WCHR): ใส่ `priority:{Value:"WHEELCHAIR"}` + ส่งแจ้งเตือน
```powerapps
// ต่อท้ายปุ่ม patch assignment ของตำแหน่งวีลแชร์
If("WCHR" in Upper(p) || "วีลแชร์" in p,
   Notify("🦽 เคสวีลแชร์: " & varSelName & " · ไฟลท์ " & varAFlt.flight_no & " STA " & varAFlt.sta, NotificationType.Warning))
```
- **In-app + LINE** (ตามที่ขอ "ค ทั้งสอง"): ต่อ Flow ส่ง LINE push ดู `18-notify-steps.md`
  - trigger: PAS_Assignment ถูกสร้างและ `priority = WHEELCHAIR/SUPPORT`
  - ส่งหา `emp_code` คนที่ถูก assign (ผูก LINE userId ใน PAS_Employees) + กลุ่มพอตเตอร์
```powerapps
// in-app: Timer โพลงานด่วนของตัวเอง (พอตเตอร์ไม่ล็อกอินก็เห็น)
tmrMyAlert.OnTimerEnd =
  =ClearCollect(colMyUrgent, Filter(PAS_Assignment, day_key = varMyKey, emp_code = varMyCode, priority.Value in ["WHEELCHAIR","SUPPORT"], !acknowledged));
   If(CountRows(colMyUrgent) > 0, Notify("🔔 มีงานด่วน " & CountRows(colMyUrgent) & " รายการ — กดรับทราบ", NotificationType.Warning))
// tmrMyAlert.Duration = 60000 · Repeat = true · AutoStart = true
```

---

## C · ปุ่มเปลี่ยนกะของช่อง (25) — แถบโหมดที่ 3 บน scrRoster

มีแล้ว: แถบ **แลกเวร** (varRSwap) · แถบ **ลา** (varRLeave) → เพิ่มแถบ **เปลี่ยนกะ** (varRShift) แบบเดียวกัน
(HtmlViewer กดรายช่องไม่ได้ จึงใช้ดรอปดาวน์ คน+วัน+กะ เหมือนแถบแลกเวร/ลา)

### 1) ตาราง `pas_shift_template` — ดู `25-shift-catalog.md` (import `shift_templates.csv` แล้ว)

### 2) ปุ่มเปิดโหมด (วางข้าง btnRLeaveMode)
```powerapps
btnRShiftMode.Text  = =If(App.Width < 640, If(varRShift, "✕", "⏲"), If(varRShift, "ปิดเปลี่ยนกะ", "⏲ เปลี่ยนกะ"))
btnRShiftMode.Fill  = =If(varRShift, RGBA(45,106,79,1), RGBA(255,255,255,1))
btnRShiftMode.Color = =If(varRShift, RGBA(255,255,255,1), RGBA(29,66,138,1))
btnRShiftMode.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnRShiftMode.OnSelect = =Set(varRShift, !varRShift); Set(varRSwap, false); Set(varRLeave, false);
  If(varRShift, ClearCollect(colRShifts, SortByColumns(Filter(pas_shift_templates, team = varRT), "StartMin")))
```
> อัปเดต `htmlRGrid.Y` ให้รวม `varRShift`:
> `=If(varRSwap || varRLeave || varRShift, 118 + If(App.Width < 640, 44, 0) + If(App.Width < 640, 176, 78) + 4, 122 + If(App.Width < 640, 44, 0))`
> และ `recRSw`/`recRLv`/คอนโทรลโหมด ให้ `Visible` แยกตามตัวแปรของแต่ละโหมด

### 3) แถบเปลี่ยนกะ (recRSh + ดรอปดาวน์ + ปุ่ม)
```powerapps
recRSh.Visible = =varRShift     // Rectangle พื้นเขียวอ่อน RGBA(226,240,233,1) ตำแหน่งเดียวกับ recRSw

ddRShEmp.Visible = =varRShift
ddRShEmp.Items   = =colRStaff                         // {lbl, code} เดิม
ddRShDay.Visible = =varRShift
ddRShDay.Items   = =Sequence(Coalesce(varRDays, 30))
ddRShCode.Visible = =varRShift
ddRShCode.Items  = =colRShifts                         // กะของทีม
// ปุ่มในดรอปดาวน์กะ โชว์ code + เวลา:
ddRShCode.OnChange ไม่ต้อง · ใช้ ddRShCode.Selected.Code / .StartMin / .EndMin

lblRShInfo.Visible = =varRShift
lblRShInfo.Text =
  =With({r: LookUp(colRDuty, emp_code = ddRShEmp.Selected.code && day_key = varRM & "-" & Text(ddRShDay.Selected.Value, "00"))},
     "วันที่ " & ddRShDay.Selected.Value & " ปัจจุบัน = " & Coalesce(r.shift_code, r.bucket.Value, "-") &
     "  →  ใหม่ = " & ddRShCode.Selected.Code & " (" & Text(ddRShCode.Selected.StartMin,"[$-en]00") & ")")
```
### 4) ปุ่มยืนยันเปลี่ยนกะ → Patch PAS_Duty (คีย์/ฟิลด์ตรงกับของจริง)
```powerapps
btnRShSave.Visible = =varRShift
btnRShSave.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnRShSave.Text = ="บันทึกกะ"
btnRShSave.OnSelect =
  =With({r: LookUp(colRDuty, emp_code = ddRShEmp.Selected.code && day_key = varRM & "-" & Text(ddRShDay.Selected.Value, "00")),
         sh: ddRShCode.Selected},
     If(IsBlank(r), Notify("ไม่พบช่องที่เลือก", NotificationType.Error),
        Patch(PAS_Duty, r,
          { bucket: {Value: "WORKING"},
            shift_code: sh.Code,
            shift_start: Text(Time(RoundDown(sh.StartMin/60,0), Mod(sh.StartMin,60), 0), "hh:mm"),
            shift_end:   Text(Time(RoundDown(Mod(sh.EndMin,1440)/60,0), Mod(sh.EndMin,60), 0), "hh:mm"),
            shift_hours: (sh.EndMin - sh.StartMin)/60 });
        Notify("เปลี่ยนกะ " & r.emp_name & " วันที่ " & ddRShDay.Selected.Value & " → " & sh.Code & " แล้ว", NotificationType.Success);
        Select(btnRLoad)))     // รีโหลดกริด
```
> OFF/ลา ใช้แถบ **ลา** เดิม (PAS_LeaveLog) · แถบนี้เฉพาะ "เปลี่ยนเป็นกะทำงาน" จากชุดกะมาตรฐาน
> กะข้ามเที่ยงคืน `EndMin > 1440` จัดการด้วย `Mod(...,1440)` แล้ว

---

## สรุปสิ่งที่ต้องทำใน Power Apps Studio
1. **คอลัมน์ใหม่**: `PAS_Employees.app_role` · `PAS_Assignment.acknowledged/ack_at/priority`
2. **App.OnStart**: เติม varPriv/varMyCode/varMyTeam (A-2)
3. **scrRoster**: เติม 6 คอนโทรลโหมดเปลี่ยนกะ (C) + gate ปุ่มด้วย varPriv (A-3)
4. **scrAssign/scrFlights**: gate ปุ่มแก้ด้วย varPriv (A-3) + ใส่ acknowledged:false ตอนลงงาน + ไฮไลต์วีลแชร์ (B-1,B-4)
5. **scrMy ใหม่**: งานของฉัน + ปุ่มรับทราบ (B-2) + Timer เตือนงานด่วน (B-4)
6. (ถ้าเอา LINE) Flow push ตาม `18` trigger priority = WHEELCHAIR/SUPPORT
