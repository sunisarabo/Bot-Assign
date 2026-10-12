# Flow K — สำรองข้อมูลดิบเป็น Excel (1 ไฟล์ / เดือน · 1 แท็บ / วัน)

หลัง Flow B นำเข้าไฟล์ Daily Assignment ของวันไหนเสร็จ (`PAS_ImportLog` = **Done**) Flow K จะดึงข้อมูลดิบของวันนั้น**ที่แอปแสดงอยู่**
จาก SharePoint Lists แล้วเขียนลงไฟล์ Excel บน **OneDrive for Business** ซึ่ง**แยกจากไซต์ HKT PSA Daily Assignment**:

```
OneDrive (บัญชี Admin กลาง)/PAS Backup/
  _template.xlsx          ← ไฟล์ว่าง (สร้างครั้งเดียว)
  PAS_2026-10.xlsx        ← 1 ไฟล์ต่อเดือน (flow สร้างเองจาก _template)
     INDEX | 01OCT | 02OCT | … | 31OCT      ← 1 แท็บต่อวัน เรียงตามวันที่
```

**ในแต่ละแท็บวัน** — บล็อกต่อกันลงมา (หัวบล็อกสีกรมท่า `■ PAS_Duty · 812 แถว · วันที่ 2026-10-10` → แถวหัวคอลัมน์ → ข้อมูล → เว้น 1 แถว):

| ลำดับ | List | เนื้อหา |
|---|---|---|
| 1 | `PAS_Manpower` | สรุปรายทีม (กำลังพล · ลา/ป่วย · OT · Util) |
| 2 | `PAS_DayStats` | KPI ทั้งวัน + รายชั่วโมง |
| 3 | `PAS_Duty` | รายคน (กะ · OT · Util · ตรวจ Assign · แถบ Gantt `gantt_json`) |
| 4 | `PAS_Assignment` | งาน/ไฟลท์รายคน |
| 5 | `PAS_OT_Person` | OT รายคน |
| 6 | `PAS_FlightSLA` | SLA ต่อไฟลท์ (ต้องการ/มี/ขาด) |
| 7 | `PAS_Support` | คำขอซัพ + คนแนะนำ |
| 8 | `PAS_AutoPlan` | ผล Auto Assign |
| 9 | `PAS_DataIssue` | รายการตรวจข้อมูล |

**แท็บ INDEX** = สารบัญ: วันที่ · แท็บ · List · จำนวนแถว · จำนวนคอลัมน์ · เวลาที่สำรอง
**ไฟล์ Daily Assignment ถูกแก้แล้วนำเข้าใหม่** → แท็บวันนั้นถูก**เขียนทับทั้งแท็บ** (ไม่ซ้อน) · INDEX อัปเดตเวลาใหม่

> ค่าทุกช่องเก็บเป็น**ข้อความตามจริง** (รหัสพนักงานที่ขึ้นต้นด้วย 0 ไม่หาย · `05:00` ไม่ถูกแปลงเป็นเวลา · ข้อความที่ขึ้นต้นด้วย `=` ไม่กลายเป็นสูตร)
> ตัวเลข/ใช่-ไม่ใช่เก็บเป็นตัวเลข/TRUE-FALSE · ข้อความยาวเกิน 32,000 ตัว (ขีดจำกัด Excel) ถูกตัดท้ายด้วย `…`
> ทดสอบอัตโนมัติ: `test/backup.test.js`

## ก่อนเริ่ม (ครั้งเดียว)
1. **เลือกบัญชีเจ้าของไฟล์สำรอง** — แนะนำบัญชี Admin กลาง (เช่น `hktadminpsa`) ไม่ใช่บัญชีส่วนตัวของใคร
   flow ต้องสร้าง/รันด้วยบัญชีนี้ (connection OneDrive + Excel เป็นของบัญชีนี้)
2. ใน OneDrive ของบัญชีนั้น สร้างโฟลเดอร์ **`PAS Backup`** → **New → Excel workbook** → ตั้งชื่อ **`_template.xlsx`** (ไฟล์เปล่า)
3. เปิด `_template.xlsx` ใน Excel บนเว็บ → **Automate → New Script** → วาง `backup-day.ts` → Save ชื่อ **`backup-day`**
4. แชร์โฟลเดอร์ `PAS Backup` ให้ทีม Admin แบบ **Can view** (ดู/ดาวน์โหลดได้ แต่แก้ไม่ได้)

## สร้าง Flow
**Automated cloud flow** `PAS · K Backup Excel`
**Trigger:** SharePoint — **When an item is created or modified** · Site = ไซต์ PAS · List = `PAS_ImportLog`
- **Settings → Trigger conditions** (วางทั้งบรรทัด):
  `@and(equals(triggerOutputs()?['body/status/Value'], 'Done'), not(empty(triggerOutputs()?['body/day_key'])), or(empty(triggerOutputs()?['body/kind']), equals(triggerOutputs()?['body/kind/Value'], 'ROSTER')))`
  (เฉพาะไฟล์เวรที่นำเข้าสำเร็จ — ไม่รวม OT HR / ตารางบิน / Porter)
- **Settings → Concurrency control: On · Degree 1** (หลายวันเสร็จพร้อมกัน → เขียนไฟล์ทีละวัน ไม่ชนกัน)

