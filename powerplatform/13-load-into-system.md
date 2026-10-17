# 13 · นำ Flights + Roster เข้าระบบ (Dataverse → Power Apps)

จากสคริปต์ `tools/` ได้ CSV 3 ไฟล์ → import เข้า Dataverse แล้ว Power Apps อ่านได้เลย

| CSV | เข้าตาราง | มาจาก |
|---|---|---|
| `pas_flight_int.csv` | **pas_flight** | `build_int_roster.py --dataverse` |
| `pas_duty_roster.csv` | **pas_duty** | `build_roster.py --dataverse` |
| `team_airline_map.csv` | ตาราง mapping (ใหม่) | `build_int_roster.py --dataverse` |

---

## ขั้นเตรียม (ครั้งเดียว)
1. ตาราง `pas_flight` / `pas_duty` / `pas_employee` / `pas_team` สร้างแล้ว (ดู `01` / `create-tables.js`)
2. **นำเข้า master ก่อน**: `pas_employee` (รหัส=`pas_name`) และ `pas_team` (ชื่อทีม=`pas_name`)
   ต้องมีก่อน เพราะ duty/flight อ้าง lookup ด้วยค่าพวกนี้

## วิธี import (เลือกทางใดทางหนึ่ง)

### A. Import ด้วยไฟล์ (เร็วสุด สำหรับ one-shot)
make.powerapps.com → **Tables → pas_duty → Import → Import data from Excel/CSV**
- อัป `pas_duty_roster.csv`
- **Map columns:**
  | คอลัมน์ใน CSV | ฟิลด์ Dataverse |
  |---|---|
  | `pas_work_date` | `pas_work_date` (Date) |
  | `EmpCode(pas_employee)` | lookup **pas_employee** → จับด้วย `pas_name` (Emp Code) |
  | `pas_emp_name` | `pas_emp_name` |
  | `Team(pas_team)` | lookup **pas_team** → จับด้วย `pas_name` (Team Code) |
  | `pas_bucket` | choice `pas_bucket` (WORKING/OFF) |
  | `pas_shift_code` | `pas_shift_code` |
  | `pas_shift_start` / `pas_shift_end` | `pas_shift_start` / `pas_shift_end` (นาที) |
- ทำแบบเดียวกันกับ `pas_flight_int.csv` → ตาราง `pas_flight`
  (lookup ไม่มี — flight ผูกทีมผ่าน airline → ดู `team_airline_map` ด้านล่าง)

> **lookup ต้องตรง:** ถ้า import แล้วช่อง Employee/Team ว่าง = ค่าใน CSV ไม่ตรง `pas_name`
> ของ master (เช่นรหัสมีช่องว่าง/เลข 0 นำหน้า) — แก้ให้ตรงแล้ว import ใหม่

### B. Power Automate (อัตโนมัติรายเดือน)
Flow: **Recurrence (ต้นเดือน)** → อ่าน CSV/Excel ที่วางบน SharePoint → **List rows** →
**Apply to each** → `pas_duty` **Add a new row** (หรือ *Upsert* กันซ้ำด้วยคีย์ `work_date+emp`)
- เหมาะเมื่อจะรัน `build_roster.py` ทุกเดือนแล้ววางไฟล์อัตโนมัติ

### C. ไม่ใช้ Dataverse (ถ้าระบบอยู่บน Excel/SharePoint)
วาง `pas_duty_roster.csv` เป็นชีต/ลิสต์ แล้วให้หน้า Power Apps (`09-powerfx-mywork`) ชี้มาที่นั่นแทน
`pas_duties` — โครงคอลัมน์เหมือนกัน

---

## team ↔ airline (ให้ flight รู้ทีม)
`pas_flight` ไม่มีช่องทีม — จับทีมจาก airline ด้วย `team_airline_map.csv`:
- **ทางแนะนำ:** สร้างตารางเล็ก `pas_team_airline` (Team, Airline) import ไฟล์นี้ →
  ใน Power Apps: `LookUp(pas_team_airlines, Airline = ThisItem.pas_airline_iata).Team`
- หรือเติมคอลัมน์ `Team` ลง `pas_flight` ตอน import (คอลัมน์ `Team(helper)` มีให้แล้วใน CSV)

---

## หลัง import — Power Apps ใช้ได้ทันที
- **งานของฉัน / ตารางเวร** (`09`) อ่าน `pas_duties` filter `pas_work_date` → เห็นกะรายคน
- **Assignment รายไฟลท์** อ่าน `pas_flight` filter วัน + join ทีมจาก airline
- **ตรวจ OT ขอจริง** (`08`) ใช้ `pas_ot_hours` ใน `pas_duty` (roster นี้ยังไม่ใส่ OT — เติมภายหลังได้)

## ลำดับแนะนำ
1. master: `pas_employee`, `pas_team` (+ `pas_team_airline`)
2. `pas_flight_int.csv` → `pas_flight`
3. `pas_duty_roster.csv` → `pas_duty`
4. เปิด Power Apps → เลือกวัน → ตรวจว่า lookup ติดครบ
