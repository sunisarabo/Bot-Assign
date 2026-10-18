# Power BI Desktop — Dashboard จาก Excel บน SharePoint (ไม่ต้อง admin consent)

Power BI Desktop ต่อ SharePoint/Excel ด้วย **login ตัวคุณเอง** (เป็นแอป Microsoft ที่อนุมัติไว้แล้ว) →
ไม่ต้องขอ admin consent เหมือนแอปที่เราเขียนเอง

> เริ่มจาก **แดชบอร์ด MANPOWER** (แท็บ MANPOWER ในไฟล์เวร เป็นตารางสะอาด ทำง่ายสุด/ได้ผลไว)
> ส่วน Util/Gantt (จากแท็บรายทีมที่ layout ซับซ้อน) ทำใน Power BI ยาก — แนะนำใช้เว็บแอป (ต้อง consent) ถ้าต้องการส่วนนั้น

## 0) เตรียม
- ติดตั้ง **Power BI Desktop** (ฟรี — Microsoft Store ค้น "Power BI Desktop" หรือ powerbi.microsoft.com/downloads)
- เปิดโปรแกรม (Windows)

## 1) ต่อไฟล์ Excel บน SharePoint (ทีละไฟล์ — ง่ายสุดสำหรับเริ่ม)
1. เปิดไฟล์เวรวันนึงบน SharePoint (เบราว์เซอร์) → มุมขวาบน **...** หรือแถบที่อยู่ → คัดลอก **ลิงก์ไฟล์** (URL ที่ลงท้าย `.xlsx`)
2. Power BI Desktop → **Home → Get data → Web**
3. วางลิงก์ไฟล์ → OK → ถ้าถาม auth เลือก **Organizational account → Sign in** (บัญชี M365 ของคุณ) → Connect
   *(ถ้า Web ไม่ติด ใช้ **Get data → More → SharePoint folder** → ใส่ Site URL `https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA` → Sign in → Navigate หาไฟล์)*
4. หน้าต่าง Navigator → ติ๊กชีต **MANPOWER** → กด **Transform Data** (ไม่ใช่ Load)

## 2) จัดข้อมูล MANPOWER (Power Query)
ในหน้าต่าง Power Query:
1. **Use First Row as Headers** (แถบ Home) — ถ้าหัวตารางยังไม่ขึ้น
2. เลือกคอลัมน์แรก (ทีม) → **Filter** → เอาเฉพาะแถวที่ขึ้นต้น **"Team ("** (Text Filters → Begins with → `Team (`)
3. (ทางเลือก) Add Column → Custom column ดึงรหัสทีม: `Text.BetweenDelimiters([ทีม], "(", ")")`
4. ตั้งชนิดคอลัมน์ตัวเลข (ทำงานจริง/OT/ลา) เป็น **Whole Number / Decimal**
5. **Close & Apply**

## 3) ทำวิชวล (แดชบอร์ด)
ลากวิชวลจากแถบขวา:
- **Card:** ผลรวม "ทำงานจริง (คน)" → KPI คนทำงานรวม · อีก Card = ผลรวม OT
- **Clustered bar chart:** แกน = ทีม, ค่า = ทำงานจริง → เทียบกำลังคนรายทีม
- **Stacked column:** ทีม × (ทำงานจริง/ลาป่วย/ลาพักร้อน/อบรม) → สัดส่วนสถานะ
- **Table:** ทีม, ทั้งหมด, ทำงานจริง, OT, อัปเดตโดย
- **Slicer:** ทีม (ให้กรองได้)

## 4) (ขั้นสูง) รวมหลายวันอัตโนมัติ
Get data → **SharePoint folder** → Site URL → **Combine Files** → กรอง `Folder Path` เฉพาะ `/Shared Documents/2025/...` และชีต MANPOWER → ได้เทรนด์รายวัน (ใส่ slicer วันที่)

## 5) แชร์ให้คนอื่น
- **ฟรี:** เซฟไฟล์ `.pbix` ไว้บน SharePoint → คนอื่นเปิดด้วย Power BI Desktop ดูเองได้ (แต่ต้องมีโปรแกรม)
- **ออนไลน์/มือถือ (สะดวกกว่า):** Publish → Power BI Service — **แต่ผู้เปิดดูต้องมี Power BI Pro** (มีค่าไลเซนส์)

> ข้อจำกัด: Power BI Desktop สร้างบนเครื่องคุณ · การแชร์ให้พนักงานหลายคนดูออนไลน์ต้องมี Pro
> ถ้าต้องการเว็บที่ทุกคนเปิดฟรี + มี Util/Gantt เต็ม → ต้องกลับไปทาง "เว็บแอป + IT กด consent 1 ครั้ง"
