# 23 · Flow import/export จริง — ทีละ action

- **Export:** PAS_Leave_Request (อนุมัติ) → `leave_YYYY-MM.csv` บน SharePoint (ป้อน generator)
- **Import:** `pas_duty_roster.csv` / `pas_flight_int.csv` บน SharePoint → Dataverse (**upsert**)

---

## A · Export วันลา → CSV (Power Automate)

**สร้าง:** make.powerautomate.com → Create → **Scheduled cloud flow** (รันก่อนสร้าง roster เดือนถัดไป เช่น ทุกวันที่ 25)

1. **Recurrence** — 1 เดือน/ครั้ง (วันที่ 25)
2. **Compose `nextYM`**: `@{formatDateTime(addToTime(utcNow(),1,'Month'),'yyyy-MM')}`
3. **List rows** (Dataverse) — table **PAS Leave Request**
   - Filter rows: `statuscode eq 1`  *(หรือ `pas_status eq 'APPROVED'` ตามชนิดฟิลด์)*
   - (กรองเดือนถัดไปใน Filter array ขั้นถัดไปก็ได้)
4. **Select** — From = `value` · Map (Text mode):
   ```json
   {
     "EmpCode": "@{item()?['pas_empcode']}",
     "LeaveDate": "@{formatDateTime(item()?['pas_leavedate'],'yyyy-MM-dd')}",
     "LeaveType": "@{item()?['pas_leavetype']}"
   }
   ```
5. **Filter array** — keep `@{startsWith(item()?['LeaveDate'], outputs('nextYM'))}`
6. **Create CSV table** — From = output ของ Filter array · Columns = Automatic
7. **SharePoint – Create file**
   - Folder: `.../00.RosterImport`
   - File Name: `leave_@{outputs('nextYM')}.csv`
   - File Content: `@{body('Create_CSV_table')}`
8. Save

---

## B · Import CSV → Dataverse (แนะนำ: Dataflow — parse CSV + upsert ในตัว)

> Power Automate ไม่มี parser CSV ในตัว (split เองเปราะ) → ใช้ **Dataflow (Power Query)** ลื่นกว่า + upsert ด้วย alternate key

### สร้าง Dataflow (ทำครั้งเดียว ต่อไฟล์)
make.powerapps.com → **Dataflows → + New dataflow** → ตั้งชื่อ `Import PAS Duty`

1. **Get data → SharePoint folder** (หรือ Text/CSV + path SharePoint)
   - ใส่ Site URL → เลือกโฟลเดอร์ `00.RosterImport`
2. **Combine/Transform** → เลือกไฟล์ `pas_duty_roster.csv` → **Transform data**
   - ตรวจ delimiter = comma · **Use first row as headers**
   - ตั้งชนิดคอลัมน์: `pas_work_date` = Date · `pas_shift_start/end`,`pas_ot_hours` = number · ที่เหลือ Text
3. **Map to tables (Load)** → **Load to existing table** = **PAS Duty**
4. **Column mapping:**
   | คอลัมน์ไฟล์ | ฟิลด์ Dataverse |
   |---|---|
   | pas_name | Duty (Primary / **key**) |
   | pas_work_date | Work Date |
   | EmpCode(pas_employee) | **Employee** (lookup → Alternate key = Emp Code) |
   | Team(pas_team) | **Team** (lookup → Team Code) |
   | pas_bucket | Bucket (choice) |
   | pas_shift_code / start / end | ตามชื่อ |
   | pas_ot_hours | OT Hours |
5. **Key column (upsert):** เลือก **pas_name** เป็น Alternate key → แถวที่ตรง = **อัปเดต**, ไม่ตรง = เพิ่ม
6. **Refresh settings → Schedule:** รายเดือน (หรือ manual) → **Publish**

> ทำ Dataflow อีกตัว `Import PAS Flight` → ไฟล์ `pas_flight_int.csv` → table **PAS Flight** · key = `pas_flightkey`

### ให้ "แก้มือ" ไม่ถูกทับ
ก่อน Load ใน Power Query เพิ่มขั้นกรองออก: ไม่ import แถวที่ Dataverse มี `pas_status in (ADDED,CHANGED)` หรือ duty ที่ `swapped` แล้ว
(ง่ายกว่า: import ลง **ตาราง staging** แล้ว flow เทียบก่อน upsert เฉพาะที่ไม่ถูกแก้มือ)

---

## C · ทางเลือก: Import ด้วย Power Automate ล้วน (CSV ง่าย ๆ)
ถ้าไม่ใช้ Dataflow:
1. **When a file is created** (SharePoint `00.RosterImport`)
2. **Get file content**
3. **Compose** `rows` = `@{split(replace(body('Get_file_content'),decodeUriComponent('%0D'),''),decodeUriComponent('%0A'))}`  *(แยกบรรทัด)*
4. **Apply to each** `@{skip(outputs('Compose_rows'),1)}` (ข้ามหัว)
   - **Compose cols** = `@{split(items('Apply_to_each'),',')}`
   - **Dataverse – Add/Upsert a new row** (PAS Duty): map `pas_name = outputs('Compose_cols')[0]`, `pas_work_date = ...[1]`, ... · Row ID/key = pas_name
> เปราะถ้าข้อมูลมี comma ในค่า — roster CSV ไม่มี comma จึงพอใช้ได้ · แต่ **Dataflow (B) นิ่งกว่า แนะนำ**

---

## ลำดับรันจริงต่อเดือน
```
วันที่ 25: flow A → leave_<next>.csv
สิ้นเดือน:  run_month.sh (อ่าน master+registry+leave + --prev ROSTER เดือนนี้) → CSV ขึ้น SharePoint
             → Dataflow B refresh → Dataverse อัปเดต → เดือนหน้าพร้อมในแอป (ต่อรอบ 4-หยุด-2 จากเดือนนี้)
```
