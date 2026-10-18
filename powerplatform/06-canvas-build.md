# 06 · สร้าง Canvas App จากเทมเพลต HeaderMainFooter (คลิก-ต่อ-คลิก)

ใช้กับหน้า maker ที่เปิดอยู่: `make.powerapps.com` · environment `Default-619b9081-…` · template **HeaderMainFooter**
เทมเพลตนี้ให้ 3 ส่วน: **Header** (แถบบน) · **Main** (เนื้อหา) · **Footer** (แถบล่าง/เมนู)

> เงื่อนไข: สร้างตาราง Dataverse แล้ว (`create-tables.js` / ข้อ 01) และมีสิทธิ์ Power Apps ใน environment นี้

## 1) ตั้งชื่อ + ต่อข้อมูล
1. ตั้งชื่อแอป: **PAS – Daily Assignment**
2. ซ้ายมือ **Data → Add data → Dataverse** → เลือกตาราง:
   `pas_duties · pas_assignments · pas_employees · pas_teams · pas_flights · pas_porter_jobs · pas_porter_staffs · pas_prewcs · pas_manpowers`

## 2) ตัวแปรร่วม (App → OnStart)
```powerapps
Set(varDate, Today());
Set(varTab, "dash");
```
(รันครั้งแรก: … → App → Run OnStart)

## 3) Header (แถบบน)
- Title label: `"PAS · ระบบจัดกำลังพลรายวัน"`
- **Date picker** `dpDate`: `OnChange = Set(varDate, dpDate.SelectedDate)` · `DefaultDate = varDate`
- ผู้ใช้ (Entra ในตัว): label `= "👤 " & User().FullName`  ← ไม่ต้องตั้ง login เอง

## 4) Footer (เมนูแท็บ) — 7 ปุ่ม
วางปุ่ม 7 อัน (หรือ Gallery แนวนอน) ตั้ง `OnSelect` ให้เปลี่ยนแท็บ:
```powerapps
// ปุ่มภาพรวม
OnSelect = Set(varTab,"dash")
// อื่น ๆ: "tt" Timetable · "pu" Productivity · "gt" Gantt · "fl" ไฟลท์ · "po" Porter · "wc" Pre-WC
// ไฮไลต์ปุ่มที่เลือก:
Fill = If(varTab="dash", RGBA(29,66,138,1), RGBA(255,255,255,0))
```

## 5) Main (เนื้อหาแต่ละแท็บ)
วางทุก control ของทุกแท็บซ้อนใน Main แล้วคุมด้วย `Visible = (varTab = "…")`
สูตร/Items ของแต่ละแท็บ **คัดลอกจาก `02-powerfx.md`** ตรง ๆ:

| แท็บ (varTab) | control หลัก | Items / สูตร |
|---|---|---|
| `dash` | KPI labels + Gallery รายทีม | `02-powerfx.md → หน้าภาพรวม` (นับ working/BKK/Globex) |
| `tt`   | Gallery `galDuty` + gal ย่อยงาน | `02 → หน้า Timetable` |
| `pu`   | KPI + Gallery Util | `02 → หน้า Productivity` (อ่าน `pas_busy_min/pas_duty_min`) |
| `gt`   | Gallery + rectangles | `02 → หน้า Gantt` (X ตามนาที) |
| `fl` / `po` / `wc` | Gallery | `02 → ไฟลท์ / Porter / Pre-WC` |

ตัวอย่าง Timetable gallery ใน Main:
```powerapps
galDuty.Visible = (varTab = "tt")
galDuty.Items = SortByColumns(
  Filter(pas_duties, pas_work_date = varDate, pas_bucket.Value in ["WORKING","OT_OFF"]),
  "pas_team", Ascending, "pas_shift_start", Ascending)
```

## 6) Publish + แชร์
- **Save → Publish**
- **Share** ให้ security group ของ Entra (พนักงานเปิดด้วยบัญชี Microsoft ที่มีอยู่)
- คุมสิทธิ์แก้ข้อมูลด้วย **security role ของ Dataverse**

## 7) ข้อมูลเข้า
- ครั้งแรก: import master (พนักงาน/ทีม) + วันแรก — ดู `05-import-source.md` / `templates/`
- อัตโนมัติรายวัน: Power Automate — ดู `03-power-automate.md`
- Util (merge เป๊ะ): ให้ flow เรียก `office-script-util.ts` เขียน `pas_busy_min`

> ผมสร้างในหน้า maker แทนไม่ได้ (ต้องคลิกใน tenant) — ทำตามขั้นบนแล้ววางสูตรจากไฟล์ที่ให้ ใช้งานได้เลย
