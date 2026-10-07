# PAS บน SharePoint — ฐานข้อมูลใหม่ + แอป Microsoft (ไม่ต้อง admin consent · ไม่ต้องซื้อ license เพิ่ม)

**ฐานข้อมูล:** ไซต์ <https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA> (`Shared Documents` + SharePoint Lists)
**แอป:** Power Apps (Canvas) — เปิดได้บนเว็บ · มือถือ (แอป Power Apps) · ฝังใน Microsoft Teams

```
ไฟล์เวรรายวัน .xlsx                     Power Automate                  SharePoint Lists (ฐานข้อมูล)         แอป
Shared Documents/PAS-Import/  ──►  Run script (import-roster.ts)  ──►  PAS_Manpower / PAS_Duty /   ──►  Power Apps (เว็บ/มือถือ/Teams)
 (วางไฟล์ = นำเข้าอัตโนมัติ)         ลบของวันเดิม → เพิ่มแถวใหม่           PAS_Assignment / Flights / …         Dashboard · Timetable · Util · Gantt
```

ใช้แต่ **ตัวต่อมาตรฐาน** (SharePoint · Excel Online (Business)) → พนักงานที่มี M365 ใช้ได้เลย
ไม่ต้องลงทะเบียนแอปใน Entra ไม่ต้องขอ admin consent และไม่ต้องใช้ Power Apps Premium / Power BI Pro

## ไฟล์ในโฟลเดอร์นี้
| ไฟล์ | หน้าที่ |
|---|---|
| `lists.def.json` | นิยามฐานข้อมูล: 8 Lists + คอลัมน์ + ชนิด + index (แหล่งเดียว แก้ที่นี่) |
| `provision-lists.js` | สคริปต์วางใน **Console ของเบราว์เซอร์** บนไซต์ → สร้าง Lists ทั้งหมด + โฟลเดอร์ `PAS-Import` (รันซ้ำได้) |
| `import-roster.ts` | **Office Script**: อ่านไฟล์เวร (MANPOWER + แท็บทีม) → แถวพร้อมลง List (คำนวณ Util/busy ให้แล้ว) |
| `FLOW-import.md` | สร้าง Power Automate flow นำเข้าอัตโนมัติ (ทีละขั้น) |
| `POWERAPPS-app.md` | สร้างแอป Power Apps + สูตร Power Fx ครบทุกหน้า |
| `build.js` / `provision-lists.src.js` | ต้นฉบับ — แก้ `lists.def.json` แล้วรัน `node sharepoint-app/build.js` เพื่อสร้าง `provision-lists.js` ใหม่ |

## ขั้นตอน (ประมาณ 1–2 ชั่วโมง ครั้งเดียว)
1. **สร้างฐานข้อมูล** — เปิดไซต์ → `F12` → Console → วาง `provision-lists.js` → Enter → รอ `✅ เสร็จ`
   (ต้องเป็น Owner หรือ Member ของไซต์ · ถ้า Console ขึ้นเตือนเรื่องการวาง ให้พิมพ์ `allow pasting` ก่อน)
2. **ติดตั้ง Office Script** — เปิดไฟล์เวรไฟล์ใดก็ได้ใน Excel บนเว็บ → `Automate → New Script` → วาง `import-roster.ts` → Save ชื่อ `import-roster`
3. **สร้าง flow** ตาม `FLOW-import.md` → ทดสอบโดยวางไฟล์เวร 1 วันลง `Shared Documents/PAS-Import`
4. **สร้างแอป** ตาม `POWERAPPS-app.md` → Publish → Share ให้กลุ่ม Admin/หัวหน้าทีม → (เลือกได้) เพิ่มเป็นแท็บใน Teams
5. ใส่ master: `PAS_Teams`, `PAS_Employees` (Edit in grid view → วางจาก Excel ได้เลย)

## Lists ที่ได้ (สรุป)
| List | คีย์ (Title) | ใช้ทำอะไร |
|---|---|---|
| `PAS_Manpower` | `วันที่\|ทีม` | KPI + ตารางรายทีม (total/working/sick/annual/training/OT/Util%) |
| `PAS_Duty` | `วันที่\|ทีม\|รหัส` | Timetable รายคน · bucket · กะ · OT · duty_min / busy_min / util_pct |
| `PAS_Assignment` | รหัสไฟลท์ | ไฟลท์/งานที่ได้รับรายคน · STA/STD/OP/CL · ช่วงงาน `win_lo–win_hi` (นาที) สำหรับ Gantt |
| `PAS_Flights` · `PAS_Porter` · `PAS_PreWC` | เลขไฟลท์ | ตารางบิน · งาน Porter/Wheelchair · จอง WC ล่วงหน้า (กรอก/วางจาก CSV ใน `powerplatform/templates/`) |
| `PAS_Teams` · `PAS_Employees` | รหัสทีม · รหัสพนักงาน | master |

หลักออกแบบ:
- ทุก List รายวันมี **`day_key` (ข้อความ `YYYY-MM-DD`, indexed)** → กรองรายวันแบบ delegable ใน Power Apps และลบ/นำเข้าซ้ำได้ใน flow โดยไม่ติด timezone หรือเพดาน 5,000 แถว
- เวลาเก็บเป็นข้อความ `HH:MM` (คนอ่าน/กรอกง่าย) + คอลัมน์คำนวณ **`*_min`** (นาที) ให้อัตโนมัติ เช่น `sta` → `sta_min`
- นำเข้าแบบ **idempotent**: flow ลบแถวของวันนั้นก่อนแล้วเพิ่มใหม่ → วางไฟล์ซ้ำ/แก้ไฟล์แล้ววางใหม่ได้

## สิทธิ์ข้อมูล
- ใครเปิดแอปได้ = ใครมีสิทธิ์อ่าน Lists ในไซต์นี้ → แชร์ไซต์ให้กลุ่มที่ต้องการแบบ **Read** (พนักงาน) / **Edit** (ทีม Admin)
- ไฟล์เวรต้นฉบับใน `PAS-Import` ใช้สิทธิ์ไลบรารีเดียวกัน — ถ้าไม่อยากให้พนักงานเห็นไฟล์ ให้ break inheritance ที่โฟลเดอร์นั้น

## ทางเลือกเว็บแอปเต็มรูป (ภายหลัง)
`graph/spa/` (เว็บ HTML + MSAL อ่าน Excel ในไซต์เดียวกันผ่าน Microsoft Graph) ใช้ได้เมื่อ IT อนุมัติ consent ให้ app registration
— ชุด `sharepoint-app/` นี้คือเส้นทางที่ **เริ่มใช้ได้ทันที** โดยไม่ต้องรอ IT
