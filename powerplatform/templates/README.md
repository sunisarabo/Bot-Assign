# Template นำเข้า (หัวคอลัมน์ตายตัว) — route ถาวรบน Microsoft

CSV หัวคอลัมน์**ตายตัว** 1 ไฟล์/ตาราง สำหรับ route ถาวร (เลิก Apps Script parser):
เปิดใน Excel → เก็บบน **SharePoint/OneDrive** → Power Automate อ่านตรง ๆ แล้ว upsert เข้า Dataverse

> ต่างจากไฟล์รายวันเดิม (`05-import-source.md`) ที่ layout ไม่นิ่ง/หลายทีม/header-driven
> ตัวนี้ **1 ชีต หัวคอลัมน์คงที่** → flow แมปตรงคอลัมน์ได้ ไม่ต้องเดา

| ไฟล์ | ตาราง Dataverse | คีย์ upsert (Alt Key) |
|---|---|---|
| `manpower.csv`   | `pas_manpower`   | (work_date, team) |
| `duty.csv`       | `pas_duty`       | (work_date, emp_code, team) |
| `assignment.csv` | `pas_assignment` | ผูก duty ด้วย (work_date, emp_code, team) |
| `flight.csv`     | `pas_flight`     | (flight_date, flight_no, direction) |
| `porter.csv`     | `pas_porter_job` | (work_date, flight_no, service) |
| `prewc.csv`      | `pas_prewc`      | (work_date, flight_no, direction, service) |

## กติกาค่าข้อมูล
- **วันที่:** `YYYY-MM-DD` (เช่น 2026-09-19)
- **เวลา** (shift_start/end, sta/std, counter_open/close, pickup/delivered): กรอกแบบ **HH:MM** (เช่น 06:00)
  → flow/Office Script แปลงเป็น **นาที** ตอนเขียนลง Dataverse (schema เก็บเป็น Whole Number นาที)
- **bucket:** WORKING / OT_OFF / OFF / SICK / VACATION / LEAVE / TRAINING
- **direction:** ARR / DEP / TURN · **service:** WCHR / WCHS / WCHC / MAAS / AVIH / ETC
- **Yes/No:** TRUE / FALSE
- **team / emp_code:** ต้องมีใน `pas_team` / `pas_employee` อยู่แล้ว (ใส่ master ก่อน) ไม่งั้น flow สร้าง stub

## วิธีใช้กับ Power Automate
1. วางไฟล์ (แปลงเป็นตาราง Excel — Insert → Table) บน SharePoint
2. Flow: **List rows present in a table** → **Apply to each** → แปลงเวลา HH:MM→นาที (Office Script/expression)
   → **Add or update row (Dataverse)** ด้วย Alternate Key ของตารางนั้น (idempotent)
3. ดูสูตรแปลงเวลาและตัวอย่าง flow ใน `../03-power-automate.md`

> แต่ละไฟล์มี 1 แถวตัวอย่าง — ลบออกก่อนใช้จริง หรือใช้เป็นแนวกรอก
