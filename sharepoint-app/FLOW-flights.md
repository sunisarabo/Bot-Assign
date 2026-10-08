# Flow F — ตารางบินรายวัน → `PAS_Flights`

ไฟล์: **Daily Flight Schedule Record 2026.xlsx** (OneDrive ของ `hktopsocc_aotga_com1` · `0. Workspace/2026/`) — 1 แท็บ/วัน
สคริปต์ `import-flights.ts` อ่านแบบเดียวกับ `WeeklyFlight.gs` (หาหัว Airlines / Flt no. / STA / STD / A/C TYPE / Remarks / Routing เอง)
→ ได้ไฟลท์ต่อวัน + ชนิดเครื่อง (แปลงเป็นชื่อ SLA เช่น A21N → A321Neo) + ขา ARR/DEP/TURN + ยกเลิก (Remarks มีคำว่า CANCEL)
ใช้กับหน้า **Flights & SLA · ไฟลท์สัปดาห์ · Auto Assign**

ไฟล์ทั้งปีมีหลายร้อยแท็บ → แต่ละรอบอ่านเฉพาะ **ย้อน 3 วัน ถึง ล่วงหน้า 14 วัน** (ตั้ง `fromDay`/`toDay` เองได้ตอนย้อนหลัง)
เขียนเฉพาะไฟลท์ที่เพิ่ม/แก้/หาย — รันซ้ำไม่ซ้ำ

**ปีใหม่:** ไฟล์ปีใหม่ (เช่น `…Record 2027.xlsx`) → เปลี่ยนไฟล์ในข้อ 1 และ 3 ของ flow ครั้งเดียว (ปีอ่านจากชื่อไฟล์)

## ⚠️ ตำแหน่งไฟล์
อยู่ใน **OneDrive ส่วนตัว** ของ OPS OCC — แนะนำขอให้ OCC **แชร์ไฟล์ให้บัญชีที่สร้าง flow แบบ "แก้ไขได้"** (Run script ต้องเปิดไฟล์ได้)
หรือดีกว่า: ย้าย/คัดลอกไปไซต์ทีม (ถ้า OCC ยอม) · Site Address สำหรับที่เดิม = `https://aotgath-my.sharepoint.com/personal/hktopsocc_aotga_com1`

## ก่อนเริ่ม
1. รัน `provision-lists.js` ล่าสุดซ้ำ (เพิ่มคอลัมน์ `PAS_Flights`)
2. เปิดไฟล์ตารางบินใน Excel บนเว็บ → `Automate → New Script` → วาง `import-flights.ts` → Save ชื่อ **`import-flights`**
3. **ทดสอบ**: Run · `filePath` = `Daily Flight Schedule Record 2026.xlsx` · `mode` = `sync` · ช่องอื่นว่าง
   → ดู `days` (ควรได้ ~18 วัน), `counts.rows` (ไฟลท์รวม), `warnings` (แท็บที่หาหัวตารางไม่เจอ) — ส่งผลมาให้ตรวจ

## สร้าง Flow
**Scheduled cloud flow** `PAS · F Sync flights` · ทุก **30 นาที** · Concurrency 1
1. **SharePoint — Get file metadata using path** — Site = OneDrive OCC (ด้านบน) · File Path = ไฟล์ตารางบิน
2. **Condition** (แก้ไฟล์แล้วนิ่ง ≥10 นาที **หรือ** รอบตี 5 ทุกวันเพื่อเลื่อนช่วงวัน):
   ```
   @or(and(greater(ticks(body('Get_file_metadata_using_path')?['LastModified']), ticks(addMinutes(utcNow(), -40))), less(ticks(body('Get_file_metadata_using_path')?['LastModified']), ticks(addMinutes(utcNow(), -10)))), and(equals(int(formatDateTime(utcNow(), 'HH')), 22), less(int(formatDateTime(utcNow(), 'mm')), 30)))
   ```
   (22:00 UTC = 05:00 เวลาไทย) · **No** → จบ
3. **Run script `Info`** — Location = OneDrive OCC · File = ไฟล์ตารางบิน · Script `import-flights` · filePath = `@{body('Get_file_metadata_using_path')?['Name']}` · mode = `info`
4. **Initialize variable** `Old` (Array) = `[]`
5. **Apply to each** `outputs('Info')?['body/result/month_keys']` (1–2 เดือน):
   **Get items** `PAS_Flights` (ไซต์ HKT PSA Daily) · Filter Query `month_key eq '@{items('Apply_to_each')}'` · Top 5000 · Pagination On
   → **Select** (`ID`, `Title`, `row_hash`, `day_key`) → **Set variable** `Old` = `union(variables('Old'), body('Select'))`
6. **Run script `Sync`** — ไฟล์เดียวกัน · mode = `sync` · filePath เดิม · existing = `{"PAS_Flights": @{variables('Old')}}`
7. **Apply to each** `outputs('Sync')?['body/result/batches']` → **Send an HTTP request to SharePoint** (ไซต์ HKT PSA Daily · POST · `_api/$batch` · เหมือน Flow B) · ตรวจ `HTTP/1.1 4`/`5`
8. **Create item** `PAS_ImportLog` — Title = ชื่อไฟล์ · kind `FLIGHTS` · status `Done` · message = `@{string(outputs('Sync')?['body/result/counts'])} @{join(outputs('Sync')?['body/result/warnings'], ' | ')}`

**ย้อนหลังครั้งแรก:** กด Run script `Sync` เอง (ใน Excel) ไม่ได้เพราะไม่เขียน List → ให้ทำ flow สำเนา "Run แบบกำหนดช่วง" (Instant) ที่ส่ง `fromDay` = `2026-01-01`, `toDay` = `2026-03-31` แล้วทำทีละไตรมาส (กันเกินเวลา 2 นาทีของ Office Script)

## ตรวจ
- `PAS_Flights` วันนี้ → จำนวนไฟลท์ = จำนวนแถวไฟลท์ในแท็บวันนี้ · ไฟลท์ที่ Remarks = Cancelled → `cancelled` = Yes
- เทียบหน้า "ไฟลท์สัปดาห์" ของ PAS เดิม (จำนวนไฟลท์/วัน) กับ `PAS_Flights` ของสัปดาห์เดียวกัน
