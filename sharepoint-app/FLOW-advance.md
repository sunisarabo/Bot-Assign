# Flow G — จัดล่วงหน้า → `PAS_AdvPlan` + `PAS_AdvRoster`

แทน `AdvancePlan.gs` (ของเดิมอ่าน Google Sheet 3 ไฟล์สด ๆ) โดยเปลี่ยนแหล่งข้อมูลเป็นของ Microsoft:

| ของเดิม (Google) | ใหม่ (Microsoft) |
|---|---|
| ROSTER ล่วงหน้า (Google Sheet `1varvj0x…`) | **ไฟล์ Excel ROSTER** บน SharePoint ← ต้องย้ายไฟล์นี้ก่อน Google ปิด (ดูด้านล่าง) |
| ตารางบิน (Summary Weekly Flight / Flight Schedule) | `PAS_Flights` (Flow F · ล่วงหน้า 14 วัน) |
| รายชื่อพนักงาน ชีต Total | `PAS_Employees` (Flow D) |

สคริปต์ `import-advroster.ts` สร้างจาก `import-roster.ts` ด้วย `node build.js` จึงใช้เครื่องคำนวณ SLA และ Auto Assign ชุดเดียวกัน
> **ตรวจแล้วว่าตรงกับของเดิม:** `test/advance-parity.test.js` รัน `AdvancePlan.gs` ตัวจริงคู่กับตัวใหม่ → **ตรง 9/9 ไฟลท์** ทุกบทบาท ทั้งคนที่จัด จำนวนที่ขาด และคนที่ให้ OT คลุมได้
> รวมถึงอ่านบล็อก ROSTER (ข้ามบล็อกเดือนอื่น · คน OFF/ช่องว่าง · คนลาออก · กะข้ามเที่ยงคืน)

## ⚠️ ทำก่อน Google ปิด: ย้ายไฟล์ ROSTER ล่วงหน้า
1. เปิด Google Sheet ROSTER ล่วงหน้า → **File → Download → Microsoft Excel (.xlsx)**
2. อัปโหลดไปที่ไซต์ เช่น `Shared Documents/00.Roster/ROSTER 2026.xlsx` (**อย่า** วางในโฟลเดอร์ปี `2026/…` เพราะ Flow A จะเข้าใจว่าเป็นไฟล์เวรรายวัน)
3. หลังจากนี้ให้แก้กะล่วงหน้าที่ไฟล์ Excel นี้แทน (Excel บนเว็บแก้พร้อมกันหลายคนได้)

รูปแบบที่อ่านได้ (เหมือนเดิม) — มีหลายบล็อกต่อแท็บ และหลายแท็บได้:
```
OCTOBER 2026 /SQ CX LY | POS | ID | NAME | SURNAME | 1/TIME | CODE | HR | OT | OTHR | REMARK | 2/TIME | CODE | …
                       | PSA | 2600003 | Somchai | K. | 06:00-15:00 | F9 | … | OFF | …
```
- แถวหัวบล็อก = มีคอลัมน์ลงท้าย **TIME** ตามด้วย **CODE** (เลขวันอยู่ในหัวเอง หรืออยู่แถวเหนือขึ้นไปไม่เกิน 3 แถว)
- ชื่อบล็อก (มีปี ค.ศ.) บอกเดือนและสายการบิน · ช่อง TIME = `HH:MM-HH:MM` · `OFF` / `X` / `VL` / `SL` / `ลา` / ว่าง = ไม่มา
- ทีม ตำแหน่ง และสถานะลาออก เอามาจาก `PAS_Employees` ก่อน (ไม่มีจึงใช้ค่าจากบล็อก)

