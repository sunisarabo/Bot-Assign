# 37 · Backup & Restore (SharePoint lists + แอป)

ให้ "ทุกฟังก์ชันมี backup" จริง — 3 ชั้น: **versioning รายแถว · snapshot รายวัน (CSV) · กู้ (restore)**
> แอปเขียนทับ/upsert ลง SharePoint list โดยตรง → ต้องตั้ง backup เอง (ฟังก์ชันไม่สำรองให้)

---

## ชั้นที่ 1 · เปิด Version history + Recycle bin (กันทับรายแถว · ทำครั้งเดียว)
ทุกลิสต์ `PAS_*`: **List settings → Versioning settings → Create a version each time = Yes** (เก็บ ~50–100 เวอร์ชัน)
- แก้ผิดรายแถว → เปิด item → **Version history → Restore** ค่าเดิมได้
- ลบแถว → **Recycle bin** กู้ได้ ~93 วัน (site + site collection)
> เปิดให้ครบ: PAS_Porter · PAS_Assignment · PAS_Duty · PAS_Users · PAS_Pins · PAS_Flights · PAS_SwapLog · PAS_LeaveLog · PAS_TeamPosition · PAS_TeamAirline · (และลิสต์อื่นที่ใช้)

---

## ชั้นที่ 2 · flow "Daily Backup" (snapshot CSV รายวัน)

เก็บสำเนาทั้งลิสต์เป็นไฟล์ไว้โฟลเดอร์ตามวันที่ → กู้ทั้งชุดได้ถ้าเขียนก้อนใหญ่พลาด

### สร้าง: Scheduled cloud flow — ทุกวัน 02:00
1. **Recurrence** — 1 วัน/ครั้ง 02:00 (นอกเวลาทำงาน)
2. **Compose `day`** = `@{utcNow('yyyy-MM-dd')}`
3. **Initialize `lists`** (Array) = รายชื่อลิสต์ที่จะสำรอง
   ```json
   ["PAS_Porter","PAS_Assignment","PAS_Duty","PAS_Users","PAS_Pins","PAS_Flights","PAS_SwapLog","PAS_LeaveLog","PAS_TeamPosition","PAS_TeamAirline"]
   ```
4. **Apply to each** `@{variables('lists')}`  (ชื่อ `FOR_list`):
   - **Send an HTTP request to SharePoint** (รองรับชื่อลิสต์แบบไดนามิก + ลิสต์ใหญ่)
     - Site Address: ไซต์ PAS · Method **GET**
     - Uri: `_api/web/lists/getbytitle('@{items('FOR_list')}')/items?$top=5000`
     - (ลิสต์ใหญ่ > 5000 เช่น PAS_Porter/PAS_Duty → วน **Do until** ตาม `d/__next` / `@odata.nextLink` ต่อหน้า แล้วรวม — ดูหมายเหตุลิสต์ใหญ่)
   - **Parse JSON** body → `value` (ใช้ sample ของแต่ละลิสต์ หรือ Select เฉพาะคอลัมน์ที่ต้องเก็บ)
   - **Select** — map เป็น record แบน (เอาเฉพาะ field ข้อมูล ไม่เอา metadata) · **Create CSV table** (From = output ของ Select, Columns = Automatic)
   - **SharePoint – Create file**
     - Folder: `/99.Backup/@{outputs('Compose_day')}`
     - File Name: `@{items('FOR_list')}.csv`
     - File Content: `@{body('Create_CSV_table')}`
5. **(ท้าย) แจ้งผล** (ออปชัน): ส่งสรุป "backup <day> เสร็จ N ลิสต์" เข้าเมล/กลุ่มแอดมิน

> โฟลเดอร์ `99.Backup/2026-10-18/PAS_Porter.csv` … → แต่ละวันมีสำเนาครบทุกลิสต์

