# PAS บน SharePoint — ฐานข้อมูลใหม่ + แอป Microsoft (ไม่ต้อง admin consent · ไม่ต้องซื้อ license เพิ่ม)

**ฐานข้อมูล:** ไซต์ <https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA> (`Shared Documents` + SharePoint Lists)
**แอป:** Power Apps (Canvas) — เปิดได้บนเว็บ · มือถือ (แอป Power Apps) · ฝังใน Microsoft Teams

```
ไฟล์เวร .xlsx (ปี/เดือน/วัน)          Power Automate (3 flows)             SharePoint Lists (ฐานข้อมูล)         แอป
Shared Documents/<ปี>/<เดือน>/  ──►  เฝ้าทั้งไลบรารี → คิว → Run script  ──►  PAS_Manpower / PAS_Duty /   ──►  Power Apps (เว็บ/มือถือ/Teams)
 เดือนใหม่/ปีใหม่ = ไม่ต้องตั้งค่า        วันที่อ่านจาก path · ลบวันเดิม → $batch   PAS_Assignment / ImportLog …       Dashboard · Timetable · Util · Gantt
```

ใช้แต่ **ตัวต่อมาตรฐาน** (SharePoint · Excel Online (Business)) → พนักงานที่มี M365 ใช้ได้เลย
ไม่ต้องลงทะเบียนแอปใน Entra ไม่ต้องขอ admin consent และไม่ต้องใช้ Power Apps Premium / Power BI Pro

## ไฟล์ในโฟลเดอร์นี้
| ไฟล์ | หน้าที่ |
|---|---|
| `lists.def.json` | นิยามฐานข้อมูล: 8 Lists + คอลัมน์ + ชนิด + index (แหล่งเดียว แก้ที่นี่) |
| `provision-lists.js` | สคริปต์วางใน **Console ของเบราว์เซอร์** บนไซต์ → สร้าง Lists ทั้งหมด + โฟลเดอร์ `PAS-Import` สำรอง (รันซ้ำได้) |
| `import-roster.ts` | **Office Script**: อ่านไฟล์เวร (MANPOWER + แท็บทีม) → แถวพร้อมลง List (คำนวณ Util/busy ให้แล้ว) · **หาวันที่จาก path** (รองรับเดือนใหม่/ปีใหม่ · EN/ไทย · ค.ศ./พ.ศ.) · ส่งออกเป็น `$batch` |
| `import-master.ts` | **Office Script**: ไฟล์ Manpower (PS-Manpower) หรือ `00.Master.xlsx` → `PAS_Employees` (upsert ตามรหัส · Total + BKK Batch · หาคอลัมน์จากหัวตาราง) |
| `POWERAPPS-dashboard.md` | หน้า **▦ Dashboard** ครบเท่าเดิม (Hero · HKT/BKK/Globex · Porter · กราฟ · เตือน OT · เทียบ MANPOWER · by Team · by Position) |
| `POWERAPPS-flights.md` | หน้า **✈ Flights & SLA** (ต้องการ/มีจริง/ขาด ต่อเฟส ต่อไฟลท์ — ตรงกับ SLA.gs ทุกไฟลท์ในชุดทดสอบ) + การ์ดไฟลท์ขาดด่วนบน Dashboard |
| `POWERAPPS-weekflights.md` | หน้า **🗓️ ไฟลท์สัปดาห์** (จากไฟล์ Assignment · ไฟลท์/วัน · คนตาม SLA ต่อเฟส · คน~ · พีคออก · จัดแล้ว/ขาด) |
| `POWERAPPS-assigncheck.md` | หน้า **🧭 ตรวจ Assign** รายคน (ไฟลท์ในกะ/OT/นอกกะ · ช่วงว่าง · OT เหมาะสม? — ตรงกับ AssignCheck.gs ทุกคอลัมน์ในชุดทดสอบ) |
| `POWERAPPS-support.md` | หน้า **🆘 Support / เติมคน** (ไฟลท์ขาด → ใครว่าง+รู้ระบบมาช่วย · ข้อความ SOS — ตรงกับ SLA.gs ทุกแถวในชุดทดสอบ) |
| `POWERAPPS-ot.md` | หน้า **OT Dashboard** (รายเดือน · รายสัปดาห์ · เตือน OT รายคน 36/144 ชม.) — แทนหน้าเดิมของ PAS |
| `POWERAPPS-weekhours.md` | หน้า **⏱️ ชม./สัปดาห์** (48 ชม. / 7 วัน / OT 36 ต่อสัปดาห์ ตามระเบียบ) — แทนหน้าเดิม |
| `POWERAPPS-weeksummary.md` | หน้า **📊 สรุปสัปดาห์** (มาทำงาน · ป่วย · แวค · กิจ · OT รายวัน จ.–อา. + รวม) — แทนหน้าเดิม |
| `POWERAPPS-datacheck.md` | หน้า **🩺 ตรวจข้อมูล** (8 หมวดเดิม + วันที่ไฟล์ผิด / นำเข้าไม่สำเร็จ / วันที่ไม่มีไฟล์ / ไม่มีในรายชื่อ) — ตรวจตอนนำเข้า เก็บใน `PAS_DataIssue` |
| `import-porter.ts` · `FLOW-porter.md` | **Flow E** Porter Summary + Pre-Wheelchair (ไฟล์รายเดือน แท็บรายวัน) → `PAS_Porter` / `PAS_PorterStaff` / `PAS_PreWC` |
| `import-flights.ts` · `FLOW-flights.md` | **Flow F** ตารางบินรายวัน (Daily Flight Schedule Record) → `PAS_Flights` (ชนิดเครื่อง · STA/STD · ขา · ยกเลิก) |
| `FLOW-master.md` | **Flow D** sync รายชื่อพนักงานอัตโนมัติ (ตรวจไฟล์ทุก 30 นาที เขียนเฉพาะที่เปลี่ยน) |
| `batch-delete.ts` | Office Script ตัวช่วย: ID → `$batch` ลบ (ใช้ก่อนนำเข้าวันเดิมซ้ำ) |
| `FLOW-import.md` | 3 flows: **A** เฝ้าทั้งไลบรารี → **B** นำเข้าจากคิว (ทุก 15 นาที) → **C** ย้อนหลังทั้งเดือน/ปี |
| `POWERAPPS-app.md` | สร้างแอป Power Apps + สูตร Power Fx ครบทุกหน้า |
| `build.js` / `provision-lists.src.js` | ต้นฉบับ — แก้ `lists.def.json` แล้วรัน `node sharepoint-app/build.js` เพื่อสร้าง `provision-lists.js` ใหม่ |

