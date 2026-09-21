# 01 · Dataverse Schema (แปลงจาก db/schema.sql)

สร้างใน **solution เดียว** (Publisher prefix เช่น `pas`) เพื่อย้าย/สำรองง่าย
Dataverse ไม่มีชนิด TIME ล้วน → **เก็บเวลาเป็น "นาทีตั้งแต่เที่ยงคืน" (Whole Number)** เหมือนที่ระบบเดิมใช้
(shift_start=360 = 06:00) ทำให้คำนวณ Util/Gantt ใน Power Fx/DAX ง่ายและตรงกับ Node module

## Choice sets (Global option sets)
| ชื่อ | ค่า |
|---|---|
| `pas_bucket` | WORKING · OT_OFF · OFF · SICK · VACATION · LEAVE · TRAINING |
| `pas_source` | HKT · BKK · GLOBEX · OUTSOURCE |
| `pas_direction` | ARR · DEP · TURN |
| `pas_service` | WCHR · WCHS · WCHC · MAAS · AVIH · ETC |

## ตาราง

### Team (`pas_team`)
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| Name (primary) | Text | รหัสทีม เช่น EY, PORTER, ADMIN DOC |
| pas_label_th | Text | ชื่อไทย |
| pas_is_float | Yes/No | ทีมพูล/สแตนด์บาย |
| pas_is_doc | Yes/No | ทีมเอกสาร (ไม่ผูกเวลาไฟลท์) |
| pas_skip_sla | Yes/No | ไม่คิด SLA |

### Employee (`pas_employee`)
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| Name (primary) | Text | ใช้ emp_code (ตัวเลขล้วน) เป็นชื่อหลัก |
| pas_name_th / pas_name_en | Text | |
| pas_team | Lookup → Team | home team |
| pas_position | Text | ตำแหน่งดิบ |
| pas_pos_group | Text | กลุ่มตำแหน่ง |
| pas_source | Choice `pas_source` | HKT/BKK/GLOBEX (การ์ดแยกกลุ่ม) |
| pas_status | Choice (ACTIVE/RESIGNED) | |
| pas_start_date / pas_resign_date | Date Only | |

### Duty (`pas_duty`) — 1 คน/วัน (แกนหลัก)
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| Name (primary) | Text (autonumber ก็ได้) | |
| pas_work_date | Date Only | |
| pas_employee | Lookup → Employee | |
| pas_emp_name | Text | ชื่อ ณ วันนั้น |
| pas_team | Lookup → Team | ทีมที่ลงเวรวันนั้น |
| pas_bucket | Choice `pas_bucket` | |
| pas_shift_code | Text | |
| pas_shift_start / pas_shift_end | Whole Number | **นาที** |
| pas_shift_hours | Decimal | |
| pas_ot_hours | Decimal | |
| pas_is_support | Yes/No | มาช่วยทีมอื่น |
| pas_is_bkk | Yes/No | |
| pas_is_training | Yes/No | |
| pas_source_file | Text | เช่น 19SEP |

> Key ป้องกันซ้ำ: ตั้ง **Alternate Key** = (pas_work_date, pas_employee, pas_team) → upsert รายวันได้
> (Dataverse **ไม่รับ Yes/No เป็นคอลัมน์ของ alternate key** จึงไม่ใส่ pas_is_support · แถว home กับ support
> ต่างทีมกันอยู่แล้ว → ไม่ชน · เคสหายากที่คนเดียวเป็นทั้ง home+support ในทีมเดียวกันวันเดียว ค่อยเพิ่มคอลัมน์ discriminator แบบ Choice/Text)

### Assignment (`pas_assignment`) — 1 งาน/ไฟลท์ ต่อ duty
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| Name (primary) | Text | flight_code ดิบ |
| pas_duty | Lookup → Duty | (parental, cascade delete) |
| pas_flight_leg | Text | ขาแรก |
| pas_airline_iata | Text | |
| pas_task | Text | รหัสงาน (CI, GA, …) |
| pas_sta / pas_std | Whole Number | **นาที** |
| pas_counter_open / pas_counter_close | Whole Number | **นาที** |
| pas_is_flight | Yes/No | |
| pas_is_activity | Yes/No | อบรม/ประชุม |

### Flight (`pas_flight`)
| คอลัมน์ | ชนิด |
|---|---|
| Name (primary) = flight_no · pas_flight_date (Date) · pas_airline_iata (Text) · pas_direction (Choice) · pas_sta/pas_std (Whole Number นาที) · pas_aircraft_type (Text) · pas_gate (Text) |

### PorterJob (`pas_porter_job`)
Name=flight_no · pas_work_date (Date) · pas_airline_iata · pas_porter_names (Text) · pas_service (Choice) · pas_is_arrival/pas_is_departure (Yes/No) · pas_pickup_at/pas_delivered_at (Whole Number นาที)

### PorterStaffDay (`pas_porter_staff`)
pas_work_date (Date) · Name = ชื่อพนักงาน · pas_cases (Whole Number)

### PreWheelchair (`pas_prewc`)
pas_work_date (Date) · Name=flight_no · pas_airline_iata · pas_routing (Text) · pas_direction (Choice) · pas_service (Choice) · pas_qty (Whole Number) · pas_sta/pas_std (Whole Number นาที)

### ManpowerReport (`pas_manpower`)
pas_work_date (Date) · pas_team (Lookup → Team) · pas_working_actual (Whole Number) · pas_ot_hours (Decimal) · pas_scheduled/pas_sick/pas_annual/pas_training (Whole Number) · Alternate Key = (pas_work_date, pas_team)

## ความสัมพันธ์
```
Team 1─* Employee      (pas_team)
Team 1─* Duty          (pas_team)
Employee 1─* Duty      (pas_employee)
Duty 1─* Assignment    (pas_duty, parental → ลบ duty แล้ว assignment หายตาม)
Team 1─* ManpowerReport(pas_team)
```

## วิธีสร้างเร็ว — สคริปต์อัตโนมัติ (แนะนำ)
สร้างทุกตาราง/คอลัมน์/choice/ความสัมพันธ์/alternate key จากไฟล์เดียว `tables.def.json`
ผ่าน **Dataverse Web API** — idempotent (มีอยู่แล้วข้าม) · รันซ้ำได้

**เตรียมสิทธิ์ (ครั้งเดียว):**
1. Entra → App registration ใหม่ → สร้าง client secret
2. Power Platform admin → Environment → **S2S / Application user** → เพิ่ม app นั้น → ให้ security role **System Customizer** (หรือ System Administrator)

**รัน:**
```bash
node powerplatform/create-tables.js --dry-run     # ดูแผน 88 ขั้น (ไม่ยิงเน็ต)

export DATAVERSE_URL="https://<org>.crm.dynamics.com"
export TENANT_ID="<tenant>"  CLIENT_ID="<app>"  CLIENT_SECRET="<secret>"
export SOLUTION="<solution unique name>"          # ทางเลือก: ให้ table ไปอยู่ solution นี้
node powerplatform/create-tables.js               # สร้างจริง
```

**เก็บเป็น solution (version control) ด้วย `pac`:**
```bash
pac auth create --url $DATAVERSE_URL
pac solution export --name <solution> --path pas_solution.zip     # export เก็บ/ย้าย env ได้
```
> วิธีมือ (ทางเลือก): make.powerapps.com → Solutions → New → Table
> ใส่ข้อมูลนำเข้าครั้งแรก: **Dataflow / Import from Excel** หรือ flow ใน `03-power-automate.md`
