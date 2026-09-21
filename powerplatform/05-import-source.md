# 05 · ต้นทางข้อมูลจริง → นำเข้า Dataverse

## ไฟล์ต้นทาง (ยืนยันแล้ว)
Google Drive: **`1Uk-6w7U-cqQEXFIVEl6tRhKKRCaN1ojp`** = `CONFIG_RB.ROOT_FOLDER_ID` (ระบบอ่านอยู่แล้ว)
โครง: **ปี → เดือน (`09.SEP26`) → ไฟล์รายวัน (`19SEP`)** — 1 สเปรดชีต = 1 วัน
`rbOpenTodayRoster_` ไล่หาไฟล์ของวันนั้นเอง · `rbSaveAllDay(iso)` export วันนั้นเป็น JSON จากไฟล์นี้

## โครงในแต่ละไฟล์รายวัน
- **แท็บ `MANPOWER`** (แท็บแรก) — ฟอร์มกำลังพล: `ทีม, พนักงานทั้งหมด, ทำงานตามตาราง, ลาป่วย, ลากิจ, ลาพักร้อน, ลาคลอด, ลาอื่นๆ, อบรม, ทำงานจริง, ชม.โอทีรวม, ชม.โอทีนักขัตฯ, Date/Time, Update By`
- **แท็บรายทีม** (SQ, TR, EY, EK, AK, PORTER, KE, PVTLP, CHN, JQ, QR, PG, SU, CHARTER, TK, WYWK, …) —
  **header-driven** (`RosterReader.gs` ตรวจหัวคอลัมน์เอง ตำแหน่งต่างกันได้ต่อทีม):
  `NAME · ID/NO · SHIFT · TIME · POSITION/POS · STATUS/REMARK` + คอลัมน์งาน (รหัสไฟลท์ + STA/STD/OP/CL)
  - **สถานะการมาทำงานอ่านจาก REMARK/STATUS ก่อน** (ไม่เชื่อรหัสกะ) — OFF/SICK/VAC/OT OFF/ONDUTY
  - แถวช่วยทีมอื่น: รหัสทีมต้นสังกัดในวงเล็บท้ายชื่อ "ชื่อ (WY)"

## หลักการนำเข้า (สำคัญ)
> ไฟล์พวกนี้ layout ไม่นิ่ง (header-driven, หลายทีม, ข้อความรก) → **อย่าเขียน parser ใหม่**
> ให้ **`rbSaveAllDay` (Apps Script) เป็นตัวอ่าน** เพราะใช้ตรรกะ RosterReader/AssignCheck เดิมทั้งหมด
> แล้วค่อยส่ง **JSON** ที่สะอาดแล้วเข้าปลายทาง

## Route นำเข้า
**A) ปลายทาง Dataverse (Microsoft):**
```
rbSaveAllDay(iso)  →  5 ไฟล์ JSON บน Drive
   → Power Automate: When file created (โฟลเดอร์ sync) → Parse JSON → Dataverse upsert (Alt Key)
```
(ดูขั้น flow ใน `03-power-automate.md` · Alt Key ทำให้ upsert รายวันซ้ำได้)

**B) ปลายทาง Postgres (vendor-neutral):**
```
rbSaveAllDay(iso) → JSON → db/load_all.sh <dir> <date>
```

## Mapping: ไฟล์ → JSON (rbSaveAllDay) → Dataverse
| ในไฟล์ต้นทาง | คีย์ JSON | ตาราง.คอลัมน์ Dataverse |
|---|---|---|
| แท็บทีม · NAME | `teams[].name` | `pas_duty.pas_emp_name` |
| แท็บทีม · ID/NO | `teams[].id` | `pas_duty.pas_employee` (lookup ด้วยรหัส) |
| ชื่อแท็บ (รหัสทีม) | `teams[].team` | `pas_duty.pas_team` (lookup) |
| SHIFT | `teams[].shift` | `pas_duty.pas_shift_code` |
| TIME (เวลาเข้า/กะ) | `teams[].shiftStart`,`shiftHrs` | `pas_duty.pas_shift_start`/`pas_shift_end` (นาที) |
| STATUS/REMARK | `teams[].bucket` | `pas_duty.pas_bucket` (choice) |
| ชม.โอที (แถว) | `teams[].ot` | `pas_duty.pas_ot_hours` |
| แถวช่วยทีมอื่น | `teams[].support`,`supportTeam` | `pas_duty.pas_is_support` |
| คอลัมน์งาน · รหัสไฟลท์ | `assignments[].flight` | `pas_assignment.pas_flight_leg`/`pas_name` |
| งาน (GATE/ARR/CI…) | `assignments[].task` | `pas_assignment.pas_task` |
| STA/STD | `assignments[].STA`/`STD` | `pas_assignment.pas_sta`/`pas_std` (นาที) |
| OP/CL (เคาน์เตอร์) | `assignments[].OP`/`CL` | `pas_assignment.pas_counter_open`/`pas_counter_close` |
| แท็บ MANPOWER (ทั้งแถว) | `manpower[]` | `pas_manpower.*` |

> เวลา (STA/STD/OP/CL, shift) แปลงเป็น **นาทีตั้งแต่เที่ยงคืน** ตอน import (ตรงกับ schema)

## ช่วงเปลี่ยนผ่าน → ถาวร
- **ช่วงเปลี่ยนผ่าน:** เก็บ workbook บน Google Drive ต่อได้ · `rbSaveAllDay` + flow ดันเข้า Dataverse ทุกคืน
- **ถาวร (เลิก Google):** ย้าย workbook เป็น **Excel บน SharePoint** → Power Automate อ่าน Excel ตรง ไม่ต้องผ่าน Apps Script
  (ตอนนั้น layout ควรจัดให้นิ่ง = 1 ชีต/หัวคอลัมน์ตายตัว เพื่อให้ flow แมปตรง ๆ)
