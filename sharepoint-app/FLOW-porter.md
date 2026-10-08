# Flow E — Porter Summary + Pre-Wheelchair → SharePoint Lists

| ไฟล์ (1 ไฟล์/เดือน · 1 แท็บ/วัน เช่น `08OCT26`) | List ปลายทาง |
|---|---|
| `2026 PORTER SUMMARY / <MON YYYY> PORTER SUMMARY.xlsx` | `PAS_Porter` (เคส) + `PAS_PorterStaff` (เคสต่อพอตเตอร์ จาก STAFF RECORD) |
| `Pre case wheelchair / <MON YYYY> / <MON YYYY> PRE-WHEELCHAIR.xlsx` | `PAS_PreWC` (ยอดจอง ไฟลท์ × ขาเข้า/ออก × WCHR/WCHS/WCHC/AVIH/MAAS) |

สคริปต์ `import-porter.ts` อ่านด้วยกติกาเดียวกับ `Porter.gs` / `PreWheelchair.gs` เดิม · แยกชนิดไฟล์จากชื่อเอง
ไฟล์ถูกแก้ทั้งเดือน → อ่าน **ทุกแท็บ** แล้วเขียน **เฉพาะแถวที่เปลี่ยน** (เพิ่ม/แก้/ลบ) — รันซ้ำกี่ครั้งก็ไม่ซ้ำ ไม่เปลืองโควตา
**เดือนใหม่/ปีใหม่:** สร้างไฟล์เดือนใหม่ตามแบบเดิม → flow เห็นเอง (ดูไฟล์ที่ถูกแก้ ไม่ผูกชื่อเดือน)

## ⚠️ ตำแหน่งไฟล์ (ควรทำก่อน)
ตอนนี้ 2 โฟลเดอร์อยู่ใน **OneDrive ส่วนตัว** ของ `hktlp_aotga_com` (`aotgath-my.sharepoint.com/personal/…`)
- ถ้าบัญชีนั้นถูกปิด/ย้าย → OneDrive ถูกลบตามนโยบาย และ flow หยุด
- **แนะนำ:** ย้าย 2 โฟลเดอร์ไปไว้ในไซต์ HKT PSA Daily เช่น `Shared Documents/Porter/2026 PORTER SUMMARY` และ `Shared Documents/Porter/Pre case wheelchair`
  (OneDrive → เลือกโฟลเดอร์ → **Move to** → ไซต์ HKT PSA Daily) — ทีม LP ทำงานในไฟล์เดิมได้ตามปกติ ลิงก์เดิมจะเปลี่ยน
- ถ้ายังย้ายไม่ได้ ใช้ที่เดิมได้ — ใส่ Site Address ด้านล่างเป็น `https://aotgath-my.sharepoint.com/personal/hktlp_aotga_com`
  (คนสร้าง flow ต้องได้รับแชร์ 2 โฟลเดอร์นั้นแบบ **แก้ไขได้** เพื่อให้ Run script เปิดไฟล์ได้)

> ถ้าย้ายเข้าไซต์ HKT PSA Daily แล้ว: Flow A จะเห็นไฟล์ด้วยแต่ไม่เข้าเงื่อนไข (ไม่ได้อยู่ในโฟลเดอร์ปี `20xx`) — ไม่ชนกัน

## ก่อนเริ่ม
1. รัน `provision-lists.js` ล่าสุดซ้ำ 1 ครั้ง (เพิ่มคอลัมน์ `PAS_Porter`/`PAS_PreWC` + List `PAS_PorterStaff`)
2. เปิดไฟล์ Porter Summary เดือนปัจจุบันใน Excel บนเว็บ → `Automate → New Script` → วาง `import-porter.ts` → Save ชื่อ **`import-porter`**
3. **ทดสอบ**: กด Run · `filePath` = ชื่อไฟล์ (เช่น `OCT 2026 PORTER SUMMARY.xlsx`) · `mode` = `sync` · ช่องอื่นว่าง
   → ดู `counts` (days / rows) เทียบกับจำนวนแท็บและเคสในไฟล์ · ทำซ้ำกับไฟล์ PRE-WHEELCHAIR
   (กด Run เองแค่คืนค่า ไม่เขียนลง List)

## สร้าง Flow
**Scheduled cloud flow** `PAS · E Sync Porter & Pre-WC` · ทุก **30 นาที** · Concurrency **1**

