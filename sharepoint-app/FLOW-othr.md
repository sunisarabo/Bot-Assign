# Flow J — OT จ่ายจริงทั้งปีงบ (ไฟล์ "OT OCT25 - JUL 26.xlsx") → OT Dashboard

ไฟล์นี้เป็น OT ที่จ่ายจริงจาก HR (ชีต PSA + LL) ที่ไฟล์คำนวณ/ตัดรายการซ้ำไว้แล้วในชีต **ข้อมูลคำนวณ**
`import-othr.ts` อ่านชีตนั้นแล้วสรุปลง 4 List ให้หน้า OT Dashboard แท็บ **💰 OT จ่ายจริง** (`POWERAPPS-ot.md` ข้อ 9)

| List | 1 แถว = | ใช้ทำ |
|---|---|---|
| `PAS_OTHR_Month` | เดือน × แผนก (ALL / KP / LP / LL) | การ์ด · ตารางรายเดือน · ประเภท/Code OT · กำลังพล · ไฟลท์ |
| `PAS_OTHR_Day` | วัน × แผนก × ทีม | กราฟรายวัน · รายสัปดาห์ · รายทีม |
| `PAS_OTHR_Person` | เดือน × คน | คนทำ OT (ไม่ซ้ำ) · Top OT |
| `PAS_OTHR_Over` | คนที่เกินเพดาน | > 36 ชม./สัปดาห์ (จ.–อา.) · > 144 ชม./เดือน |

> **ตรวจกับไฟล์จริงแล้ว (ต.ค. 68 – ก.ย. 69):** ทุกเดือนตรงกับชีต **แดชบอร์ด** ของไฟล์ — ชั่วโมง 424,368.83 · 101,385 ครั้ง · 837 คน ·
> กำลังพล/เข้าใหม่/ลาออก · ไฟลท์ · ประเภท OT 4 แบบ · Code A1–A8 · แยกแผนก · เกิน 36 = 430 คน / 1,079 ครั้ง · เกิน 144 = 66 คน / 101 ครั้ง
> (ทดสอบอัตโนมัติด้วยข้อมูลจำลอง: `test/othr.test.js`)

**ข้อมูลต้องอัปเดตในไฟล์ก่อน:** ตัวนำเข้าอ่านชีต *ข้อมูลคำนวณ* ซึ่งไฟล์สร้างใหม่เมื่อกดปุ่มอัปเดตในไฟล์ (ชีต ตรวจข้อมูล → "อัปเดตข้อมูลเมื่อ")
ถ้าเพิ่มรายการในชีต PSA/LL แต่ยังไม่กดอัปเดต ตัวเลขในแอปจะยังเป็นของเดิม — แอปแสดงวันที่ "อัปเดตข้อมูลเมื่อ" ให้เห็นบนหัวแท็บ

## วางไฟล์
ย้ายไฟล์จาก OneDrive ส่วนตัว (`hktadminpsa`) มาไว้ที่ไซต์ PAS: **`Shared Documents/00.OT-HR/`**
(ห้ามวางในโฟลเดอร์ปี `2026/…` เพราะ Flow A จะถือว่าเป็นไฟล์เวร) · ตั้งชื่ออะไรก็ได้ — ปีงบใหม่วางไฟล์ใหม่ในโฟลเดอร์เดียวกัน
> ถ้ายังต้องเก็บไว้ใน OneDrive: ใน Run script เลือก Location = **OneDrive for Business** ได้ แต่ flow จะผูกกับบัญชีเจ้าของไฟล์ (เปลี่ยนรหัส/ปิดบัญชี = หยุดทำงาน)

## ก่อนเริ่ม
1. รัน `provision-lists.js` ล่าสุด → สร้าง `PAS_OTHR_Month` / `_Day` / `_Person` / `_Over` (List อื่นไม่ถูกแตะ)
2. เปิดไฟล์ OT ใน Excel บนเว็บ → **Automate → New Script** → วาง `import-othr.ts` → Save ชื่อ **`import-othr`**
3. ทดสอบ: Run (ช่องว่างทั้งหมด) → ผลต้องได้ `status: ok` · `counts.records` = จำนวนในชีต ตรวจข้อมูล "รายการที่ใช้คำนวณ" · `more: true` (ครั้งแรกส่งทีละ ~2 เดือน)

