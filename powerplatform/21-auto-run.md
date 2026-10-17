# 21 · auto-run รายเดือน — สร้าง roster/flight เดือนถัดไป + import อัตโนมัติ

3 ส่วน: (A) สร้าง CSV เดือนถัดไป · (B) flow import อัตโนมัติ · (C) flow export วันลา ป้อนกลับ

## A · สร้าง CSV เดือนถัดไป (generator)
รันบนเครื่อง/เซิร์ฟเวอร์ (มี Python + openpyxl) — คำสั่งเดียว:
```bash
tools/run_month.sh  HKT_Winter_Turnaround_Master.xlsx  OT_Passenger_Service.xlsx  2026-12  ./out  leave_2026-12.csv
```
ได้ `./out/dataverse/`: **pas_duty_roster.csv · pas_flight_int.csv · pas_team_position.csv · team_airline_map.csv**
- `--leave` (ไฟล์สุดท้าย) = คนที่ลาอนุมัติแล้วเดือนนั้น → generator ลงรหัสลาแทนการจัดงาน
- roster เป็น **4-หยุด-2** ต่อเนื่อง · กลบวันขาดด้วยบันได OT · ถูกกฎ 36 ชม./สัปดาห์

**ตั้งให้รันเองทุกสิ้นเดือน:** Windows **Task Scheduler** (หรือ cron) → เรียก `run_month.sh` แล้ว **อัปไฟล์ขึ้น SharePoint** โฟลเดอร์ `00.RosterImport/`

## B · Flow import อัตโนมัติ (SharePoint → Dataverse upsert)
Power Automate:
1. **Trigger:** SharePoint **When a file is created** (โฟลเดอร์ `00.RosterImport/`)
2. **Condition** ชื่อไฟล์:
   - `pas_duty_roster.csv` → import เข้า **PAS Duty** (upsert ด้วย alternate key `pas_name`)
   - `pas_flight_int.csv` → **PAS Flight** (upsert ด้วย `pas_flightkey`)
3. **แปลง CSV → แถว:** Get file content → **Parse** (ใช้ `Create CSV`/คอนเนกเตอร์ parse หรือ Office Script อ่าน CSV) → **Apply to each** → Dataverse **Add a new row (Upsert)** map ตามคอลัมน์
   - lookup: `pas_employee` จับด้วย Emp Code · `pas_team` จับด้วย Team Code
4. (ทางง่ายกว่า) ใช้ **Dataverse dataflow** (Power Query) ตั้ง schedule รายเดือน ชี้ไฟล์ SharePoint → map + **upsert** by key — ไม่ต้องเขียน loop

> เพราะตั้ง **Alternate key** ไว้ (`pas_name` ของ Duty, `pas_flightkey` ของ Flight) → import ทับ = อัปเดตแถวเดิม/เพิ่มใหม่ ไม่ซ้ำ
> ไฟลท์/เวรที่ **แก้มือ** (status ADDED/CHANGED, แลกเวร) — ให้ flow **ข้ามถ้ามีการแก้มือ** (เช็ก field) เพื่อไม่ทับงานที่จัดแล้ว

## C · Flow export วันลา → ป้อนกลับ generator
ก่อนรันเดือนถัดไป ต้องมี `leave_YYYY-MM.csv`:
1. Power Automate (หรือมือ): **List rows** `PAS_Leave_Request` where `Status = APPROVED` และ `LeaveDate` อยู่ในเดือนถัดไป
2. **Select** → `{ EmpCode, LeaveDate (yyyy-mm-dd), LeaveType }`
3. **Create CSV table** → บันทึกเป็น `leave_YYYY-MM.csv` บน SharePoint (โฟลเดอร์เดียวกับ master)
4. `run_month.sh` อ่านไฟล์นี้ด้วย `--leave`

## ลำดับอัตโนมัติทั้งหมด (ทุกสิ้นเดือน)
```
1. flow export วันลาอนุมัติ → leave_<next>.csv ขึ้น SharePoint
2. Task Scheduler รัน run_month.sh (อ่าน master + registry + leave) → CSV ขึ้น SharePoint
3. flow import (B) เห็นไฟล์ใหม่ → upsert เข้า Dataverse
4. เปิดแอป → เดือนถัดไปมีตารางเวร + ไฟลท์พร้อม (ซุปปรับ/แลกเวร/ลง assignment ต่อ)
```

## หมายเหตุ
- ตัว generator ต้องรันที่ที่มีไฟล์ master/registry — ถ้าอยากไม่ใช้เครื่อง on-prem ใช้ **Azure Function / GitHub Action** รัน Python แล้วอัป SharePoint ผ่าน Graph ได้ (ต้องมีสิทธิ์)
- master ตารางบิน (ฤดู) เปลี่ยนไม่บ่อย — อัปเดตเมื่อมีตารางบินใหม่ · registry sync จาก HR
- ครั้งแรกแนะนำรัน **มือ** 1 รอบ ดูผลก่อนตั้ง schedule