## ขั้นตอน (ประมาณ 1–2 ชั่วโมง ครั้งเดียว)
1. **สร้างฐานข้อมูล** — เปิดไซต์ → `F12` → Console → วาง `provision-lists.js` → Enter → รอ `✅ เสร็จ`
   (ต้องเป็น Owner หรือ Member ของไซต์ · ถ้า Console ขึ้นเตือนเรื่องการวาง ให้พิมพ์ `allow pasting` ก่อน)
2. **ติดตั้ง Office Scripts** — เปิดไฟล์เวรไฟล์ใดก็ได้ใน Excel บนเว็บ → `Automate → New Script` → วาง `import-roster.ts` → Save ชื่อ `import-roster` · ทำซ้ำกับ `batch-delete.ts` → ชื่อ `batch-delete`
3. **สร้าง 3 flows** ตาม `FLOW-import.md` → กด Flow C ใส่โฟลเดอร์เดือนปัจจุบัน เพื่อนำเข้าย้อนหลังครั้งแรก
4. **สร้างแอป** ตาม `POWERAPPS-app.md` → Publish → Share ให้กลุ่ม Admin/หัวหน้าทีม → (เลือกได้) เพิ่มเป็นแท็บใน Teams
5. **รายชื่อพนักงาน** `PAS_Employees` — sync อัตโนมัติจากไฟล์ Manpower ตาม `FLOW-master.md` · `PAS_Teams` กรอกครั้งเดียว (Edit in grid view → วางจาก Excel)