1. **Compose `Day`** = `triggerOutputs()?['body/day_key']`
2. **Compose `Path`** = `concat('/PAS Backup/PAS_', substring(outputs('Day'), 0, 7), '.xlsx')`
3. **Get file metadata using path** (OneDrive for Business) · File Path = `outputs('Path')` — ตั้งชื่อ action ว่า **`Find`**
4. **Copy file** (OneDrive for Business) · File = `/PAS Backup/_template.xlsx` · Destination File Path = `outputs('Path')` · Overwrite = **No**
   → **Configure run after**: ติ๊กเฉพาะ **has failed** ของ `Find` (ยังไม่มีไฟล์เดือนนี้ = สร้างใหม่)
5. **Get file metadata using path** · File Path = `outputs('Path')` — ตั้งชื่อ **`File`**
   → **Configure run after**: ติ๊ก **is successful** และ **is skipped** ของ Copy file
6. **Apply to each `Lists`** · Select an output = (สลับเป็น expression)
   `createArray('PAS_Manpower','PAS_DayStats','PAS_Duty','PAS_Assignment','PAS_OT_Person','PAS_FlightSLA','PAS_Support','PAS_AutoPlan','PAS_DataIssue')`
   · **Settings → Concurrency: On · Degree 1** (สำคัญ — ต้องเขียนตามลำดับ)
   1. **Send an HTTP request to SharePoint** · Site = ไซต์ PAS · Method `GET`
      · Uri = `_api/web/lists/getbytitle('@{items('Lists')}')/items?$top=5000&$filter=day_key eq '@{outputs('Day')}'`
      · Headers `Accept` = `application/json;odata=nometadata`
   2. **Run script** (Excel Online (Business)) · Location = **OneDrive for Business** · Document Library = **OneDrive**
      · File = `body('File')?['Id']` · Script = **`backup-day`**
      · day = `outputs('Day')` · list = `items('Lists')`
      · rows = `string(body('Send_an_HTTP_request_to_SharePoint')?['value'])`
      · first = `equals(items('Lists'), 'PAS_Manpower')` (List แรก = ล้างแท็บวันนั้นก่อน)

**ทดสอบ:** เปิด `PAS_ImportLog` → แถวไฟล์เวรที่ Done แล้ว → แก้ message เป็นอะไรก็ได้แล้ว Save (trigger ทำงาน)
→ ภายใน ~1–2 นาทีมี `PAS_2026-10.xlsx` + แท็บวันนั้น + INDEX · จำนวนแถวใน INDEX = จำนวนใน List (เช่น PAS_Duty ของวันนั้น)

## สำรองย้อนหลัง (วันที่นำเข้าไปแล้วก่อนมี Flow K)
**Instant cloud flow** `PAS · K2 Backup เดือน` · Trigger **Manually trigger a flow** · input ข้อความ `Month` (เช่น `2026-10`)
1. **Get items** `PAS_DayStats` · Filter Query `day_key ge '@{triggerBody()['text']}-01' and day_key le '@{triggerBody()['text']}-31'` · Order By `day_key`
2. **Apply to each** `value` (Concurrency **1**) → **Compose `Day`** = `items('Apply_to_each')?['day_key']` → ขั้น 2–6 ของ Flow K
   (ทำ Flow K เสร็จแล้วใช้ **…→ Copy to my clipboard** ที่ action แล้ว **Paste** ใน K2 ได้ — แก้ `Day` ให้ชี้ค่าใหม่)

## ข้อควรรู้
- **ไฟล์ใหม่ทุกเดือนอัตโนมัติ** — วันแรกของเดือนที่ถูกนำเข้าจะสร้างไฟล์จาก `_template.xlsx` เอง ไม่ต้องตั้งค่า
- ไฟล์สำรองไม่ถูก flow อื่นอ่าน — **ลบ/ย้าย/เปลี่ยนชื่อได้** แต่ถ้าย้ายไฟล์ของเดือนปัจจุบัน flow จะสร้างไฟล์ใหม่ (ที่ path เดิม)
- **ขนาด:** 1 วัน ≈ 2,000–3,000 แถวรวมทุกบล็อก (≈ 1–2 MB) · 1 เดือน ≈ 30–60 MB
  ถ้า Run script ล้มเพราะข้อมูลใหญ่เกิน (`PAS_Duty` มี `gantt_json` ยาว) → ใน Uri ของ PAS_Duty เพิ่ม `&$select=` เฉพาะคอลัมน์ที่ต้องการ
- **ไม่ต้องใช้ Premium / admin consent** — ใช้ SharePoint · OneDrive for Business · Excel Online (Business) ซึ่งเป็นตัวต่อมาตรฐาน
- อยากเก็บที่ไซต์ SharePoint อื่นแทน OneDrive (เช่น ไซต์ทีม Admin): ขั้น 3–5 ใช้ action ของ **SharePoint** (Get file metadata using path / Copy file) และใน Run script เลือก Location = ไซต์นั้น · Library = Documents
- ดูว่าสำรองครบไหม: แท็บ INDEX ของไฟล์เดือน หรือ **Run history** ของ Flow K (แดง = ล้ม · กด Resubmit ได้)
