# Flow H — OT ขอจริง (HumanSoft) → `PAS_OT_Request`

แทนการอ่าน Google Sheet ใน `OTCompare.gs` (ไฟล์ HumanSoft + ชีตแผน "วันที่ 7/8/9" ที่ต้องแก้วันที่ในโค้ดทุกครั้ง)
ของใหม่แบ่งเป็น 2 ฝั่ง:
- **ขอจริง** = ไฟล์ export จาก HumanSoft → `PAS_OT_Request` ด้วย flow นี้
- **แผน** = OT ที่กรอกในไฟล์เวรรายวัน (`PAS_OT_Person` — มีอยู่แล้วจาก Flow B) จึง **ไม่ต้องทำชีตแผนแยกอีก** และเทียบได้ทุกวัน ไม่ใช่แค่ 3 วัน

> **ตรวจแล้วว่าตรงกับของเดิม:** `test/hsot-parity.test.js` รันตัวอ่านของ `OTCompare.gs` คู่กับตัวใหม่ → **ตรงทุกรายการ** (รหัส · ชื่อ · ตำแหน่ง · ทีม · ช่วงเวลา · ชั่วโมง เช่น "1:30" = 1.5 · เหตุผล)
> ทีมของคนใช้ชีต "ทีม" ในไฟล์ก่อน → ไม่มีจึงใช้ `PAS_Employees` → ไม่มีอีกจึงใช้คอลัมน์ D ของ HumanSoft (ของเดิมไม่มีขั้น PAS_Employees)

## วางไฟล์
โฟลเดอร์ `Shared Documents/00.HumanSoft-OT/` (ห้ามวางในโฟลเดอร์ปี `2026/…` เพราะ Flow A จะถือว่าเป็นไฟล์เวร)
ชื่อไฟล์อะไรก็ได้ เช่น `OT 2026-10-01_10-07.xlsx` · ถ้า export ออกมาเป็น .xls/.csv ให้เปิดแล้ว Save As เป็น .xlsx ก่อน
วางไฟล์ที่มีวันซ้ำกับไฟล์เดิมได้ ระบบจะลบของวันนั้นแล้วเขียนใหม่ (ล่าสุดชนะ)

## ก่อนเริ่ม
1. รัน `provision-lists.js` ล่าสุด → สร้าง `PAS_OT_Request`
2. เปิดไฟล์ HumanSoft ไฟล์ใดก็ได้ใน Excel บนเว็บ → `Automate → New Script` → วาง `import-hsot.ts` → Save ชื่อ **`import-hsot`**
3. ทดสอบ: Run (ช่องว่างทั้งหมด) → ดู `counts.rows` / `days` / `sheet` — ถ้าได้ `skipped` แปลว่าคอลัมน์ต่างจากเดิม ให้ส่งภาพหัวไฟล์มาตรวจ

## สร้าง Flow
**Automated cloud flow** `PAS · H HumanSoft OT` · trigger **SharePoint – When a file is created or modified (properties only)**
· Site = ไซต์ PAS · Library = `Documents` · Folder = `/Shared Documents/00.HumanSoft-OT`
· Settings → Trigger conditions: `@endsWith(triggerOutputs()?['body/{FilenameWithExtension}'], '.xlsx')` · Concurrency 1
1. **Delay** 2 นาที (รอให้อัปโหลดเสร็จ)
2. **Get items** `PAS_Employees` · Top 5000 · Pagination On → **Select `Emps`**: `Title`, `team`
3. **Run script** — File = `triggerOutputs()?['body/{Identifier}']` · Script `import-hsot` · emps = `string(body('Emps'))` · filePath = `triggerOutputs()?['body/{FilenameWithExtension}']`
4. **Compose `R`** = `outputs('Run_script')?['body/result']` · Condition `status` = `ok` (No → `PAS_ImportLog` status `Skipped`)
5. **Apply to each** `outputs('R')?['days']` → ลบของวันนั้น: **Get items** `PAS_OT_Request` · Filter `day_key eq '@{items('Apply_to_each')}'` → Select `ID` → Run script `batch-delete` → Send HTTP (เหมือน Flow B ข้อ a.)
6. **Apply to each** `outputs('R')?['batches']` (Concurrency 1) → **Send an HTTP request to SharePoint** (POST `_api/$batch`)
7. **Create item** `PAS_ImportLog` — Title = ชื่อไฟล์ · kind `HSOT` · status `Done` · message = `@{string(outputs('R')?['counts'])} · @{join(outputs('R')?['days'], ',')}`
