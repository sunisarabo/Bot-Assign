# Flows นำเข้าไฟล์เวร → SharePoint Lists (รองรับเดือนใหม่ / ปีใหม่ อัตโนมัติ)

## แนวคิด — ทำไมเดือนใหม่/ปีใหม่ไม่ต้องตั้งค่าอะไรเพิ่ม
1. **เฝ้าทั้งไลบรารี** `Shared Documents` (รวมโฟลเดอร์ย่อยทุกชั้น) — ไม่ผูกชื่อโฟลเดอร์ปี/เดือน
   → สร้างโฟลเดอร์ `2027/01.JAN27` เมื่อไหร่ ไฟล์ในนั้นก็ถูกนำเข้าทันที
2. **วันที่อ่านจาก path ของไฟล์** (`import-roster.ts`) ไม่ใช่จากวันที่ปัจจุบัน:
   | path ตัวอย่าง | ได้วันที่ |
   |---|---|
   | `2025/09.SEP26/19SEP.xlsx` | 2026-09-19 (ปีจากโฟลเดอร์เดือน `SEP26` ชนะโฟลเดอร์ `2025`) |
   | `2027/01.JAN27/01JAN.xlsx` | 2027-01-01 |
   | `2569/ก.ย.69/19 ก.ย. 69.xlsx` | 2026-09-19 (พ.ศ.) |
   | `2026/09/19.xlsx` | 2026-09-19 (เดือน `09` + ปี `2026` จากโฟลเดอร์) |
   | `JAN/03JAN.xlsx` (ไม่มีปีเลย) | ปีที่ใกล้วันนี้ที่สุด → ต้น ม.ค. ถูกนับเป็นปีถัดไปเมื่อยังอยู่ ธ.ค. |
   ถ้าวันที่ใน path ไม่ตรงหัวชีต MANPOWER → ยังนำเข้า แต่บันทึกคำเตือนใน `PAS_ImportLog.message`
3. **คิว `PAS_ImportLog`** (1 แถว/ไฟล์) — กันไฟล์ที่แก้ไขบ่อย (Excel autosave) นำเข้าซ้ำรัว ๆ:
   นำเข้าเมื่อไฟล์ **นิ่ง ≥10 นาที** · เห็นสถานะทุกไฟล์ (Pending / Done / Skipped / Error)
4. **ย้อนหลังทั้งเดือน/ทั้งปี** ด้วย Flow C (ปุ่มกด ใส่โฟลเดอร์)
5. **เขียนแบบ `$batch`** (100 แถว/คำสั่ง) → 1 ไฟล์ ≈ 30 actions แทน ~2,500
   ไม่ชนโควตา Power Automate ของ M365 (6,000 requests/วัน/คน)

```
[A] Watcher ──(ไฟล์ .xlsx ใหม่/แก้ไข ในไลบรารี)──► PAS_ImportLog: Pending
[C] Backfill ──(กดเอง: โฟลเดอร์เดือน/ปี)─────────► PAS_ImportLog: Pending
[B] Importer (ทุก 15 นาที) ── Pending ที่นิ่ง ≥10 นาที ─► Run script → ลบวันเดิม → $batch เขียนใหม่ → Done/Skipped/Error
```

> ก่อนเริ่ม: รัน `provision-lists.js` แล้ว (มี List `PAS_ImportLog`) · Save Office Scripts 2 ตัวใน Excel บนเว็บ:
> `import-roster` (จาก `import-roster.ts`) และ `batch-delete` (จาก `batch-delete.ts`)
> ทุก flow ใช้ตัวต่อมาตรฐาน (SharePoint · Excel Online (Business)) — ไม่ต้อง Premium

ค่าที่ใช้ซ้ำ: **Site** = `https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA` · **Library** = `Documents`

---

