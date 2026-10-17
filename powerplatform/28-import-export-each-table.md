# 28 · Import / Export ข้อมูล "รายตาราง" ทุกตัว

คู่มืออ้างอิง: แต่ละตาราง Dataverse **import จากไหน · ด้วยวิธีไหน · export/สำรองยังไง · คีย์ upsert อะไร**
(doc `23` = flow อัตโนมัติรายเดือนเฉพาะ duty/flight/leave · doc นี้ = ครบทุกตาราง รวม seed ครั้งแรก + backup)

## 3 วิธีมาตรฐาน (อ้างถึงในตารางล่าง)
| วิธี | ใช้ตอน | ทำที่ |
|---|---|---|
| **IMP-X** = Import from Excel/CSV | seed ครั้งแรก · แก้ชุดใหญ่ | ตาราง → **Import → Import data from Excel** → map คอลัมน์ → (เลือก **key** ให้ upsert) |
| **IMP-DF** = Dataflow (Power Query) | นำเข้าซ้ำ ๆ + upsert ด้วย alternate key | make.powerapps.com → **Dataflows** (ดู `23` B) |
| **EXP-L** = List rows → Create CSV | export/snapshot รายตาราง | Power Automate (ดู `23` A) หรือ **Export to Excel** จากหน้าตาราง |

> **สำรองทั้ง environment** (ทุกตารางพร้อมกัน): admin.powerplatform.microsoft.com → Environments → **Backups** (manual + auto) · หรือ **Export solution** (schema) · ทั้งคู่ไม่ต้องทำรายตาราง
> ทุก lookup ให้ import ด้วย **Alternate Key** ของตารางปลายทาง (ไม่ใช่ GUID) → CSV เก็บรหัสธุรกิจพอ

---

## ตารางหลัก (จาก `tables.def.json` · prefix `pas`)

| ตาราง | Primary / **alt key** (upsert) | แหล่งข้อมูล → ไฟล์ | Import | Export | หมายเหตุ lookup/choice |
|---|---|---|---|---|---|
| **PAS Team** `pas_team` | `pas_name` (Team Code) | ตั้งครั้งเดียว (มือ/CSV ทีม) | IMP-X | EXP-L | master คงที่ · ไม่ต้อง sync |
| **PAS Employee** `pas_employee` | `pas_name` (Emp Code) | `Master_Data_HKT` → `pas_employee.csv` | IMP-X (seed) · IMP-DF (อัปเดตรายเดือน) | EXP-L | choice `pas_source`/`pas_status` map จากข้อความ |
| **PAS Duty** `pas_duty` | `pas_name` = `EmpCode_YYYY-MM-DD` | generator `build_roster.py --dataverse` · ของจริง `import_daily_roster.py` | IMP-DF (upsert รายเดือน, `23` B) | EXP-L รายเดือน | lookup `Employee`→Emp Code · `Team`→Team Code · bucket=choice |
| **PAS Assignment** `pas_assignment` | `pas_name` (Flight Code) | แอปสร้างเอง (scrAssign) | ปกติไม่ import (แอปเขียน) · seed = IMP-X | EXP-L (สำรอง) | task "/"-joined · is_flight/is_activity |
| **PAS Flight** `pas_flight` | `pas_name` = `pas_flightkey` | `build_int_roster.py --dataverse` → `pas_flight_int.csv` · แอปแก้ (scrFlights) | IMP-DF (`23` B) | EXP-L | direction=choice · status ADDED/CHANGED/CANCELLED |
| **PAS Porter Job** `pas_porter_job` | `pas_name` (Flight No) | `OCT PORTER SUMMARY` → `extract_wc_data.py` | IMP-X · IMP-DF | EXP-L | service=choice · porter_names = text |
| **PAS Porter Staff Day** `pas_porter_staff` | `pas_name` = `Name_date` | PORTER SUMMARY → **`gen_porter_staff.py`** | IMP-X · IMP-DF | EXP-L | cases = number |
| **PAS Pre-Wheelchair** `pas_prewc` | `pas_name` (Flight No) | `OCT PRE-WHEELCHAIR` → `office-script-prewc.ts` | IMP-X · IMP-DF | EXP-L | service/direction=choice |
| **PAS Manpower Report** `pas_manpower` | `pas_name` = `date` (หรือ `team_date` ด้วย `--by-team`) | duty CSV → **`gen_manpower.py`** | IMP-X · IMP-DF | EXP-L (ป้อน Power BI) | ตัวเลขรวมต่อวัน |

