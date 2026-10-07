# Flow D — รายชื่อพนักงาน → `PAS_Employees` (sync อัตโนมัติ)

## เลือกแหล่งรายชื่อ (ใช้ 1 แหล่ง)
| แหล่ง | ที่อยู่ | หมายเหตุ |
|---|---|---|
| **ไฟล์ Manpower (แนะนำ)** | ไซต์ `https://aotgath.sharepoint.com/sites/PS-Manpower` (ไฟล์จากลิงก์ที่แชร์) | รายชื่อครบ · ไฟล์เดียวตลอด ไม่ต้องเปลี่ยนเมื่อขึ้นปีใหม่ |
| `00.Master.xlsx` | `Shared Documents/2026/00.Master.xlsx` | ขึ้นปีใหม่ต้องเปลี่ยนไฟล์ใน flow เป็น `2027/00.Master.xlsx` |

`import-master.ts` อ่านได้ทั้งสองไฟล์:
- ใช้ชีต `Total` ถ้ามี ถ้าไม่มีก็ใช้ชีตแรกที่มีหัวตาราง "รหัส" + "ชื่อ"
- หาคอลัมน์จาก **ชื่อหัวตาราง** เช่น รหัส, ทีม, ชื่อ, สกุล หรือ ชื่อ-สกุล, แผนก, ตำแหน่ง, เริ่มงาน, Name, Surname, พ้นสภาพ, สถานะ ลำดับคอลัมน์ต่างจากเดิมได้
- รวมรายชื่อจากชีต `BKK Batch …` ทุกแท็บ: ตัด `B` หน้ารหัสออก และตั้ง source = BKK
- ตั้ง GLOBEX จากทีม และแยก PSA/LL จากแผนก (การโดยสาร / ติดตามสัมภาระ)
- ตั้งสถานะ RESIGNED เมื่อสถานะเป็น Resigned / ลาออก หรือเมื่อวันพ้นสภาพผ่านไปแล้ว

## วิธีที่ระบบอัปเดตรายชื่อ (upsert ตามรหัสพนักงาน)
| ในไฟล์ | ใน List |
|---|---|
| คนใหม่ | เพิ่มแถว |
| ข้อมูลเปลี่ยน (ทีม/ตำแหน่ง/สถานะ…) | แก้เฉพาะแถวนั้น (เทียบด้วย `row_hash`) |
| ไม่เปลี่ยน | ไม่ทำอะไร (ไม่เปลือง action) |
| หายจากไฟล์ | ลบแถว — **แต่ถ้าจะลบเกิน 50% ในรอบเดียว ระบบหยุด** (กันไฟล์ผิด/ชีตหายแล้วล้างรายชื่อทั้งหมด) |

## ก่อนเริ่ม
1. รัน `provision-lists.js` รุ่นล่าสุดซ้ำ 1 ครั้ง → เพิ่มคอลัมน์ใหม่ให้ `PAS_Employees` (dept, pos_group, start_date, resign_date, row_hash, master_file) และ `PAS_ImportLog.kind`
2. เปิดไฟล์ Manpower ใน Excel บนเว็บ → `Automate → New Script` → วาง `import-master.ts` → Save ชื่อ **`import-master`**
3. **ทดสอบครั้งแรก**: ในไฟล์นั้นกด **Run** (ปล่อย `existing` ว่าง) → ดู `counts` (total/active/psa/ll/bkk) เทียบกับยอดในไฟล์
   ไม่ตรง หรือขึ้น `skipped` → ส่งข้อความ `reason` + ภาพหัวตารางมา จะปรับให้
4. คนสร้าง flow ต้องมีสิทธิ์**อ่าน**ไซต์ PS-Manpower และสิทธิ์**แก้ไข**ไซต์ HKT PSA Daily

## สร้าง Flow
**Scheduled cloud flow** `PAS · D Sync employees` · ทุก **30 นาที** · Settings → Concurrency **1**

