# 03 · Power Automate (flow)

## Flow A — นำเข้าข้อมูลรายวันเข้า Dataverse (idempotent ด้วย Alternate Key)

**Trigger:** เลือกอย่างใดอย่างหนึ่ง
- *Recurrence* ทุกวันตี 1 (ดึงของเมื่อวาน) — เทียบ cron ของฝั่ง Postgres
- หรือ *When a file is created/modified* ใน SharePoint/OneDrive (โฟลเดอร์ที่วางไฟล์ roster/summary)

**ขั้นตอน (ตัวอย่าง duty จากตาราง Excel บน SharePoint):**
1. **List rows present in a table** (Excel Online) — ตาราง roster ของวันนั้น
2. **Apply to each** แถว →
   - **Compose** แปลงเวลาเป็นนาที (ถ้า Excel เก็บ "06:00"):
     ```
     shift_start_min = int(substring(item()?['Shift Start'],0,2))*60 + int(substring(item()?['Shift Start'],3,2))
     ```
   - **Add a new row / Update a row (Dataverse)** — ใช้ **Alternate Key**
     `(pas_work_date, pas_employee, pas_team, pas_is_support)` เพื่อ **upsert** (สร้างใหม่ถ้ายังไม่มี, ทับถ้ามี)
     → ทำให้รันซ้ำได้ปลอดภัย (เหมือน importer ที่ลบก่อน insert)
3. ทำซ้ำชุดเดียวกันกับ flight / porter / pre-WC / manpower (คนละตาราง/คนละ source)

> ถ้าต้นทางเป็น **JSON** (เช่นสะพานช่วงเปลี่ยนผ่านจาก `rbSaveAllDay`): ใช้ **Parse JSON** แล้ว Apply to each เหมือนกัน

### (ทางเลือก) คำนวณ Util ตอนนำเข้า — เก็บ `pas_duty_min` / `pas_busy_min` ใน Duty
หลังใส่ assignment ของ duty ครบแล้ว:
- `pas_duty_min` = `if(shift_end<=shift_start, shift_end+1440, shift_end) - shift_start`
- `pas_busy_min` (ประมาณ) = ผลรวม `(hi-lo)` ของทุก assignment window
  โดย window ต่อ assignment คำนวณแบบเดียวกับ `winOf` (เคาน์เตอร์ OP–CL / ขาออก std-60 / ขาเข้า sta+45)
  ```
  lo = if(and(not(empty(op)),not(empty(cl))), op, if(not(empty(std)), sub(std,60), if(not(empty(sta)), sta, op)))
  hi = if(and(not(empty(op)),not(empty(cl))), if(less(cl,op),add(cl,1440),cl), if(not(empty(std)), std, if(not(empty(sta)), add(sta,45), add(op,45))))
  ```
  > flow คำนวณผลรวมช่วงแบบ "ไม่หักซ้อน" (พอสำหรับ KPI) · ถ้าต้องการ **merge ช่วงซ้อนแบบเป๊ะ** ใช้
  > **Office Script** (Excel/JS) หรือ Azure Function เรียกจาก flow แล้วเก็บผลกลับ (ตรรกะเดียวกับ `productivity.js`)

## Flow B — แจ้งเตือนอีเมล (Microsoft 365 — ไม่ต้องตั้ง SMTP)
Power Platform ใช้ **connector Office 365 Outlook** ในตัว (ล็อกอิน Entra แล้วส่งได้เลย)
- Trigger: *Recurrence* / *When a row is added (Dataverse)* / เงื่อนไข SLA
- Action: **Send an email (V2)** — To/Subject/Body
  เช่นสรุป "ไฟลท์ต้องเสริมด่วน" หรือ "manpower ต่ำกว่าแผน" รายเช้า

## Flow C (ทางเลือก) — เตือนไฟลท์ขาด/SLA
- ทุก N นาที: List rows (Dataverse) ที่เข้าเงื่อนไข (เทียบตรรกะ SLA เดิม) → ส่ง Outlook / โพสต์ Teams

## สิทธิ์/ไลเซนส์
- flow ที่แตะ Dataverse = premium → ครอบด้วย Power Apps license ของ solution (ตรวจ use rights กับ IT)
- Office 365 Outlook / Teams connector = standard (มากับ M365)