## Flow A — Watcher (`PAS · A Watch roster files`)
**Automated cloud flow** · Trigger: **SharePoint — When a file is created or modified (properties only)**
- Site Address: Site · Library Name: `Documents` · Folder: *(เว้นว่าง = ทั้งไลบรารี รวมโฟลเดอร์ย่อย)*
- **Settings → Trigger conditions** (กันรันกับไฟล์ที่ไม่เกี่ยว — ไม่เสียโควตา) — วางทั้งบรรทัด:
  ```
  @and(equals(triggerOutputs()?['body/{IsFolder}'], false), endsWith(toLower(triggerOutputs()?['body/{FilenameWithExtension}']), '.xlsx'), not(startsWith(triggerOutputs()?['body/{FilenameWithExtension}'], '~$')), not(startsWith(triggerOutputs()?['body/{FilenameWithExtension}'], '00.')), or(startsWith(triggerOutputs()?['body/{Path}'], 'Shared Documents/20'), startsWith(triggerOutputs()?['body/{Path}'], 'Shared Documents/PAS-Import/')))
  ```
  ตามโครงจริงของไซต์ HKT PSA Daily:
  | ในไลบรารี | ผล |
  |---|---|
  | `2025/…`, `2026/…`, `2027/…` (โฟลเดอร์ปีที่ขึ้นต้น `20`) | ✅ เฝ้า — ปีใหม่ที่สร้างภายหลังก็เข้าเงื่อนไขเอง |
  | `PAS-Import/` | ✅ เฝ้า (ที่วางไฟล์สำรอง/ทดสอบ) |
  | `2026/00.Master.xlsx` (ไฟล์ขึ้นต้น `00.`) | ⛔ ข้าม — เป็น master พนักงาน ไม่ใช่เวรรายวัน |
  | `PAS-Data.xlsx`, `PAS-Migration/` (ไม่อยู่ในโฟลเดอร์ปี) | ⛔ ข้าม |
  ถ้ายังมีไฟล์อื่นปนในโฟลเดอร์ปี/เดือน (ไม่ใช่เวร PSA) สคริปต์จะคืน `skipped` และบันทึกใน `PAS_ImportLog` โดยไม่เขียนข้อมูล

1. **Compose `FilePath`** = `@{triggerOutputs()?['body/{Path}']}@{triggerOutputs()?['body/{FilenameWithExtension}']}`
   (ได้ `Shared Documents/2025/09.SEP26/19SEP.xlsx`)
2. **Get items** — List `PAS_ImportLog` · Filter Query:
   `file_id eq '@{triggerOutputs()?['body/{Identifier}']}' and status eq 'Pending'` · Top Count `1`
3. **Condition** `length(body('Get_items')?['value'])` **is equal to** `0`
   - **Yes → Create item** (`PAS_ImportLog`): Title = `FilePath` · file_id = `{Identifier}` · file_name = `{FilenameWithExtension}`
     · status Value = `Pending` · last_seen = `@{utcNow()}`
   - **No → Update item** (Id = `first(body('Get_items')?['value'])?['ID']`): last_seen = `@{utcNow()}`
     (แค่ "แตะ" ให้ Modified ขยับ → นับเวลานิ่ง 10 นาทีใหม่)

## Flow B — Importer (`PAS · B Import queue`)
**Scheduled cloud flow** · ทุก **15 นาที**
**Settings → Concurrency control: On, Degree 1** (กันสองรอบชนกัน)

1. **Get items** — `PAS_ImportLog` · Filter Query:
   `status eq 'Pending' and Modified lt '@{addMinutes(utcNow(), -10)}'` · Order By `Modified` · Top Count `10`
1b. **Get items `Holidays`** — `PAS_Holidays` · Top Count `500` → **Select `HolKeys`** From `value` · Map (โหมดข้อความ) = `item()?['day_key']`
   (วันหยุดประเพณี → OT นักขัต X1 · ขึ้นปีใหม่ เพิ่มวันหยุดใน List นี้อย่างเดียว ไม่ต้องแก้ flow/สคริปต์)
1c. **Get items `Rules`** — `PAS_SLARules` · Top 500 → **Select `RuleRows`**: `Title`, `sup`, `ci`, `arr`, `gate`, `total` (โหมดตาราง แมปคอลัมน์ชื่อเดียวกัน)
1d. **Get items `Pos`** — `PAS_Employees` · Filter `status eq 'ACTIVE'` · Top 5000 · Pagination On → **Select `PosRows`** (โหมดตาราง): `Title`, `pos_group`
   (ตำแหน่งพนักงาน → เครดิต SUP จากหัวหน้า + คัดคนช่วย SUP = Sup/Snr + เรียงคนช่วย Agent ก่อน)