## ก่อนเริ่ม
1. `node build.js` (ทำไว้ให้แล้ว) → ได้ `import-advroster.ts`
2. รัน `provision-lists.js` ล่าสุด → สร้าง `PAS_AdvPlan`, `PAS_AdvRoster`
3. เปิดไฟล์ ROSTER ใน Excel บนเว็บ → `Automate → New Script` → วาง `import-advroster.ts` → Save ชื่อ **`import-advroster`**
4. **ทดสอบใน Excel:** Run · fromDay = วันพรุ่งนี้ (`2026-10-09`) · ช่องอื่นว่าง → ดู `counts.people` (คนขึ้นเวรที่อ่านได้) และ `counts.no_roster` (0 = เจอบล็อกของวันนั้น)
   ส่งค่า `counts` มาให้ตรวจได้ ถ้า `people = 0` แปลว่าหัวบล็อกต่างจากที่อธิบายไว้ด้านบน

## สร้าง Flow
**Instant cloud flow** `PAS · G Advance plan` — trigger **PowerApps (V2)** · input ข้อความ `fromDay`, `toDay`
(เพิ่ม trigger ที่ 2 ไม่ได้ → ทำ **Scheduled flow สำเนา** ทุกวัน 05:15 · fromDay = `@{formatDateTime(addHours(utcNow(),7),'yyyy-MM-dd')}` · toDay = `@{formatDateTime(addDays(addHours(utcNow(),7),7),'yyyy-MM-dd')}`)
Settings → Concurrency 1

1. **Get items** `PAS_Flights` · Filter Query `day_key ge '@{triggerBody()?['text']}' and day_key le '@{triggerBody()?['text_1']}'` · Top 5000 · Pagination On
   → **Select `Flts`**: `day_key`, `flight_no`, `sta`, `std`, `aircraft_type`, `ac_raw`, `cancelled`
2. **Get items** `PAS_Employees` · Top 5000 · Pagination On → **Select `Emps`**: `Title`, `team`, `position`, `name_en`, `name_th`, `status`
3. **Get items** `PAS_SLARules` → **Select `RuleRows`** (เหมือน Flow B ข้อ 1c)
4. **Run script** — Location: Site · Library: `Documents` · File: ไฟล์ ROSTER · Script **`import-advroster`**
   · fromDay / toDay = จาก trigger · flights = `string(body('Flts'))` · emps = `string(body('Emps'))` · rules = `string(body('RuleRows'))`
5. **Compose `R`** = `outputs('Run_script')?['body/result']` · Condition `status` = `ok` (No → Create item `PAS_ImportLog` status `Skipped` + reason)
6. **ลบแผนเดิมของช่วงวันนั้น** — ทำ 2 รอบ (`PAS_AdvPlan`, `PAS_AdvRoster`) เหมือน Flow B ข้อ a.
   แต่ใช้ Filter Query `day_key ge '@{outputs('R')?['from']}' and day_key le '@{outputs('R')?['to']}'`
7. **Apply to each** `outputs('R')?['batches']` (Concurrency 1) → **Send an HTTP request to SharePoint** (POST `_api/$batch` เหมือน Flow B)
8. **Create item** `PAS_ImportLog` — kind `ADVPLAN` · status `Done` · message = `@{string(outputs('R')?['counts'])}`
9. **Respond to a PowerApp or flow** — ข้อความ `done` = `@{string(outputs('R')?['counts'])}`

**ขนาดงาน:** 1 วัน ≈ ไฟลท์ 150 แถว + คน 250 แถว = ~4 batch · 7 วัน ≈ 28 batch ต่อรอบ (ไม่เกินโควตา 6,000 request/วัน)
ถ้า Office Script เกินเวลา (มากกว่า 2 นาที) ให้ลดช่วงวันลงเหลือ 3–4 วันต่อรอบ

## ยังไม่ได้ทำ (เทียบกับของเดิม)
> อีเมลเตือน "ทีมยังไม่กรอก assignment ล่วงหน้า" ย้ายไปทำแล้วที่ `FLOW-notify.md` (Flow I)

- **Common check-in รายกรณี (AOG/ไฟลท์ทับ)** — ของเดิมปิดค่าเริ่มต้นไว้ และเปิดผ่าน cache ทีละวัน
- ไฟลท์ของวันที่ยังไม่มีใน `PAS_Flights` (เกิน 14 วัน) → ของเดิมดึงจากไฟล์ assignment แทน ส่วนของใหม่จะได้ 0 ไฟลท์ (ดู `counts.no_flights`)
