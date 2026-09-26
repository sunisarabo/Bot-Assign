# Power Apps (SharePoint List) — เต็มฟีเจอร์ · ฟรี · ไม่ต้อง admin consent

ทำ dashboard เต็ม (Timetable / Productivity / Util / Gantt / Manpower) ใน **Power Apps Canvas**
อ่านจาก **SharePoint List** (ตัวต่อมาตรฐาน — login ตัวเอง ไม่ต้องขอ admin consent · แชร์พนักงานฟรี ไม่ต้อง Pro)

> **หลักสำคัญ:** Power Apps อ่าน "ตารางสะอาด" ได้ → เก็บข้อมูลใน **SharePoint List** (ไม่ใช่แท็บเวรที่ layout ซับซ้อน)
> Util/Gantt คำนวณใน **Power Fx** (สูตรอยู่ใน `02-powerfx.md` — ใช้ได้เลย เปลี่ยนแค่ชื่อแหล่งข้อมูล)

---

## 1) สร้าง SharePoint List (ฐานข้อมูล) — สร้างเร็วจาก PAS-Data.xlsx
ในเว็บไซต์ SharePoint → **New → List → From Excel** → อัปโหลด **PAS-Data.xlsx** → เลือกชีต → ตั้งชนิดคอลัมน์ → Create
ทำ List เหล่านี้ (คอลัมน์ = หัวใน template):
| List | คอลัมน์หลัก |
|---|---|
| **Teams** | Title(team) |
| **Employees** | Title(emp_code), name_th, team, source |
| **Duty** | work_date(Date), emp_code, emp_name, team, bucket, shift_start(นาที), shift_hours, ot_hours, is_bkk, is_training |
| **Assignment** | work_date, emp_code, team, flight, task, sta(นาที), std, counter_open, counter_close, is_flight |
| **Flights** | flight_date, flight_no, airline, direction, sta, std |
| **Porter** | work_date, airline, flight_no, service, is_arrival, pickup_at |
| **Manpower** | work_date, team, total, working, ot_hours, sick, annual, training |

> เวลาเก็บเป็น **นาที (Whole Number)** เหมือนเดิม → ให้ Power Fx คำนวณ Util/Gantt ได้

## 2) ข้อมูลเข้า List (เลือกทางที่เหมาะ)
- **ง่ายสุด (ไม่ต้อง consent):** กรอกใน **Excel Table สะอาด** บน SharePoint แล้วใช้ **Power Automate** (ตัวต่อ SharePoint มาตรฐาน — login คุณ) อ่าน Excel Table → เพิ่มแถวเข้า List อัตโนมัติ
- หรือ **Edit in grid view** ของ List แล้ววาง (paste) จาก Excel ตรง ๆ
- ⚠️ แท็บเวรเดิม (layout ซับซ้อน) แปลงอัตโนมัติไม่ได้ถ้าไม่มีโค้ด → ช่วงเปลี่ยนผ่านให้กรอกในรูปแบบตาราง (Manpower ง่ายสุด เริ่มจากตัวนี้ได้)

## 3) สร้าง Canvas App
make.powerapps.com → **Create → Blank canvas app (Tablet)** → **Data → Add data → SharePoint** → เลือกไซต์ → ติ๊ก List ทั้งหมด (Duty/Assignment/Employees/Teams/Flights/Porter/Manpower)

**App.OnStart:**
```powerapps
Set(varDate, Today()); Set(varTab, "dash")
```

## 4) หน้าจอ + สูตร (คัดจาก 02-powerfx.md — เปลี่ยนชื่อ source เป็น List)
Footer 5 ปุ่ม → `Set(varTab, "dash"/"tt"/"pu"/"gt"/"mp")` · Main คุมด้วย `Visible = (varTab="…")`

**Timetable:**
```powerapps
galDuty.Items = SortByColumns(
  Filter(Duty, work_date = varDate, bucket in ["WORKING","OT_OFF"]),
  "team", Ascending, "shift_start", Ascending)
```
**Productivity (Util ต่อคน — busy-window merge):** ต่อ 1 duty
```powerapps
ClearCollect(colIv,
  ForAll(Filter(Assignment, emp_code = ThisItem.emp_code && work_date = varDate) As a,
    With({op:a.counter_open, cl:a.counter_close, sta:a.sta, std:a.std},
      If(!IsBlank(op)&&!IsBlank(cl), {lo:op, hi:If(cl<op,cl+1440,cl)},
         !IsBlank(std), {lo:Max(0,std-60), hi:std},
         !IsBlank(sta), {lo:sta, hi:sta+45}, Blank()))));
// merge ช่วงซ้อน → busy → util = busy / (shift_hours*60)   (สูตรเต็มใน 02-powerfx.md)
```
**Gantt:** วาง rectangle ตามนาที `X = (lo - varLo)/(varHi-varLo) * W` (สี: is_flight=น้ำเงิน)
**Manpower:** `Filter(Manpower, work_date = varDate)` → gallery/ตาราง

> สูตร busy-window/Util/Gantt ฉบับเต็ม = `02-powerfx.md` (เขียนไว้แล้ว · แค่เปลี่ยน `pas_duties`→`Duty`, `pas_assignments`→`Assignment` ฯลฯ)

## 5) แชร์ให้พนักงาน (ฟรี — ไม่ต้อง Pro)
**Save → Publish → Share** → ให้ security group ของ Entra
เพราะใช้แค่ **ตัวต่อ SharePoint (มาตรฐาน)** → พนักงานที่มี M365 เปิดได้เลย ไม่ต้องมี license เพิ่ม · ฝังใน **Teams** ได้

## สรุปข้อดี/ข้อจำกัด
- ✅ เต็มฟีเจอร์ (Util/Gantt ผ่าน Power Fx) · ✅ ฟรี · ✅ ไม่ต้อง admin consent · ✅ แชร์พนักงานได้
- ⚠️ ข้อมูลต้องอยู่ใน **List (ตารางสะอาด)** → เปลี่ยนวิธีกรอกจากแท็บเวรเดิมเป็นตาราง (เริ่มจาก Manpower ก่อนได้)
- ⚠️ ประสิทธิภาพ: SharePoint List delegation จำกัดบางฟังก์ชัน (ข้อมูลรายวันหลักร้อยแถว = โอเค)