2. **Apply to each** (`value`) — Concurrency **1**  ← ในลูปนี้ `items('Apply_to_each')` = แถวคิว
   1. **Update item** (คิว): status Value = `Running`
   2. **Scope `Import`**:
      0. **Run script `GetDate`** — ไฟล์เดียวกับข้อ 1 · Script `import-roster` · filePath = `items('Apply_to_each')?['Title']` · **dateOnly** = `1`
         → **Get items `Sched`** — `PAS_Flights` · Filter `day_key eq '@{outputs('GetDate')?['body/result/work_date']}'` · Top 1000
         → **Select `SchedRows`**: `flight_key`, `aircraft_type`, `sta`, `std`, `cancelled` (โหมดตาราง)
         (ไม่มีตารางบินวันนั้น = ว่าง → SLA ใช้ A/C TYPE/เวลาจากแท็บเวรเหมือนเดิม)
      1. **Run script** — Location: Site · Document Library: `Documents` · File: `items('Apply_to_each')?['file_id']`
         · Script: `import-roster` · **filePath** = `items('Apply_to_each')?['Title']` · workDate: เว้นว่าง
         · **holidays** = `string(body('HolKeys'))`
         · **schedule** = `string(body('SchedRows'))` · **rules** = `string(body('RuleRows'))` · **posg** = `string(body('PosRows'))` (ช่อง pss เว้นว่าง)
      2. **Compose `R`** = `outputs('Run_script')?['body/result']`
      3. **Condition** `outputs('R')?['status']` is equal to `ok`
         - **No → Update item** (คิว): status `Skipped` · day_key = `outputs('R')?['work_date']` · message = `outputs('R')?['reason']`
         - **Yes →**
           a. **ลบของวันเดิม** — ทำ 8 รอบ (`PAS_Manpower`, `PAS_Duty`, `PAS_Assignment`, `PAS_OT_Person`, `PAS_DataIssue`, `PAS_FlightSLA`, `PAS_Support`, `PAS_AutoPlan`):
              - **Get items** List = (ชื่อ List) · Filter Query `day_key eq '@{outputs('R')?['work_date']}'`
                · Top Count `5000` · Settings → **Pagination On, Threshold 20000**
              - **Select `IDs`** — From `value` · Map (โหมดข้อความ) = `item()?['ID']`
              - **Run script** `batch-delete` (ไฟล์เดียวกัน) · list = (ชื่อ List) · ids = `string(body('IDs'))`
              - **Apply to each** `outputs('Run_script_2')?['body/result/batches']` (ชื่อ action อาจต่างตามที่ตั้ง) →
                **Send an HTTP request to SharePoint** (ดูตารางด้านล่าง)
           b. **เขียนใหม่** — **Apply to each** `outputs('R')?['batches']` (Concurrency 1) →
              **Send an HTTP request to SharePoint** (ตารางด้านล่าง)
           c. **Update item** (คิว): status `Done` · day_key = `outputs('R')?['work_date']`
              · date_source = `outputs('R')?['date_source']` · teams/duty/assignment = `outputs('R')?['counts/teams']` ฯลฯ
              · message = `join(outputs('R')?['warnings'], ' | ')`
   3. **Update item** (คิว) status `Error` · message = `result('Import')` — ตั้ง **Configure run after → has failed / has timed out** ต่อจาก Scope

**Send an HTTP request to SharePoint** (ใช้ทั้งลบและเขียน — `items('…')` = ก้อน batch ปัจจุบัน)
| ช่อง | ค่า |
|---|---|
| Site Address | Site |
| Method | `POST` |
| Uri | `_api/$batch` |
| Headers | `Content-Type`: `multipart/mixed; boundary=@{items('…')?['boundary']}` · `Accept`: `application/json;odata=nometadata` |
| Body | `@{items('…')?['body']}` |

