# 46 · เชื่อม Assignment ↔ Roster + ชิพงาน · เวลาเข้า-ออก · OT

ตอบจากหน้าจริง (scrAssign · ทีม EY · 2026-11-01) ที่ขึ้น **"Off" ทุกคน · ลงงานไม่ได้ · จัด 0/26**

## A · ทำไมทุกคนขึ้น "Off" — Assignment ผูกกับ Roster
scrAssign โหลดคนจาก **`PAS_Duty`** ของ **team + day_key** นั้น:
```powerapps
ClearCollect(colADuty, Filter(PAS_Duty, day_key = varAKey, team = varAT))
```
- คอลัมน์ **SHIFT / STATUS** = มาจาก `PAS_Duty.shift_code` / `bucket` ของคนนั้นวันนั้น
- **2026-11-01 (ฤดูหนาว) ยังไม่ได้ generate roster** → ไม่มีแถว WORKING → ทุกคน `Off` → ลงช่องไฟลท์ไม่ได้ (ลงได้เฉพาะคนที่ขึ้นงาน)

> **flight ปีนี้เข้าแล้ว** (EY410/AY151/… จาก `44`) แต่ **ยังไม่มี roster** → ต้องทำ roster ก่อน assignment ถึงมีคนให้ลง

### แก้: generate Winter roster ของวันนั้นก่อน
มี flight data แล้ว → รัน pipeline:
```bash
# 1) ไฟลท์→req (per team per day) จาก flight master ฤดูหนาว
python3 tools/build_int_roster.py --month 2026-11 ...      # ได้ ShiftReq_Daily
# 2) จัดคน 4-หยุด-2 + หมุนกะ → PAS_Duty
python3 tools/build_roster.py --req <เดือน.xlsx> --reg <ทะเบียน> --dataverse <out>
```
→ import `pas_duty_roster.csv` เข้า **PAS_Duty** → scrAssign กด **โหลด** ใหม่ → คนขึ้น SHIFT/เวลา และลงงานได้

## B · แสดง SHIFT + เวลาเข้า-ออก (จาก roster)
ในกริด ต่อคน โชว์กะ + เวลาเข้า-ออกจาก `PAS_Duty`:
```powerapps
// คอลัมน์ SHIFT
lblShift.Text = LookUp(colADuty, emp_code = ThisItem.emp_code).shift_code
// เวลาเข้า-ออก (ตามแผนกะ)
lblTime.Text  = With({d: LookUp(colADuty, emp_code = ThisItem.emp_code)},
  If(IsBlank(d) || d.bucket.Value = "OFF", "Off",
     Substitute(d.shift_start,":00","") & "–" & Substitute(d.shift_end,":00","")))
// STATUS: WORKING/OT_OFF = ขึ้นงาน · OFF = หยุด
```
ให้ลงช่องไฟลท์ได้เฉพาะคนที่ขึ้นงาน:
```powerapps
// ปุ่ม/ช่องลงตำแหน่ง: ปิดถ้าไม่ได้ทำงาน
DisplayMode = If(LookUp(colADuty, emp_code=ThisItem.emp_code).bucket.Value in ["WORKING","OT_OFF"] && varPriv, DisplayMode.Edit, DisplayMode.Disabled)
```

## C · ชิพงาน (job chips) ต่อช่อง
ช่อง = ตำแหน่งที่ลงของคน×ไฟลท์ (`PAS_Assignment.task` "/"-joined) แสดงเป็นชิพ:
```powerapps
// ชิพในช่อง: แยก task ด้วย "/" แล้วแสดงเป็น label เล็ก ๆ
galChips.Items = Split(LookUp(colAAsg, emp_code=ThisItem.emp_code && Title=varAFlt.flight_no).task, "/")
// เพิ่มชิพ: ป๊อปอัปเลือกตำแหน่งจาก PAS_TeamPosition (ต่อ phase) + PAS_FlightExtraPos → Patch task
// (มีอยู่แล้วใน scrAssign — gate ด้วย varPriv + คนต้อง WORKING)
```
> "งานอื่น (เทรน/อบรม)" = ปุ่มมุมขวาบนที่มีอยู่ → ลงงานที่ไม่ใช่ไฟลท์ (is_flight=false)

## D · บันทึกเวลาเข้า-ออกจริง + OT (ต่อคน/วัน)
"เวลาเข้า-ออกงานจริง" (actual on-duty) และ OT แยกจาก "กะตามแผน" → เก็บที่ `PAS_Duty`
**เพิ่มคอลัมน์ (ถ้ายังไม่มี):** `duty_in` `duty_out` (Text hh:mm) · `ot_pre_hours` `ot_post_hours` (decimal) · (`ot_hours` มีแล้ว)
```powerapps
// ช่องกรอกต่อคน (ในกริด หรือป๊อปอัป)
txtIn.Default  = LookUp(colADuty, emp_code=ThisItem.emp_code).duty_in
txtOut.Default = LookUp(colADuty, emp_code=ThisItem.emp_code).duty_out
txtOT.Default  = Text(LookUp(colADuty, emp_code=ThisItem.emp_code).ot_hours)
btnSaveDuty.OnSelect =
  Patch(PAS_Duty, LookUp(PAS_Duty, day_key=varAKey && team=varAT && emp_code=ThisItem.emp_code),
    { duty_in: txtIn.Text, duty_out: txtOut.Text,
      ot_pre_hours: Value(txtOTpre.Text), ot_post_hours: Value(txtOTpost.Text),
      ot_hours: Value(txtOTpre.Text) + Value(txtOTpost.Text),
      pas_source: {Value:"MANUAL"} });
  Notify("บันทึกเวลา/OT แล้ว", NotificationType.Success)
```
> OT ที่กรอกนี้ = "ขอจริง" → ไหลเข้า scrWH (ชม./OT รายสัปดาห์) + ตรวจ OT + MANPOWER อัตโนมัติ (ตารางเดียว PAS_Duty)
> เพดาน: เตือนถ้า OT รวม > 36 ชม./สัปดาห์ (ดู scrWH)

## สรุป flow ที่ถูกต้อง
```
flight master (44) → generate roster → PAS_Duty (ใคร WORKING + กะ + เวลา)
   → scrAssign: โชว์ SHIFT/เวลา จาก roster · ลงชิพตำแหน่งต่อไฟลท์ (คนที่ WORKING)
   → กรอกเวลาเข้า-ออกจริง + OT → PAS_Duty → scrWH/ตรวจ OT
```
> ตอนนี้ต้อง **generate roster ฤดูหนาว** ของวันที่ต้องการก่อน scrAssign ถึงมีคนให้ลง (ไม่งั้นขึ้น Off หมด)
