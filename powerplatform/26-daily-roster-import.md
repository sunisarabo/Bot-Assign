# 26 · นำเข้าไฟล์เวรรายวันเดิม (ก ประวัติ · ข sync ขนาน)

`tools/import_daily_roster.py` อ่านแท็บทีมในไฟล์เวร (PAS DAILY JOB ASSIGNMENT เช่น 01OCT.xlsx)
→ CSV `pas_duty` พร้อม **กะจริง · เวลา IN/OUT · OT ก่อน/หลังกะ · ตำแหน่ง**
```bash
python3 tools/import_daily_roster.py  01OCT.xlsx 02OCT.xlsx ...  -o pas_duty_history.csv
```
คอลัมน์: `pas_name(รหัส_วันที่) · pas_work_date · EmpCode · emp_name · Team · Position ·
pas_bucket · pas_shift_code · pas_shift_start/end · pas_shift_hours · pas_ot_pre_hours · pas_ot_post_hours · pas_ot_hours`

## (เตรียม) เพิ่มคอลัมน์ใน `pas_duty` (ถ้าอยากเก็บครบ)
- **Position** (Text) · **pas_ot_pre_hours** (decimal) · **pas_ot_post_hours** (decimal)
> ถ้าไม่เพิ่ม ก็ import เฉพาะคอลัมน์ที่มีอยู่ (ข้าม Position/ot_pre/ot_post ได้)

---

## ก · นำเข้าประวัติ (ครั้งเดียว)
1. รัน importer กับไฟล์เวรย้อนหลังทั้งหมด (หลายไฟล์พร้อมกันได้) → `pas_duty_history.csv`
2. Import เข้า **PAS Duty** — **upsert ด้วย alternate key `pas_name`** (ดู `23`) → แถวซ้ำวัน/คน = อัปเดต ไม่ซ้ำ
3. ได้ประวัติเวร+OT จริงใน Dataverse → หน้า ชม./OT (scrWH) · MANPOWER · ตรวจ OT ย้อนหลังได้

> จับคู่ lookup: `EmpCode→pas_employee` (Emp Code) · `Team→pas_team` (Team Code)
> ⚠️ ชื่อทีมในไฟล์เวรเก่า (WY, WK, PVTLP, PORTER…) อาจไม่ตรง Team Code ใน Dataverse — ทำตารางแม็ปหรือแก้ให้ตรงก่อน import

## ข · Sync ขนาน (ช่วงเปลี่ยนผ่าน)
ให้ไฟล์เวรที่ทีมยังกรอกบน SharePoint sync เข้า Dataverse อัตโนมัติ จนกว่าทุกคนย้ายมาแอป

**ทางที่เสถียร (แนะนำ):** รัน importer ตามเวลา แล้ว upsert
1. SharePoint โฟลเดอร์ `00.DailyRoster/` = ที่ทีมวางไฟล์เวรรายวัน
2. เครื่อง/เซิร์ฟเวอร์ (Task Scheduler) รันทุก ~30 นาที:
   `import_daily_roster.py <ไฟล์วันนี้> -o 00.RosterImport/pas_duty_history.csv`
3. **Dataflow** (`23`) refresh → upsert เข้า PAS Duty ด้วย `pas_name`

**ทางในคลาวด์ล้วน (ถ้าไม่อยากมีเครื่อง on-prem):**
- **Office Script** อ่านแท็บทีม (เหมือน logic importer) → คืน JSON ต่อแถว
- **Power Automate:** When a file is modified (`00.DailyRoster/`) → **Run script** (Office Script) → Apply to each → **Upsert PAS Duty** (key `pas_name`)
  > Office Script วนแท็บทีม เก็บ ID/Position/NAME/SHIFT/IN/OUT/Total/OT ตามคอลัมน์เดียวกับ importer

## ข้อควรรู้
- upsert ด้วย `pas_name` → ไฟล์เวร "ทับ" roster ที่ generator สร้าง สำหรับวันนั้น (ของจริงชนะของแผน) — ตรงตามเจตนาช่วงเปลี่ยนผ่าน
- แต่ถ้าแก้ในแอป (แลกเวร/ลา) แล้วไฟล์เวร sync ทับ อาจชนกัน → ช่วงเปลี่ยนผ่านควร **เลือกแหล่งเดียวต่อวัน** (ไฟล์เวร *หรือ* แอป) ไม่ใช้พร้อมกันทั้งคู่บนวันเดียว
- พอทุกคนใช้แอปแล้ว → ปิด sync ขนาน เหลือ generator + แอป อย่างเดียว
- importer ยังดึง **OT ก่อน/หลังกะ แยก** → เสียบหน้า scrWH/MANPOWER แยกช่องได้ (ตามที่เคยขอ "แยก OT ก่อน/หลัง")