### ลิสต์ใหญ่ (PAS_Porter ~44k, PAS_Duty) — วนหน้า
```
Initialize vNext = "_api/web/lists/getbytitle('PAS_Porter')/items?$top=5000"
Initialize vRows = []   (Array)
Do until  empty(vNext):
   HTTP GET @{vNext}
   Append to vRows = body?['value']
   Set vNext = coalesce(body?['d/__next'], body?['@odata.nextLink'], "")  // ว่าง = จบ
→ Create CSV จาก vRows
```
> ทางเลียบ: ลิสต์ใหญ่ backup **วันเว้นวัน/สัปดาห์ละครั้ง** · ลิสต์เล็ก (Users/Pins/TeamPosition) **รายวัน** · หรือใช้ **Office Script export** (เร็วกับลิสต์ใหญ่) แล้ว flow เรียก

### retention (ลบ backup เก่า — flow แยก หรือต่อท้าย)
Scheduled รายวัน → **Get files** ใน `/99.Backup` → **Filter** โฟลเดอร์ที่วันที่ในชื่อ < `addDays(utcNow(),-90)` → **Delete** (เก็บ 90 วัน ปรับได้)

---

## ชั้นที่ 3 · Restore (กู้คืน)

| สถานการณ์ | วิธีกู้ |
|---|---|
| แก้ค่าผิด **รายแถว** | item → **Version history → Restore** (ต้องเปิด versioning) |
| **ลบแถว** พลาด | **Recycle bin** → Restore (≤93 วัน) |
| เขียนผิด **ทั้งก้อน** (import/flow) | กู้จาก **CSV ใน 99.Backup/<วันที่ดี>** (ดูด้านล่าง) |
| **แอป** พัง/แก้ผิด | Power Apps → **Versions → Restore** · หรือ import `.msapp` ที่เก็บไว้ |
| ทั้ง environment (ถ้าใช้ Dataverse) | admin center → **Backups → Restore** |

### กู้ทั้งลิสต์จาก CSV (restore flow)
1. เลือกไฟล์ backup วันที่ต้องการใน `99.Backup/<day>/<List>.csv`
2. **flow "Restore List"** (manual trigger รับชื่อลิสต์ + วันที่):
   - Get file content (CSV) → **Parse** (split บรรทัด/คอลัมน์ หรือ Office Script) 
   - Apply to each row → **Upsert** กลับเข้าลิสต์ด้วย **key เดิม** (เช่น `Title`/`day_key|job_no`) → ของเดิมที่ยังอยู่ = ทับให้ตรง backup, ที่หายไป = เพิ่มกลับ
   - ⚠️ ทำใน **ไซต์ทดสอบก่อน** (doc 35) ให้มั่นใจ แล้วค่อยกับ prod · หรือแจ้งผู้ใช้หยุดใช้ช่วง restore
> ง่ายสุดถ้าต้องกู้เร่งด่วน: เปิด CSV ใน Excel → **Edit in grid view** ของลิสต์ → วางทับ (ลิสต์เล็ก) · ลิสต์ใหญ่ใช้ restore flow/Office Script

---

## ครอบคลุมแค่ไหน (เทียบฟังก์ชัน)
| ข้อมูลจากฟังก์ชัน | versioning | CSV รายวัน |
|---|---|---|
| จ่ายงาน/รับทราบ/เริ่ม/จบ (PAS_Porter lp_*) | ✓ รายแถว | ✓ |
| assignment + acknowledge (PAS_Assignment) | ✓ | ✓ |
| roster/กะ/OT (PAS_Duty) | ✓ | ✓ (ลิสต์ใหญ่ — ปรับความถี่) |
| สิทธิ์/PIN (PAS_Users/PAS_Pins) | ✓ | ✓ |
| แลกเวร/ลา (SwapLog/LeaveLog) | ✓ | ✓ |
| ไฟลท์ (PAS_Flights) | ✓ | ✓ |

## หมายเหตุ PDPA
backup มีข้อมูลส่วนบุคคล (ชื่อ/กะ/ไฟลท์) → โฟลเดอร์ `99.Backup` **จำกัดสิทธิ์เฉพาะแอดมิน** · ตั้ง retention (เช่น 90 วัน) ไม่เก็บไม่จำกัด

> ทำ **ชั้น 1 ก่อนเริ่มทดลอง/ใช้จริง** (เปิด versioning ทุกลิสต์) · ชั้น 2 (Daily Backup) ตั้งให้รันก่อน go-live · ชั้น 3 ไว้ใช้ตอนจำเป็น
