# 38 · Office Script export ลิสต์ใหญ่ + Import/Export จากหน้าแอป

ต่อยอด `37` (backup) — (A) backup ลิสต์ใหญ่ให้เร็วด้วย Office Script · (B) ปุ่ม Import/Export ในแอปสำหรับแอดมิน

---

## A · Office Script export ลิสต์ใหญ่ (เร็วกว่าต่อ CSV ใน flow)
flow สร้างสตริง CSV ก้อนใหญ่ (44k แถว) ช้า/หน่วย → ใช้ **Office Script เขียน 2D array ลงชีตรวดเดียว** (`setValues` ก้อนเดียว) แล้วเซฟเป็น .xlsx = backup

สคริปต์: `tools/office-script-export-list.ts` → `main(workbook, sheetName, header[], rows[][], append?)`

### flow "Daily Backup (big list)"
1. **Create file** (SharePoint, `99.Backup/<day>/PAS_Porter.xlsx`) จากไฟล์เทมเพลตเปล่า (หรือ copy template)
2. **วนหน้าดึงข้อมูล** (เหมือน `37` nextLink) → **Select** แปลงเป็น **array ของ array** (ค่าตามลำดับ header)
3. **Run script** (`office-script-export-list`) บนไฟล์นั้น:
   - `sheetName` = "PAS_Porter" · `header` = `["ID","day_key","flight_no","service","lp_porter","lp_state",...]` · `rows` = 2D array
   - ลิสต์ใหญ่มาก → ส่งเป็นก้อน (chunk ~10,000) เรียกซ้ำด้วย **`append = true`**
4. ได้ `PAS_Porter.xlsx` ครบในโฟลเดอร์วันที่

> ข้อดี: setValues ก้อนเดียวเร็วมาก · ข้อจำกัด: พารามิเตอร์ Run script ใหญ่ได้จำกัด → chunk หรือ backup แยกตาม `month_key`
> ลิสต์เล็ก (Users/Pins/TeamPosition) ใช้ CSV ใน flow (`37`) ก็พอ · ลิสต์ใหญ่ (Porter/Duty/Assignment) ใช้วิธีนี้

---

## B · Import / Export จากหน้าแอป (แอดมิน)

> วางปุ่มบน **scrAdminRoles** (หรือหน้า backup เฉพาะ) · gate `varAdmin` · ทุกปุ่มผ่าน **Power Automate** (canvas เขียนไฟล์/อ่านไฟล์เองไม่ได้)

### B1. Export (ดาวน์โหลดข้อมูลปัจจุบัน)
flow **"Export List"** (PowerApps V2, input `listName`, `dayKey?`):
- วน Get items (กรอง day_key ถ้าให้) → Create CSV → **Create file** `99.Export/<listName>_<now>.csv` → **Create share link** → **Respond** คืน `url`

ปุ่มในแอป:
```powerapps
btnExport.DisplayMode = =If(varAdmin, DisplayMode.Edit, DisplayMode.Disabled)
btnExport.OnSelect =
  =Set(varExpUrl, 'Export List'.Run(ddExpList.Selected.Value, varDayKey).url);
   If(!IsBlank(varExpUrl), Launch(varExpUrl));   // เปิด/ดาวน์โหลดไฟล์
   Notify("สร้างไฟล์ส่งออกแล้ว", NotificationType.Success)
```
> `Launch(url)` เปิดลิงก์ไฟล์ให้โหลด · หรือ flow ส่งเข้าเมลแอดมินแทนก็ได้

### B2. Import (อัปโหลดไฟล์ → upsert เข้า list)
**ตัวเลือกอัปโหลดไฟล์ในแอป:**
- ใช้ **Attachment control** (อยู่บน Edit form) หรือคอนโทรล **Add picture/file** → ได้ไฟล์ → ส่งเข้า flow เป็น base64
- หรือให้แอดมินวางไฟล์ใน library `99.Import/` แล้วปุ่มสั่ง flow ประมวลผล (ง่าย/เสถียรกว่า)

flow **"Import List"** (PowerApps V2, input `listName`, `fileContent`):
1. แปลง base64 → ข้อความ → **แยกบรรทัด/คอลัมน์** (หรือ Office Script parse) → array
2. **Apply to each** row → **Upsert** เข้า `listName` ด้วย **key เดิม** (Title/day_key|job_no/emp_code_date) → ซ้ำ=อัปเดต ไม่ซ้ำ=เพิ่ม
3. **Respond** คืนจำนวน created/updated/skipped

ปุ่มในแอป:
```powerapps
btnImport.DisplayMode = =If(varAdmin, DisplayMode.Edit, DisplayMode.Disabled)
btnImport.OnSelect =
  =Set(varImp, 'Import List'.Run(ddImpList.Selected.Value, First(attImport.Attachments).Value));
   Notify("นำเข้า " & varImp.created & " เพิ่ม · " & varImp.updated & " อัปเดต", NotificationType.Success)
```

### ⚠️ กันพลาดตอน Import (สำคัญ)
- **ยืนยันก่อน** (ป๊อปอัป "จะทับข้อมูล <list> ด้วย N แถว?") — กันกดพลาด
- **ทดสอบที่ไซต์ทดสอบก่อน** (doc 35) โดยเฉพาะลิสต์ใหญ่
- **Export (backup) ก่อน Import เสมอ** — import flow เรียก Export List อัตโนมัติก่อน upsert ก็ได้ (snapshot กันพลาด)
- Import **เฉพาะคอลัมน์ข้อมูล** · อย่าแตะ lp_state/acknowledged ของแถวที่ "กำลังทำงาน/จบแล้ว" (เช็กเหมือน `wc-08` idempotent)
- gate `varAdmin` + log ว่าใคร import เมื่อไหร่ (เขียนลง list log)

---

## สรุปใช้ตัวไหน
| งาน | วิธี |
|---|---|
| backup ลิสต์เล็กรายวัน | CSV ใน flow (`37`) |
| backup ลิสต์ใหญ่ (Porter/Duty) | **Office Script** 2D array (`38` A) หรือ chunk |
| แอดมิน export ดู/ส่งต่อ | ปุ่ม Export → flow → `Launch(url)` (`38` B1) |
| แอดมิน import แก้ก้อนใหญ่ | ปุ่ม Import → flow upsert by key + ยืนยัน + backup ก่อน (`38` B2) |

> Import/Export หน้าแอป = เครื่องมือแอดมิน · ไม่เปิดให้ USER · ทุกการเขียนก้อนใหญ่ควรมี snapshot ก่อน (`37`)
