# tools/

## build_int_roster.py
จากตารางบิน turnaround master → Assignment/Roster/Sizing + ชุดกะ ตามทีม

```bash
python3 tools/build_int_roster.py  HKT_Winter2627_Turnaround_Master.xlsx \
    -o HKT_Winter2627_INT_RosterAssignment.xlsx \
    --month 2026-11 \
    --dataverse ./dataverse
```

| อาร์กิวเมนต์ | ความหมาย |
|---|---|
| `input` | ไฟล์ turnaround master (ต้องมีชีต `Flight_Schedule`) |
| `-o` | ไฟล์ผลลัพธ์หลัก (ทั้งฤดู) |
| `--sector` | `INT` (ค่าเริ่มต้น) / `DOM` / เว้น = ทุกไฟลท์ |
| `--month YYYY-MM` | เพิ่มเวิร์กบุ๊กกะเฉพาะเดือน (`..._YYYY-MM.xlsx`) |
| `--dataverse DIR` | ออก CSV สำหรับ import: `pas_flight_<sector>.csv` + `team_airline_map.csv` |

### ผลลัพธ์ (ไฟล์หลัก)
- `INT_Assignment` — 1 แถว/ไฟลท์ จัดตามทีม
- `INT_Roster_Daily` — วัน×ทีม: turnaround/one-way/flights/movements/peak on-ground
- `INT_Sizing_Daily` — วัน×ทีม: Manning_Total + หัวคน/กะ (M/A/N) + Peak_Concurrent
- `INT_Team_Sizing_Summary` — สรุปต่อทีมทั้งฤดู
- `Team_Airlines` — mapping สาย→ทีมที่ใช้

### ผลลัพธ์ (เวิร์กบุ๊กเดือน `--month`)
- `Shift_Chips` — นิยามกะ (เช้า/บ่าย/ดึก)
- `ShiftReq_Daily` — หัวคน/กะ/ทีม รายวันของเดือน
- `Shift_Pattern_Weekly` — **ชุดชิพกะ**: ต่อทีม × วันในสัปดาห์ → หัวคน M/A/N (= max ของเดือน เพื่อคุมให้ครบ)

### ค่าที่ปรับได้ (ในไฟล์ `.py`)
- `TEAMS` — สาย→ทีม (อิง `ADV_TEAMS` ในระบบ + การจัดทีมที่ยืนยัน)
- `MANNING` — คน/ไฟลท์ `[SUP,CI,ARR,GATE,TOTAL]` (บางสายเป็น**ประมาณการ** ดูคอมเมนต์)
- `BANDS` — ช่วงกะ (เช้า 05–14 · บ่าย 13–22 · ดึก 21–06, ซ้อน 1 ชม.)

### วิธีคิดหัวคน/กะ (sizing)
หัวคนต่อกะ = **peak concurrent** ของคนที่ติดงานพร้อมกันในช่วงกะนั้น โดยแยก **หน้าต่างงานจริงต่อเฟส**
(CI เช็คอิน STD-180..STD-45 · GATE บอร์ด STD-60..STD+15 · ARR ขาเข้า STA-10..STA+45)

**manning มาจากสูตรจริงของทีม** (`tools/manning_positions.csv` = Team·Position·Count·%flights·Phase
สกัดจากไฟล์ "แผนที่เคยจัด") → คน/ไฟลท์/เฟส = Σ(Count × %flights) แยกตาม Phase
ทีมที่ข้อมูลสูตรน้อย (< `TEAM_POS_MIN`) fallback เป็น `MANNING` (SLA_RQ) · แก้สูตรที่ CSV ได้เลย
ปรับหน้าต่างได้ที่ `CI_OPEN/CI_CLOSE/GATE_*/ARR_*`

---

## build_roster.py
จับ "คนจริงในทีม" (จากทะเบียน) ลงกะตามความต้องการรายวัน → ตารางเวรรายเดือน

```bash
python3 tools/build_roster.py \
    --req  HKT_Winter2627_INT_RosterAssignment_2026-11.xlsx \
    --reg  OT_Passenger_Service.xlsx \
    -o     HKT_Nov2026_Roster_INT.xlsx \
    --dataverse ./dataverse
```
| อาร์กิวเมนต์ | ความหมาย |
|---|---|
| `--req` | เวิร์กบุ๊กเดือน (มีชีต `ShiftReq_Daily`) จาก build_int_roster.py |
| `--reg` | ไฟล์ทะเบียนพนักงาน (ชีต `ทะเบียน`) |
| `--dataverse` | ออก `pas_duty_roster.csv` (long format) สำหรับ import |

ผลลัพธ์: 1 ชีต/ทีม (คน×วัน = M/A/N/OFF ระบายสี) · `Coverage` (target/ยืดกะ/เรียกวันหยุด/ยังขาด) · `Teams_NoStaff`
- **กลบวันขาดตาม "บันได OT":** คนไม่พอ → (1) **ยืดกะ** คนที่อยู่ (OT ก่อน/หลัง, mark `+`)
  → (2) **เรียกคนวันหยุด** (OT_OFF, mark `°`) → (3) ที่เหลือ = `ยังขาด`
- เคารพ **วันเริ่ม/พ้นสภาพ** (คนยังไม่เข้า/ลาออก = `-` ไม่ถูกจัด)
- จับกะ: OFF พัก ~1/7 (คนทำงานสะสมเยอะ off ก่อน) · กะดึกเฉลี่ยคนได้ N น้อยสุดก่อน
- ปรับทีม→พนักงานที่ `REG2TEAM` · เวล่ากะ `SHIFT_TIME` · OT ที่ `EXTEND_OT_H`/`CALLED_OT_H`
- ทีมที่ไม่มีคนในทะเบียน (ZF/DOM) อยู่ในชีต `Teams_NoStaff` (ต้องใช้ support/charter)

> การนำ CSV เข้าระบบจริง (Dataverse/Power Apps) ดู `powerplatform/13-load-into-system.md`