---

## ตารางที่แอปเพิ่มภายหลัง (ไม่อยู่ใน tables.def.json)

| ตาราง | Primary / **alt key** | แหล่งข้อมูล | Import | Export |
|---|---|---|---|---|
| **PAS Shift Template** `pas_shift_template` | `Team\|Code` | `extract_staffing.py` → `shift_templates.csv` | IMP-X (รีเจนเมื่อ IP template เปลี่ยน) ดู `25` | EXP-L |
| **PAS SwapLog** `pas_swaplog` | `Title` = `ka\|ca <> kb\|cb` | แอปเขียน (scrRoster แลกเวร) | ไม่ import | EXP-L (audit) |
| **PAS LeaveLog** `pas_leavelog` | `Title` = `day\|emp\|code` | แอปเขียน (scrRoster ลา) · นำเข้าโควตาเดิม = IMP-X | IMP-X (seed โควตา) | EXP-L → `leave_YYYY-MM.csv` (`23` A) |
| **PAS TeamPosition** `pas_teamposition` | `Team\|Position` | `manning_positions.csv` | IMP-X | EXP-L |
| **PAS TeamAirline** `pas_teamairline` | `Team\|IATA` | **`gen_teamairline.py`** (ทีม↔สายการบิน) | IMP-X | EXP-L |
| **PAS FlightExtraPos** `pas_flightextrapos` | `day\|flight\|position` | แอปเขียน (scrAssign เพิ่มตำแหน่ง) | ไม่ import | EXP-L |

## ตาราง WC/Porter (ดู `wc-01-schema-import.md`)

| ตาราง | alt key | แหล่ง | Import | Export |
|---|---|---|---|---|
| `pas_wheelchairs` | ControlNo | ทะเบียนรถเข็น | IMP-X | EXP-L |
| `pas_wc_staffs` | StaffId | รายชื่อพอตเตอร์ (+ `pas_pin`) | IMP-X | EXP-L |
| `pas_wc_cases` | CaseId/`day\|flight\|svc` | PRE-WHEELCHAIR / แอป | IMP-X (seed) · IMP-DF | EXP-L |
| `pas_wc_trips` `pas_wc_queues` `pas_wc_caseporters` | ดู `wc-01` | แอป/flow เขียน | ไม่ import | EXP-L (audit) |

---

## ขั้นตอน IMP-X (seed ครั้งแรก) โดยสังเขป
1. ตาราง → **Import → Import data from Excel** → อัปโหลด CSV (UTF-8; ไฟล์ generator เป็น `utf-8-sig` อ่านได้)
2. **Map columns** → ชื่อไฟล์ → ฟิลด์ (ตามคอลัมน์ `display` ในตารางบน)
3. **lookup**: เลือกให้ map กับ **Alternate Key** ของตารางปลายทาง (เช่น Employee = Emp Code) — ต้องสร้าง alt key ไว้ก่อน (Keys → + New key)
4. **choice**: ค่าต้องตรง label ของ option set (เช่น `pas_bucket` = WORKING/OFF/… ) ไม่งั้นแถวนั้น error
5. กด **Import** → ดู log แถว success/fail

## ข้อควรระวัง
- **upsert ทับแก้มือ**: ถ้า import duty/flight ทับวันที่แอปแก้ไว้ (แลกเวร/ลา/CHANGED) จะทับ → กรองออกก่อน load (ดู `23` B "ให้แก้มือไม่ถูกทับ")
- **ลำดับ seed**: import **master ก่อน** (Team → Employee → Shift Template → TeamPosition/Airline) แล้วค่อย transactional (Duty → Flight → Assignment → Porter/WC) เพราะ lookup ต้องมีปลายทางก่อน
- **export routine**: ตั้ง flow EXP-L รายเดือนต่อ `pas_duty`/`pas_leavelog`/`pas_manpower` ไว้ป้อน generator + Power BI + เก็บเป็น snapshot
- **สำรองกันพลาด**: เปิด **auto-backup** ของ environment (admin center) เพิ่มจาก export รายตาราง — ตารางเดียวพังกู้ได้จาก backup ทั้งชุด
