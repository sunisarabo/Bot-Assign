# PAS บน Microsoft Power Platform (Dataverse) — Build Kit

ทางเลือก "อยู่ค่าย Microsoft ค่ายเดียว" — เร็วสุด พนักงานใช้บัญชี Microsoft ที่มีอยู่
ทำหน้าที่แทนระบบ Apps Script เดิมทั้งชุด (ข้อมูล + ตรรกะ + หน้าจอ + แดชบอร์ด + login)

| ชั้น | ของเดิม (Google) | ค่าย Microsoft |
|---|---|---|
| ข้อมูล | Google Sheets | **Dataverse** (ตาราง relational) |
| ตรรกะ + หน้าจอ | Apps Script + HTML | **Power Apps (Canvas)** + Power Fx |
| งานอัตโนมัติ/นำเข้า | trigger GAS | **Power Automate** (flow) |
| แดชบอร์ด/กราฟ | HTML/SVG | **Power BI** |
| Login | บัญชี Google | **Entra ID** (ในตัว — ไม่ต้องตั้งค่าเพิ่ม) |

> ⚠️ **ผมสร้างใน tenant ของคุณให้ไม่ได้** (ต้องคลิกใน make.powerapps.com / Power BI Desktop)
> เอกสารชุดนี้คือ **พิมพ์เขียวครบ** — schema, สูตร Power Fx, flow, DAX — เอาไปสร้างตามได้เร็ว

## ลำดับการสร้าง
1. **`01-dataverse-schema.md`** — สร้างตาราง + คอลัมน์ + choice + ความสัมพันธ์
   → มี **สคริปต์อัตโนมัติ** `create-tables.js` + `tables.def.json` (สร้างครบจากไฟล์เดียว · idempotent)
2. **`02-powerfx.md`** — สร้าง Canvas App + สูตรหน้าจอ (Timetable / Productivity / Gantt / Porter / Pre-WC)
3. **`03-power-automate.md`** — flow นำเข้าข้อมูลรายวัน + แจ้งเตือน
4. **`04-power-bi.md`** — โมเดล + DAX + หน้ารายงาน (เทียบกราฟที่ทำอยู่)
5. **`05-import-source.md`** — ไฟล์ต้นทางจริง (Drive `1Uk-…` = ROOT_FOLDER_ID) + mapping ไฟล์→JSON→Dataverse + route นำเข้า
6. **`templates/`** — CSV หัวคอลัมน์ตายตัว (route ถาวรบน SharePoint) 1 ไฟล์/ตาราง + README แมป→Dataverse
7. **`office-script-util.ts`** — Office Script คำนวณ Util (merge ช่วงซ้อนเป๊ะ) เรียกจาก Power Automate
8. **`06-canvas-build.md`** — สร้าง Canvas App จากเทมเพลต HeaderMainFooter (คลิก-ต่อ-คลิก + วางสูตรจากข้อ 02)

> ✅ ทดสอบด้วยข้อมูลจริง: อ่าน MANPOWER ของ 19SEP จาก Drive → import เข้า DB ได้ตัวเลขตรงชีต
> (SQ 29 คน · QR OT 85 · WYWK OT 72.5 · PORTER 51) · Office Script util ให้ผลตรงกับ backend module

## ไลเซนส์ (ต้องรู้ก่อน)
- Dataverse + Power Apps ใช้ตาราง Dataverse = **premium** → ต้อง **Power Apps per-user** (หรือ per-app) ต่อผู้ใช้ที่เปิดแอป
- Power Automate: flow ที่แตะ Dataverse ครอบด้วยไลเซนส์ Power Apps ที่มากับแอปได้ (ตรวจ use rights กับ IT)
- Power BI: ดูรายงานในเวิร์กสเปซที่แชร์ต้อง **Power BI Pro** (หรือ Premium/Fabric capacity) ต่อผู้ดู
- ปรึกษาผู้ดูแล M365/ตัวแทน Microsoft เรื่องจำนวน license ตามจำนวนพนักงานที่จะเปิดใช้

## Entra (login)
ไม่ต้องตั้ง OIDC เอง — Power Apps/Power BI ใช้ Entra ของ tenant อัตโนมัติ
คุมสิทธิ์ด้วย **security role ของ Dataverse** + แชร์แอป/รายงานตาม group ของ Entra

## เทียบกับของที่ทำไว้ (Postgres/Node)
- schema Dataverse ที่นี่ = แปลงตรงจาก `db/schema.sql` → ตรรกะ/ตัวเลขได้ผลเดียวกัน
- ถ้าวันหน้าอยากเลิกผูก Microsoft: export Dataverse → กลับเข้า Postgres ได้ (โครงตารางตรงกัน)
