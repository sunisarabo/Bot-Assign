# Flow: นำเข้าไฟล์เวร → SharePoint Lists (อัตโนมัติเมื่อวางไฟล์)

สร้างที่ <https://make.powerautomate.com> → **Create → Automated cloud flow** → ชื่อ `PAS · Import roster`

> ใช้ตัวต่อมาตรฐาน 2 ตัว: **SharePoint** และ **Excel Online (Business)** — ไม่ต้อง Premium
> ก่อนเริ่ม: รัน `provision-lists.js` แล้ว และ Save Office Script ชื่อ `import-roster` แล้ว (ดู README)

## 1) Trigger
**SharePoint — When a file is created (properties only)**
- Site Address: `https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA`
- Library Name: `Documents` (= Shared Documents)
- Folder: `/Shared Documents/PAS-Import`

ต่อด้วย **Condition**: `File name with extension` **ends with** `.xlsx` → ทำต่อในฝั่ง *If yes*

## 2) Run script
**Excel Online (Business) — Run script**
- Location: ไซต์ด้านบน · Document Library: `Documents`
- File: `Identifier` (จาก trigger)
- Script: `import-roster`
- `workDate`: เว้นว่าง (สคริปต์เดาจากชื่อไฟล์ เช่น `19SEP26.xlsx` / `2026-09-19.xlsx` หรือหัวชีต MANPOWER)
- `fileName`: `File name with extension`

> สคริปต์อยู่ใน OneDrive ของคนสร้าง flow — ถ้าจะให้ทีม Admin ใช้ร่วม ให้ใช้ action **Run script from SharePoint library** แล้วเก็บไฟล์ `.osts` ไว้ในไซต์นี้แทน

ตั้ง **Compose** ชื่อ `Day` = `@{outputs('Run_script')?['body/result/work_date']}`

## 3) ลบข้อมูลเก่าของวันนั้น (ทำ 3 ชุด: PAS_Duty, PAS_Assignment, PAS_Manpower)
**SharePoint — Get items**
- List Name: `PAS_Duty`
- Filter Query: `day_key eq '@{outputs('Day')}'`
- Top Count: `5000` · Settings → **Pagination: On, Threshold 20000**

**Apply to each** (`value`) → **SharePoint — Delete item** (Id = `ID`)
Settings ของ Apply to each → **Concurrency control: On, 20**

ทำซ้ำกับ `PAS_Assignment` และ `PAS_Manpower`

## 4) เพิ่มแถวใหม่ (3 ชุด)
**Apply to each** — input: `@{outputs('Run_script')?['body/result/duty']}` (Concurrency 20)
→ **SharePoint — Create item** · List `PAS_Duty` · แมปคอลัมน์ด้วย expression `items('Apply_to_each')?['<ชื่อคอลัมน์>']`

| คอลัมน์ใน List | ค่า |
|---|---|
| Title (key) | `items('Apply_to_each')?['Title']` |
| day_key / work_date / team / emp_code / emp_name / shift_code / shift_start / source_file | ชื่อเดียวกัน |
| bucket **Value** | `items('Apply_to_each')?['bucket']` |
| shift_hours / ot_hours / duty_min / busy_min / util_pct | ชื่อเดียวกัน |

ทำเช่นเดียวกัน:
- `result/assignment` → `PAS_Assignment` (Title, day_key, work_date, team, emp_code, emp_name, task, sta, std, counter_open, counter_close, win_lo, win_hi, is_flight)
- `result/manpower` → `PAS_Manpower` (Title, day_key, work_date, team, total, working, sick, annual, training, ot_hours, util_pct)

> คอลัมน์ `*_min` เป็นคอลัมน์คำนวณ — **ไม่ต้องแมป** SharePoint คำนวณให้เอง

## 5) (เลือกได้) แจ้งผลใน Teams
**Microsoft Teams — Post message in a chat or channel**
`นำเข้าเวร @{outputs('Day')} สำเร็จ: @{outputs('Run_script')?['body/result/counts/teams']} ทีม · @{outputs('Run_script')?['body/result/counts/duty']} คน · @{outputs('Run_script')?['body/result/counts/assignment']} งาน`

## ทดสอบ
1. วางไฟล์เวร 1 วันลง `Shared Documents/PAS-Import`
2. ดู Run history → เปิด `Run script` ดู `counts` เทียบกับชีต MANPOWER
3. เปิด List `PAS_Manpower` → กรอง `day_key` = วันนั้น → ตัวเลข working/sick/annual ต้องตรงชีต
4. วางไฟล์เดิมซ้ำ → จำนวนแถวต้องเท่าเดิม (ไม่ซ้ำ)

## เวลาในการรัน
Create item ทีละแถว ≈ 300–600 แถว/วัน ใช้ราว 2–5 นาทีที่ Concurrency 20
ถ้าช้าเกิน: เปลี่ยนเป็น **Send an HTTP request to SharePoint** แบบ `$batch` (ยังเป็นตัวต่อมาตรฐาน)