1. **SharePoint — Get file metadata using path**
   Site Address = `https://aotgath.sharepoint.com/sites/PS-Manpower` · File Path = เลือกไฟล์ Manpower (ปุ่มโฟลเดอร์)
2. **SharePoint — Get items** (ไซต์ HKT PSA Daily) · List `PAS_ImportLog`
   · Filter Query `kind eq 'MASTER'` · Top Count `1`
3. **Compose `Last`** = `coalesce(first(body('Get_items')?['value'])?['last_seen'], '2000-01-01T00:00:00Z')`
4. **Condition** (เปลี่ยนแล้ว + นิ่งแล้ว ≥10 นาที) — แบบ advanced:
   ```
   @and(greater(ticks(body('Get_file_metadata_using_path')?['LastModified']), ticks(outputs('Last'))), less(ticks(body('Get_file_metadata_using_path')?['LastModified']), ticks(addMinutes(utcNow(), -10))))
   ```
   **No →** จบ (ไม่มีอะไรเปลี่ยน)
   **Yes →**
   1. **Get items** `PAS_Employees` · Top Count `5000` · Settings → **Pagination On, Threshold 20000**
   2. **Select `Old`** — From `value` · Map: `ID` = `item()?['ID']` · `Title` = `item()?['Title']` · `row_hash` = `item()?['row_hash']`
   3. **Excel Online (Business) — Run script**
      Location = ไซต์ **PS-Manpower** · Document Library = ไลบรารีของไฟล์ · File = ไฟล์ Manpower · Script = `import-master`
      · filePath = `@{body('Get_file_metadata_using_path')?['Path']}` · existing = `@{string(body('Old'))}`
   4. **Compose `M`** = `outputs('Run_script')?['body/result']`
   5. **Condition** `outputs('M')?['status']` = `ok` →
      **Apply to each** `outputs('M')?['batches']` (Concurrency 1) → **Send an HTTP request to SharePoint**
      — Site Address = **ไซต์ HKT PSA Daily** (ปลายทาง) · Method `POST` · Uri `_api/$batch`
      · Headers `Content-Type: multipart/mixed; boundary=@{items('Apply_to_each')?['boundary']}` · `Accept: application/json;odata=nometadata`
      · Body `@{items('Apply_to_each')?['body']}`
      (ตรวจ `HTTP/1.1 4`/`5` ใน response เหมือน Flow B → Terminate Failed)
   6. **บันทึกผลใน `PAS_ImportLog`** — ถ้าข้อ 2 ไม่มีแถว → **Create item** ไม่งั้น **Update item** (ID แถวนั้น):
      Title = `MASTER` · kind `MASTER` · file_name = `@{body('Get_file_metadata_using_path')?['Name']}`
      · status = `ok` → `Done` / อื่น → `Skipped` · duty = `outputs('M')?['counts/active']`
      · message = `@{string(outputs('M')?['counts'])} @{outputs('M')?['reason']}`
      · **last_seen = `@{body('Get_file_metadata_using_path')?['LastModified']}`** ← ใช้เทียบรอบถัดไป
        (ถ้า `Skipped` ให้คง last_seen เดิม เพื่อลองใหม่เมื่อแก้ไฟล์)

> ต้องการ sync ทันที: เปิด flow → **Run** · บังคับ sync ใหม่ทั้งหมด: ลบค่า `last_seen` ในแถว MASTER

## ทดสอบ
1. Run flow ครั้งแรก → `PAS_Employees` มีจำนวนแถว = `counts.total` · แถว MASTER ใน `PAS_ImportLog` = Done
2. Run อีกครั้งโดยไม่แก้ไฟล์ → จบที่ Condition (ไม่มี action เขียน)
3. แก้ทีมของ 1 คนในไฟล์ Manpower → รอ ~10–40 นาที → แถวนั้นใน List เปลี่ยน · `message` แสดง `"updated":1`
