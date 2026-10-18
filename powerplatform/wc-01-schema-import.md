# WC/Porter · 01 · ตาราง Dataverse + import ข้อมูลตั้งต้น

ย้าย WC Tracker (รถเข็น/พอตเตอร์) เข้า Power Platform · รายละเอียดฟิลด์เต็มดู `porter-wc-migration.md`
> พอตเตอร์ ~76 คน **ไม่มีบัญชี M365** → ฝั่งพอตเตอร์เป็นแอป/จอรวมไม่ล็อกอิน · LP/ซุปใช้ Power Apps · **อ่าน-เขียนตารางชุดเดียวกัน**

## ตารางที่ต้องสร้าง (core)
| ตาราง | Primary | คอลัมน์หลัก |
|---|---|---|
| **pas_wheelchair** | ControlNo | ShortNo · Type(choice: ใหญ่/เคบิ้น/กลาง/พับขา/Extra) · IsActive |
| **pas_wc_staff** | StaffId | FullNameTh · NickTh · NameEn · IsActive |
| **pas_wc_case** | (auto) CaseId | CaseDate · CaseNo · Airline · FlightNo · Status(STANDBY/ON_PROCESS/COMPLETED/CANCELLED) · Eta · Etd · Gate · NotifiedTime · PickupTime · DeliverTime · ServiceType(WCHR/WCHS/WCHC/MAAS/AVIH) · IsArrival · IsDeparture · Remark · **pas_acknowledged · pas_ack_at · pas_ack_by** |
| **pas_wc_caseporter** (M:N) | (auto) | Case(lookup) · Staff(lookup) · AssignedAt · AssignedBy |
| **pas_wc_trip** | TripId | TripDate · Wheelchair(lookup) · Staff(lookup) · FlightCode · StartTime(DateTime) · EndTime · DurationMin · TripStatus(กำลังบริการ/เสร็จสิ้น/ค้าง) · Case(lookup) |
| **pas_wc_queue** | (auto) | QueueDate · Staff(lookup) · Shift · State(ว่าง/กำลังบริการ) · TripsToday · SortOrder · UpdatedAt |
| **pas_wc_rosterday** | (auto) | RosterDate · Staff(lookup) · TimeIn · TimeOut · OtIn · OtOut · DutyStatus · LeaveCode |
| **pas_wc_prebooking** | (auto) | BookingDate · FlightNo · Airline · Routing · Sta · Std · CtOpen · CtClose · Arr/Dep WCHR..MAAS |
| **pas_wc_status** (แจ้งซ่อม) | (auto) | Wheelchair(lookup) · Status(ซ่อม/ใช้งานได้) · Note · ReportedBy · ReportedAt |

> DailySummary / AssignLog / DemandWindow → ไม่ต้องทำตาราง (เป็น aggregate / audit ในตัว Dataverse)

## import ข้อมูลตั้งต้น (จาก Index.html เดิม)
สคริปต์ `tools/extract_wc_data.py` ดึง STAFF/WC/ROMAN ที่ hardcode → CSV:
```bash
python3 tools/extract_wc_data.py  /path/wheelchair-tracking/Index.html  ./wcdata
```
ได้ 2 ไฟล์:
- **pas_wc_staff.csv** (76 คน) → import เข้า `pas_wc_staff` (StaffId=primary)
- **pas_wheelchair.csv** (67 คัน) → import เข้า `pas_wheelchair` (ControlNo=primary · Type choice)

> ⚠️ ก่อนนำเข้าข้อมูลเก่า (เคส/trip) ต้อง **กระทบยอดชื่อ** — ชีท PORTER SUMMARY เขียนชื่อ EN แบบสะกดไม่นิ่ง
> (`NameEn` ไว้ช่วย map เท่านั้น · คีย์จริง = StaffId) · มี 2 ชื่อในชีทที่เคยจับไม่ได้ (Sirichai #76 · NAWAF #77) — เช็กก่อน

## business rules ที่ต้องย้ายมา (server-side → plug-in/flow/business rule)
(จาก `porter-wc-migration.md` ข้อ "กติกาธุรกิจ")
1. เคสมีเวลาส่งแล้ว **ห้ามเปลี่ยนคน** · 2. งานกำลังทำ เพิ่มคนช่วยได้ ถอดคนที่ทำอยู่ไม่ได้
3. รถเข็นมีคนใช้ **เริ่มซ้ำไม่ได้** · 4. **งานค้าง >12 ชม. ไม่นับว่ากำลังทำ** + ปิดได้
5. สถานะเคสไม่ถอยหลัง · 6. ไม่เขียนทับเวลาที่กรอกแล้ว · 7. คิวเรียงเคสน้อยสุดก่อน (ไม่ใช่ FIFO)
8. พอตเตอร์เริ่มได้เฉพาะเคสตัวเอง · 9. ปิดงานค้างไม่เดาเวลาจบ · 10. LP ปิดงานค้างได้ พอตเตอร์ไม่ได้

## ลำดับทำ
1. สร้างตาราง core (บน) + optionsets
2. import `pas_wc_staff` + `pas_wheelchair` (ข้อมูลตั้งต้น)
3. ต่อ Flight/PreBooking จาก source เดิม (หรือใช้ pas_flight ร่วม)
4. หน้า LP (Power Apps): คิว · จ่ายงาน · สรุป · ตารางเวร → Power Fx (ทำต่อ)
5. ฝั่งพอตเตอร์: แอป/จอไม่ล็อกอิน + แจ้งเตือน (ดู `18-notify-steps.md` In-app + LINE)
