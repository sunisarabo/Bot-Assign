# WC/Porter · 08 · Pre-case ↔ Case จากแหล่งเดียว (pre-booking → cases)

> ⚠️ **สคีมา:** แอปจริงใช้ตาราง **`PAS_Porter` (คอลัมน์ `lp_*`)** สำหรับงานพอตเตอร์ — `pas_wc_case`/`pas_wc_*` ในเอกสารชุดนี้เป็นดีไซน์คู่ขนาน ต้อง **map เป็น `PAS_Porter`/`lp_*` ของจริงก่อนใช้** (ขอ export `scrLP` + รายชื่อคอลัมน์ `lp_*` เพื่อปรับ flow/ปลายทางให้ตรง)

เป้า (ตามที่ขอ): LP–Porter ดึง **Pre-case** (จองล่วงหน้า) และ **การลง Case** (จ่ายงานจริง) จาก **แหล่งเดียวกัน**
หลัก: **`pas_wc_prebooking` = ต้นทางเดียว** (ไฟล์ PRE-WHEELCHAIR) → สร้าง **`pas_wc_case`** รายเคสของวันให้อัตโนมัติ → LP/พอตเตอร์ทำงานบน `pas_wc_case` ชุดเดียว

```
PRE-WHEELCHAIR (ไฟล์ LP)
   → pas_wc_prebooking   (จองล่วงหน้า: FlightNo · Routing · Sta/Std · Arr/Dep WCHR/WCHS/WCHC/MAAS = จำนวน)
       → [flow/Office Script: แตกจำนวน → รายเคส]
          → pas_wc_case   (รายเคส STANDBY ของวันนั้น · ลิงก์กลับ prebooking)
             → LP จ่ายงาน (scrLP) · พอตเตอร์รับทราบ (scrMe)
```

## 1) คอลัมน์ลิงก์ (idempotent — รันซ้ำไม่เกิดเคสซ้ำ)
เพิ่มใน **`pas_wc_case`**:
- **`CaseNo`** (Text, **Alternate Key**) = `<FlightNo>|<Svc>|<Dir>|<seq>` เช่น `QR842|WCHR|ARR|1`
- **`pas_prebook_ref`** (Text หรือ Lookup→`pas_wc_prebooking`) = อ้างกลับรายการจองต้นทาง

> upsert ด้วย `CaseNo` → สร้างรอบเช้าซ้ำ/กดซ้ำ = อัปเดตแถวเดิม ไม่เพิ่ม (กันเคสซ้ำ)

## 2) Flow "WC Build Cases" (รันเช้าทุกวัน หรือกดเองบน scrLP)
make.powerautomate.com → **Scheduled** (เช่น 05:00) หรือ **Instant** (ปุ่มใน scrLP)
1. **List rows** `pas_wc_prebooking` · filter `BookingDate = utcNow('yyyy-MM-dd')`
2. **Apply to each** row → สำหรับแต่ละบริการที่จำนวน > 0 (ขาเข้า/ขาออก × WCHR/WCHS/WCHC/MAAS):
   - **Compose** ชุด `{ svc, dir, qty }` ที่ qty>0 (เช่น Arr WCHR=2, Dep MAAS=1)
   - **Do until / nested apply** วน `seq` = 1..qty → **Upsert `pas_wc_case`** (key `CaseNo`):
     ```
     CaseNo       = FlightNo & "|" & svc & "|" & dir & "|" & seq
     CaseDate     = BookingDate
     Airline      = Airline · FlightNo = FlightNo
     ServiceType  = svc (choice) · IsArrival = (dir="ARR") · IsDeparture = (dir="DEP")
     Eta = Sta · Etd = Std · Gate = (ถ้ามี) · NotifiedTime = utcNow() (ครั้งแรกเท่านั้น)
     Status       = ถ้าแถวเดิมยัง STANDBY/ไม่มี → STANDBY · ถ้า ON_PROCESS/COMPLETED แล้ว → คงเดิม (อย่ารีเซ็ต)
     pas_prebook_ref = <id ของ prebooking>
     ```
   > "อย่ารีเซ็ตสถานะ" = ก่อน upsert ให้ **Get** แถว CaseNo เดิม ถ้า Status ไม่ใช่ STANDBY ให้ข้าม field Status (กันทับงานที่จ่าย/จบแล้ว)
3. (ออปชัน) เคสที่ generator สร้างไว้แต่ prebooking ถูกยกเลิก → mark `CANCELLED`

> ทางเลือก **Office Script** (ถ้าไฟล์ยังอยู่ SharePoint): อ่าน PRE-WHEELCHAIR → คืน JSON รายเคส → Power Automate upsert (เหมือน `office-script-prewc.ts` ที่มี แต่ส่งออกเป็น "รายเคส" ไม่ใช่ "รายไฟลท์")

## 3) ปุ่มบน scrLP (กดสร้างเคสจาก Pre-WC วันนี้)
ให้ LP กดเองได้เมื่อ pre-booking อัปเดต (ไม่ต้องรอรอบเช้า):
```powerapps
// btnLPBuild (วางข้าง btnLPLoad) — เรียก flow แล้วรีโหลด
btnLPBuild.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnLPBuild.OnSelect =
  ='WC Build Cases'.Run(Text(varWDate, "yyyy-mm-dd"));   // ชื่อ flow ที่สร้างในข้อ 2
   Notify("สร้างเคสจาก Pre-WC วันนี้แล้ว", NotificationType.Success);
   Select(btnLPLoad)
```
> ถ้าไม่อยากทำ flow ตอนนี้: สร้างเคสในแอปด้วย Patch loop จาก `pas_wc_prebooking` ก็ได้ แต่ flow/Script นิ่งกว่า (วน qty + upsert + กันทับสถานะ)

## 4) ผลลัพธ์ "แหล่งเดียว"
- **Pre-case** (วางแผน) และ **Case** (จ่ายจริง) = ตารางเดียว `pas_wc_case` ที่ sourced จาก `pas_wc_prebooking`
- LP (scrLP) เห็นเคส STANDBY ที่มาจาก pre-WC → จ่ายงาน → พอตเตอร์รับทราบที่ scrMe (ดู `32`)
- แก้จำนวนใน pre-booking แล้วรัน build อีกครั้ง → เพิ่ม/ลดเคส โดยไม่ทับงานที่จ่าย/จบแล้ว (idempotent ด้วย `CaseNo`)

> ชื่อ: wc-01 ใช้ `pas_wc_prebooking` (จองล่วงหน้า) · doc `26`/`28` เรียกไฟล์เดิมว่า pre-WC/`pas_prewc` — เป็นตัวเดียวกัน ให้ยึด `pas_wc_prebooking` เป็น schema จริง