1. **SharePoint — Get files (properties only)** — Site Address = ที่อยู่ไฟล์ (ดูหัวข้อตำแหน่งไฟล์) · Library = `Documents`
   · Limit Entries to Folder = โฟลเดอร์ `2026 PORTER SUMMARY` · Include Nested Items = Yes
   · Filter Query: `Modified ge '@{addMinutes(utcNow(), -40)}' and Modified lt '@{addMinutes(utcNow(), -10)}'`
   (ไฟล์ที่แก้ล่าสุด และนิ่งแล้ว ≥10 นาที — รอบละ 30 นาทีพอดีช่อง ไม่ตกหล่น/ไม่ซ้ำ)
2. ทำข้อ 1 อีกชุดกับโฟลเดอร์ `Pre case wheelchair` → **Compose `Files`** = `union(body('Get_files')?['value'], body('Get_files_2')?['value'])`
3. **Apply to each** `outputs('Files')` (Concurrency 1) — ข้ามไฟล์ที่ไม่ใช่ `.xlsx` ด้วย Condition `endsWith(toLower(items('Apply_to_each')?['{FilenameWithExtension}']), '.xlsx')`
   1. **Run script** `Info` — Location = Site เดียวกับข้อ 1 · File = `{Identifier}` · Script `import-porter`
      · filePath = `{FilenameWithExtension}` · mode = `info`
   2. **Compose `I`** = `outputs('Info')?['body/result']` → Condition `outputs('I')?['status']` = `ok` (ไม่ใช่ → ข้ามไฟล์)
   3. **ดึงแถวเดิมของเดือน** (ไซต์ HKT PSA Daily) — ทำทุก List ใน `outputs('I')?['lists']`:
      - Porter: **Get items** `PAS_Porter` + **Get items** `PAS_PorterStaff` · Filter Query `month_key eq '@{outputs('I')?['month_key']}'` · Top 5000 · Pagination On (20000)
      - Pre-WC: **Get items** `PAS_PreWC` (Filter เดียวกัน)
      - **Select** แต่ละชุด: `ID` = `item()?['ID']` · `Title` = `item()?['Title']` · `row_hash` = `item()?['row_hash']` · `day_key` = `item()?['day_key']`
      - **Compose `Existing`**:
        Porter → `{"PAS_Porter": @{body('Select_Porter')}, "PAS_PorterStaff": @{body('Select_Staff')}}`
        Pre-WC → `{"PAS_PreWC": @{body('Select_PreWC')}}`
        (ใช้ **Condition** `outputs('I')?['kind']` = `PORTER` แยก 2 ทาง หรือ Switch)
   4. **Run script** `Sync` — ไฟล์เดียวกัน · mode = `sync` · filePath = `{FilenameWithExtension}` · existing = `@{string(outputs('Existing'))}`
   5. **Apply to each** `outputs('Sync')?['body/result/batches']` → **Send an HTTP request to SharePoint**
      — Site = **HKT PSA Daily** · POST · `_api/$batch` · Headers/ Body เหมือน Flow B (`boundary` / `body` ของก้อน)
      · ตรวจ `HTTP/1.1 4`/`5` ใน response → Terminate Failed
   6. **Create item** `PAS_ImportLog` — Title = `{FilenameWithExtension}` · kind = `outputs('I')?['kind']` · status `Done`
      · day_key = `outputs('I')?['month_key']` · message = `@{string(outputs('Sync')?['body/result/counts'])}`

**ครั้งแรก / ย้อนหลัง:** กด **Run** flow นี้หลังเปลี่ยน Filter Query ในข้อ 1 เป็นว่างชั่วคราว (= ทุกไฟล์) → นำเข้าทุกเดือนที่มี → แล้วใส่ Filter กลับ

## ทดสอบ
1. Run ครั้งแรก → `PAS_Porter` มีเคสของทุกวันในเดือน · `PAS_ImportLog` แถว kind PORTER/PREWC = Done
2. ทีม LP เพิ่มเคสใหม่ในแท็บวันนี้ → ภายใน ~40 นาที เคสโผล่ใน List · `message` แสดง `"created":1`
3. Run ซ้ำโดยไม่มีการแก้ → `counts.unchanged` = ทั้งหมด · ไม่มีคำสั่งเขียน