## Lists ที่ได้ (สรุป)
| List | คีย์ (Title) | ใช้ทำอะไร |
|---|---|---|
| `PAS_Manpower` | `วันที่\|ทีม` | KPI + ตารางรายทีม (total/working/sick/annual/training/OT/Util%) |
| `PAS_Duty` | `วันที่\|ทีม\|รหัส` | Timetable รายคน · bucket · กะ · OT · duty_min / busy_min / util_pct |
| `PAS_Assignment` | รหัสไฟลท์ | ไฟลท์/งานที่ได้รับรายคน · STA/STD/OP/CL · ช่วงงาน `win_lo–win_hi` (นาที) สำหรับ Gantt |
| `PAS_Flights` · `PAS_Porter` · `PAS_PreWC` | เลขไฟลท์ | ตารางบิน · งาน Porter/Wheelchair · จอง WC ล่วงหน้า (กรอก/วางจาก CSV ใน `powerplatform/templates/`) |
| `PAS_Employees` | รหัสพนักงาน | รายชื่อ · ทีม · แผนก PSA/LL · ตำแหน่ง/กลุ่ม · HKT/BKK/GLOBEX · ACTIVE/RESIGNED — sync จากไฟล์ Manpower |
| `PAS_Teams` | รหัสทีม | master ทีม |
| `PAS_OT_Person` | `วันที่\|รหัส\|ทีม` | OT รายคน/วัน (เฉพาะคนที่มี OT) — เตือน OT สัปดาห์/เดือน |
| `PAS_Holidays` | ชื่อวันหยุด | วันหยุดประเพณี → OT นักขัต X1 · **ขึ้นปีใหม่เพิ่มที่นี่** (ตั้งต้นปี 2569 ให้แล้ว) |
| `PAS_DataIssue` | `วันที่\|หมวด\|ลำดับ` | จุดที่ควรแก้ในไฟล์เวร (ตรวจตอนนำเข้า) |
| `PAS_FlightSLA` | `วันที่\|ไฟลท์` | SLA ต่อไฟลท์ต่อวัน (คำนวณตอนนำเข้าเวร) |
| `PAS_Support` | `วันที่\|ไฟลท์\|เฟส` | ไฟลท์ขาด SLA ต่อเฟส + คนที่ว่างช่วยได้ (คำนวณตอนนำเข้าเวร) |
| `PAS_SLARules` | รหัสสาย | กำลังคนมาตรฐานต่อเที่ยวบิน (แทนชีต STANDARD MANNING · แก้ได้) |
| `PAS_ImportLog` | path ไฟล์ | คิว/ประวัตินำเข้า 1 แถว/ไฟล์ — สถานะ, วันที่ที่อ่านได้ (และอ่านจากไหน), จำนวนแถว, คำเตือน |

## เดือนใหม่ / ปีใหม่
ไม่ต้องแก้ flow หรือสคริปต์ — สร้างโฟลเดอร์ใหม่แล้ววางไฟล์ตามปกติ (เช่น `2027/01.JAN27/01JAN.xlsx`)
- flow เฝ้า **ทั้งไลบรารี** ไม่ผูกชื่อโฟลเดอร์
- วันที่อ่านจาก **ชื่อไฟล์ + โฟลเดอร์เดือน/ปี** (ปีจากโฟลเดอร์เดือน เช่น `SEP26` ชนะโฟลเดอร์ปี — กันกรณี `2025/09.SEP26`)
- ไม่มีปีใน path เลย → เลือกปีที่ใกล้วันนี้ที่สุด (ไฟล์ `03JAN` ที่วางช่วงปลาย ธ.ค. = ม.ค. ปีหน้า)
- รายละเอียดรูปแบบที่รองรับ + วิธีย้อนหลัง → `FLOW-import.md`

หลักออกแบบ:
- ทุก List รายวันมี **`day_key` (ข้อความ `YYYY-MM-DD`, indexed)** → กรองรายวันแบบ delegable ใน Power Apps และลบ/นำเข้าซ้ำได้ใน flow โดยไม่ติด timezone หรือเพดาน 5,000 แถว
- เวลาเก็บเป็นข้อความ `HH:MM` (คนอ่าน/กรอกง่าย) + คอลัมน์คำนวณ **`*_min`** (นาที) ให้อัตโนมัติ เช่น `sta` → `sta_min`
- นำเข้าแบบ **idempotent**: flow ลบแถวของวันนั้นก่อนแล้วเพิ่มใหม่ → วางไฟล์ซ้ำ/แก้ไฟล์แล้ววางใหม่ได้

## สิทธิ์ข้อมูล
- ใครเปิดแอปได้ = ใครมีสิทธิ์อ่าน Lists ในไซต์นี้ → แชร์ไซต์ให้กลุ่มที่ต้องการแบบ **Read** (พนักงาน) / **Edit** (ทีม Admin)
- ไฟล์เวรต้นฉบับใช้สิทธิ์ของไลบรารี — ถ้าไม่อยากให้พนักงานเห็นไฟล์ ให้ break inheritance ที่โฟลเดอร์ปี (flow ยังอ่านได้ด้วยสิทธิ์คนสร้าง flow)

## ทางเลือกเว็บแอปเต็มรูป (ภายหลัง)
`graph/spa/` (เว็บ HTML + MSAL อ่าน Excel ในไซต์เดียวกันผ่าน Microsoft Graph) ใช้ได้เมื่อ IT อนุมัติ consent ให้ app registration
— ชุด `sharepoint-app/` นี้คือเส้นทางที่ **เริ่มใช้ได้ทันที** โดยไม่ต้องรอ IT
