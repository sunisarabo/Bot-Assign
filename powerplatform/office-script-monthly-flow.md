# รัน Office Script ทั้งแฟ้มรายเดือน (Power Automate) — ไม่ต้องทำทีละไฟล์

ให้ **Power Automate** วนไฟล์เวรทุกไฟล์ในโฟลเดอร์เดือน แล้วสั่งรัน Office Script `PAS Dashboard`
(ตัวต่อ SharePoint + Excel Online = มาตรฐาน · **ไม่ต้อง admin consent** · ฟรี)

## เตรียม
1. เซฟ Office Script (`office-script-dashboard.ts`) ใน Excel Online → ตั้งชื่อ **`PAS Dashboard`**
   → มันจะไปอยู่ใน OneDrive ของคุณ (My Files/Office Scripts) เรียกจาก Power Automate ได้

## สร้าง Flow
make.powerautomate.com → **Create → Instant cloud flow** (หรือ Scheduled)
1. **Trigger:** Manually trigger a flow (หรือ Recurrence รายวัน)
2. **SharePoint – Get files (properties only)**
   - Site Address: ไซต์ HKT PSA Daily Assignment
   - Library: Documents · Folder: `/2025/09.SEP26` (โฟลเดอร์เดือนที่ต้องการ)
3. **Apply to each** → `value` (ไฟล์ที่ได้)
   - (ทางเลือก) **Condition:** `Name` ends with `.xlsx` เท่านั้น
   - **Excel Online (Business) – Run script**
     - Location: **SharePoint** · Document Library: Documents · File: **Identifier** (จากลูป)
     - Script: **PAS Dashboard**
4. **Save → Run**

→ ทุกไฟล์เวรในเดือนนั้นจะถูกเติมชีต **Dashboard** + แก้สูตรพัง อัตโนมัติ

## ตั้งอัตโนมัติรายวัน (ทางเลือก)
เปลี่ยน trigger เป็น **Recurrence** (เช่น ทุกวัน 06:00) + ชี้โฟลเดอร์เดือนปัจจุบัน →
ไฟล์ใหม่ของวันจะมี Dashboard ให้เองทุกเช้า

## หมายเหตุ
- Run script ต่อไฟล์ใช้เวลาสักครู่ (ไฟล์ละ ~10–30 วิ) · เดือนละ ~30 ไฟล์ = ไม่กี่นาที
- ถ้าไฟล์ใหญ่/ช้า ปรับ Concurrency ของ Apply to each ได้
- **Porter/Pre-WC** อยู่คนละไฟล์ → ถ้าต้องการรวม ให้เพิ่มสเต็ปอ่านไฟล์ Porter/Pre-WC แล้วส่งค่าเข้าสคริปต์ (ทำเพิ่มภายหลังได้)
