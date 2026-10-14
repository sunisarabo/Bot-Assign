# HANDOFF — ระบบ PAS (PSA-HKT จัดกำลังพลรายวัน · AOTGA ภูเก็ต)

สรุปสถานะโปรเจกต์สำหรับทำต่อ/ส่งมอบ · อัปเดต 2026-10

## ภาพรวม
ระบบจัดกำลังพล + มอบหมายงานรายวันของทีมบริการภาคพื้น AOTGA ภูเก็ต
- **ของเดิม:** Google Apps Script + Google Sheets (อ่านไฟล์เวรรายวัน → dashboard/ตรวจงาน/SLA/Productivity)
- **กำลังย้าย:** ออกจาก Google → Microsoft (องค์กรใช้ Microsoft 365)

**repo:** `sunisarabo/Bot-Assign` · **branch:** `claude/blissful-clarke-TEW22` · **PR #2 (draft, open)**

---

## แหล่งข้อมูลจริง (SharePoint)
- Site: **HKT PSA Daily Assignment** — `https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA`
- ไฟล์เวรรายวัน (Excel): `/Shared Documents/2025/<เดือน เช่น 09.SEP26>/<วัน เช่น 27SEP>.xlsx`
- แต่ละไฟล์: แท็บ **MANPOWER** (ฟอร์มกำลังพล สะอาด) + แท็บรายทีม (SQ/TR/EY/EK/AK/PORTER/KE/PVTLP/CHN/JQ/QR/PG/SU/CHARTER/TK/WYWK/ADMIN DOC/PORTER CREWSIGN)
- **Porter** และ **Pre-WC** อยู่**คนละโฟลเดอร์/คนละไฟล์** บน SharePoint (ยังไม่ได้แมป)

### คอลัมน์แท็บทีม (0-based getValues)
`0=ID · 2=NAME · 3=SHIFT · 4=IN(เริ่มกะ) · 5=OUT · 6=Total Hrs · 12=OT ก่อนกะ(M) · 15=OT หลังกะ(P) · 16=STATUS · 17=REMARK`
ไฟลท์เริ่มคอลัมน์ **19 (T)** ทีละ 4 คอลัมน์ (สูงสุด 6 ไฟลท์) · หัวไฟลท์อยู่แถวที่คอลัมน์ 18(S) = `FLIGHT` / `STA / STD` / `OP / CL`
(ข้อมูลเริ่มแถวที่ ID เป็นตัวเลข · ข้าม "Ex. ..." ที่เป็นตัวอย่าง)

---

## ⚠️ ข้อจำกัดที่เจอมาแล้ว (สำคัญมาก — กำหนดทุกการตัดสินใจ)
1. **บัญชี `hktadminpsa@aotga.com` ไม่ใช่ Global Admin** → กด "Grant admin consent" ไม่ได้ (ปุ่มเทา)
   → **อะไรที่ต้อง admin consent ใช้ไม่ได้** (เว็บแอป custom ที่อ่าน SharePoint ผ่าน Graph ติดตรงนี้)
2. **ไม่มี Azure subscription** → โฮสต์ App Service/Container Apps ไม่ได้
3. **ไม่มี Power BI Pro** → แชร์รายงาน Power BI ออนไลน์ไม่ได้ (ฟรีได้แค่ Desktop)
4. **ห้ามเอาข้อมูลพนักงาน (ชื่อ/กะ/ไฟลท์) ขึ้นเว็บสาธารณะ** (PDPA) — เคยทำ public no-login แล้วหยุด เพราะเสี่ยง
5. เครื่องผู้ใช้ **เปิด Terminal ไม่ได้** / ไม่สะดวกติดตั้งโปรแกรม

→ ทางที่ "ผ่านทุกข้อจำกัด" = **Office Scripts ใน Excel Online** (รันเป็นผู้ใช้เอง · ฟรี · ไม่ต้อง consent · อยู่ใน Microsoft)

---