ตรวจผลแต่ละก้อน: **Condition** `contains(string(body('Send_an_HTTP_request_to_SharePoint')), 'HTTP/1.1 4')` หรือ `'HTTP/1.1 5'`
→ ถ้าจริง ให้ **Terminate (Failed)** — Scope จะล้ม แล้วแถวคิวถูกตั้ง `Error` พร้อมข้อความ
(1 ก้อน = 1 changeset → สำเร็จหรือล้มทั้งก้อน ไม่เกิดข้อมูลครึ่ง ๆ)

## Flow C — Backfill (`PAS · C Backfill folder`)
**Instant cloud flow** · Trigger: **Manually trigger a flow** · input ข้อความ `Folder` (เช่น `/Shared Documents/2026/10.OCT26` หรือ `/Shared Documents/2026` ทั้งปี)

1. **Get files (properties only)** — Site · Library `Documents` · **Limit Entries to Folder** = `Folder` (เช่น `/Shared Documents/2026`)
   · **Include Nested Items** = `Yes` · Top Count `5000` · Pagination On
2. **Filter array** — `value` where `endsWith(toLower(item()?['{FilenameWithExtension}']), '.xlsx')`
   and `not(startsWith(item()?['{FilenameWithExtension}'], '~$'))` and `not(startsWith(item()?['{FilenameWithExtension}'], '00.'))`
3. **Apply to each** → **Create item** `PAS_ImportLog`: Title = `concat(item()?['{Path}'], item()?['{FilenameWithExtension}'])`
   · file_id = `item()?['{Identifier}']` · file_name = `item()?['{FilenameWithExtension}']` · status `Pending`

→ Flow B ทยอยนำเข้าเอง (10 ไฟล์/15 นาที ≈ 1 เดือนใน ~45 นาที) · กดซ้ำได้ ข้อมูลไม่ซ้ำเพราะลบวันเดิมก่อนเขียน

## ใช้งานจริง
| สถานการณ์ | ต้องทำ |
|---|---|
| ขึ้นเดือนใหม่ / ปีใหม่ (สร้างโฟลเดอร์ใหม่ตามรูปแบบเดิม) | **ไม่ต้องทำอะไร** — Flow A เห็นไฟล์เอง |
| เปลี่ยนรูปแบบชื่อ (เช่น `19SEP` → `2026-09-19`) | ไม่ต้องทำอะไร ถ้าอยู่ในรูปแบบที่รองรับ (ตารางด้านบน / หัวไฟล์ `import-roster.ts`) |
| แก้ไฟล์เวรย้อนหลัง | ไม่ต้องทำอะไร — แก้แล้ว Flow A ใส่คิว → นำเข้าใหม่ทับวันนั้น |
| ย้ายไฟล์ทั้งปีเข้ามาใหม่ / ระบบเพิ่งเริ่มใช้ | กด Flow C ใส่โฟลเดอร์ปี |
| แถวคิวขึ้น `Skipped: หาวันที่ไม่ได้` | เปลี่ยนชื่อไฟล์ให้มีวัน+เดือน (เช่น `19SEP`) หรือแก้ `status` เป็น Pending หลังแก้ชื่อ |
| แถวคิวขึ้น `Error` | อ่าน `message` → แก้ → ตั้ง `status` = `Pending` (Flow B ทำซ้ำเอง) |

## ทดสอบ
1. กด Flow C ใส่โฟลเดอร์เดือนปัจจุบัน → เปิด List `PAS_ImportLog` เห็นแถว Pending
2. รอ Flow B (หรือกด **Run** เอง) → แถวเป็น `Done` · `day_key` ถูกต้อง · `duty`/`teams` ตรงชีต MANPOWER
3. สร้างโฟลเดอร์ทดสอบ `Shared Documents/2027/01.JAN27` วางไฟล์ `01JAN.xlsx` → ต้องได้ `day_key = 2027-01-01`
4. แก้ไฟล์เดิม 1 เซลล์ → ภายใน ~25 นาทีถูกนำเข้าใหม่ จำนวนแถวใน `PAS_Duty` ของวันนั้นเท่าเดิม (ไม่ซ้ำ)