## สร้าง Flow
**Scheduled cloud flow** `PAS · J OT จ่ายจริง` · ทุกวัน 06:10 (Time zone Bangkok) — ไฟล์ใหญ่ ถูกแก้บ่อย จึงไม่ใช้ trigger "เมื่อไฟล์ถูกแก้"
(อยากอัปเดตทันที: กด **Run** ใน flow ได้เลย)

1. **Initialize variable** `more` (Boolean) = `true`
2. **Do until** `variables('more')` is equal to `false` · Change limits: Count **20** · Timeout **PT2H**
   1. **Get items** `PAS_OTHR_Month` · Filter Query `dept eq 'ALL'` · Top Count 500
      → **Select `Sigs`**: `Title` = `item()?['Title']` · `sig` = `item()?['sig']`
   2. **Run script** (Excel Online (Business)) · Location = ไซต์ PAS · Library = Documents · File = ไฟล์ OT ในโฟลเดอร์ `00.OT-HR`
      · Script `import-othr` · sigs = `string(body('Sigs'))` · filePath = ชื่อไฟล์ · maxRows = `3000`
   3. **Compose `R`** = `outputs('Run_script')?['body/result']`
   4. **Condition** `outputs('R')?['status']` = `ok`
      - **No →** Create item `PAS_ImportLog` (kind `OTHR`, status `Skipped`, message = `outputs('R')?['reason']`) → **Set variable** `more` = `false`
      - **Yes →**
        a. **Apply to each** `outputs('R')?['months']` (Concurrency 1) — ลบของเดือนเดิม
           → **Apply to each** `createArray('PAS_OTHR_Day','PAS_OTHR_Person','PAS_OTHR_Over','PAS_OTHR_Month')`
              - **Send an HTTP request to SharePoint** GET
                `_api/web/lists/getbytitle('@{items('Apply_to_each_list')}')/items?$select=Id&$top=5000&$filter=month_key eq '@{items('Apply_to_each_month')}'`
                · Headers `Accept: application/json;odata=nometadata`
              - **Select `IDs`** From `body('Send_an_HTTP_request_to_SharePoint')?['value']` · Map = `item()?['Id']`
              - **Run script** `batch-delete` · list = `items('Apply_to_each_list')` · ids = `string(body('IDs'))`
              - **Apply to each** batches ของ batch-delete → **Send an HTTP request to SharePoint** (POST `_api/$batch` — ตาราง FLOW-import.md)
        b. **Apply to each** `outputs('R')?['batches']` (Concurrency 1) → **Send an HTTP request to SharePoint** (POST `_api/$batch`)
           + ตรวจ `HTTP/1.1 4` / `HTTP/1.1 5` → Terminate Failed (เหมือน Flow B)
        c. **Create item** `PAS_ImportLog` — kind `OTHR` · status `Done` · message = `@{string(outputs('R')?['counts'])} · @{join(outputs('R')?['months'], ',')}`
        d. **Set variable** `more` = `outputs('R')?['more']`

**ครั้งแรก** ทั้งปี ~16,000 แถว → วน ~6 รอบ (รอบละ 2 เดือน ~2,900 แถว) ใช้เวลาประมาณ 20–40 นาที
**วันต่อ ๆ ไป** ส่งเฉพาะเดือนที่ข้อมูลเปลี่ยน (เทียบ `sig`) — ปกติ 1–2 เดือน · ไม่เปลี่ยนเลย = ไม่เขียนอะไร (รอบเดียวจบ)
ถ้า flow ล้มกลางทาง: `PAS_OTHR_Month` ถูกเขียนท้ายสุด → รอบหน้าจะทำเดือนนั้นใหม่เอง

## เมื่อขึ้นปีงบใหม่ (ไฟล์ใหม่)
วางไฟล์ใหม่ใน `00.OT-HR` → แก้ช่อง File ใน Run script ให้ชี้ไฟล์ใหม่
ตัวนำเข้าแตะเฉพาะเดือน**ในช่วงของไฟล์** (เดือนแรก–เดือนสุดท้ายที่มีรายการ) → ข้อมูลปีงบเก่าใน List **ยังอยู่** ดูย้อนหลังได้
(ถ้าลบรายการทั้งเดือนออกจากไฟล์ ขณะที่เดือนนั้นยังอยู่ในช่วง → ตัวนำเข้าจะลบเดือนนั้นใน List ให้ด้วย)