## ✅ ทางที่เลือกเดินตอนนี้: Office Scripts
**ไฟล์:** `powerplatform/office-script-dashboard.ts`
ทำ 3 อย่างในไฟล์เวร (รันใน Excel Online → Automate → New Script → วาง → Run):
1. แก้สูตรพังจากการแปลง Google→Excel:
   - ลบ `_xludf.` ทุกสูตร → แก้ `#NAME?` (จาก TEXTJOIN)
   - `MANPOWER!K` (OT รวม): `SUMPRODUCT+IF` → `SUM` → แก้ `#VALUE!`
2. สร้างชีต **Dashboard**: KPI (คนทำงาน/ทีม/OT/Util เฉลี่ย/พีค) + ตารางรายทีม(+Util%) + กราฟกำลังคนรายชั่วโมง (อยู่เวร vs ติดงาน)
3. Util%/รายชั่วโมง = พอร์ตตรรกะจาก `graph/compute.js` (busy-window: เคาน์เตอร์ OP–CL / ขาออก STD-60 / ขาเข้า STA+45 · merge ช่วงซ้อน)

**รันทั้งเดือน (ไม่ทีละไฟล์):** `powerplatform/office-script-monthly-flow.md`
→ Power Automate: Get files (โฟลเดอร์เดือน) → Apply to each → Excel "Run script" = PAS Dashboard

**สถานะ:** สคริปต์เขียนเสร็จ + push แล้ว · รอผู้ใช้ยืนยันว่ารันผ่านใน Excel Online (ยังไม่ได้ทดสอบ live)

---

## 🔜 งานค้าง / ขั้นต่อไป
1. **ยืนยัน Office Script รันผ่าน** (Dashboard + Util% + กราฟขึ้นครบ ไม่มี error/timeout)
2. **เพิ่ม Porter + Pre-WC** เข้า Dashboard
   - ต้องได้ **ตัวอย่างไฟล์ Porter + Pre-WC (Excel)** มาแมปคอลัมน์ก่อน
   - แผน: Power Automate อ่านไฟล์ Porter/Pre-WC → ส่งค่าเป็น parameter เข้า Office Script → เพิ่มการ์ด "เคส Porter" + "Pre-WC จอง"
3. (ถาวร) แก้สูตรที่ **แม่แบบ (template)** ให้ Excel-safe ครั้งเดียว จะได้ไม่ต้องแก้ทุกไฟล์

---

## ของสำรองใน repo (เผื่อสถานการณ์เปลี่ยน)
- **`graph/`** — เว็บแอปเต็ม (Node + Microsoft Graph) อ่าน Excel จาก SharePoint + dashboard 5 แท็บ (ภาพรวม/Timetable/Productivity/Gantt/Manpower) · `graph/spa/index.html` = SPA auto-login (ฟรี GitHub Pages) · **ใช้ได้เมื่อได้ admin consent** (Sites.Read.All/Files.Read.All) — ตอนนี้ติด consent
- **`db/` + `backend/`** — เส้นทาง vendor-neutral (PostgreSQL + Node) ถ้าวันหน้าอยากไม่ผูกเจ้าใด
- **`powerplatform/`** — Dataverse schema + script สร้างตาราง (`create-tables.js` — สร้างตารางจริงใน 1 tenant แล้ว) + Power Fx + Power BI + Power Apps(SharePoint List) + templates CSV + parser (`tools/parse_daily_workbook.py`)
- **`MIGRATION.md`** — ภาพรวมการย้าย + Azure deploy (ถ้ามี subscription)
- **ตัวอ่าน workbook (เผื่อ reuse):** `powerplatform/tools/parse_daily_workbook.py` (Python) · `graph/parseDay.js` (JS) — แมปแท็บทีม→duty/assignment (ทดสอบกับ 19SEP จริง: 19 ทีม/571 คน)

## สรุป 1 บรรทัด
**ใช้ Office Scripts ใน Excel Online ทำ dashboard ในไฟล์เวรเอง (ฟรี/ไม่ต้อง consent) → รันทั้งเดือนด้วย Power Automate · งานต่อไป = เพิ่ม Porter/Pre-WC (รอไฟล์ตัวอย่าง)**
