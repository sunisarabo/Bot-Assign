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
หัวคนต่อกะ = **peak concurrent** ของคนที่ติดงานพร้อมกันในช่วงกะนั้น
(ถ่วงน้ำหนักแต่ละไฟลท์ด้วย `TOTAL` จากกฎ manning ตามช่วงจอด STA→STD)
→ เป็น **ค่าประมาณเชิงวางแผน (upper-bound)** เพราะถือว่าทีมประจำไฟลท์อยู่ตลอดช่วงจอด
ปรับให้ละเอียดขึ้นได้โดยแยกหน้าต่างงาน CI (ก่อน STD) กับ ARR (หลัง STA)
