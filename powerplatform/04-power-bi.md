# 04 · Power BI (แดชบอร์ด — เทียบกราฟที่ทำอยู่)

## เชื่อมข้อมูล
- **Get data → Dataverse** → เลือกตาราง: Duty, Assignment, Employee, Team, Flight, PorterJob, PreWheelchair, ManpowerReport
- โหมด **Import** (รีเฟรชตามเวลา) หรือ **DirectQuery** (สด) ตามปริมาณข้อมูล

## Power Query — เพิ่มคอลัมน์ช่วยคำนวณ
**Assignment** (เพิ่ม `WinLo` / `WinHi` นาที — ตรรกะเดียวกับ winOf):
```m
// WinLo
= if [pas_counter_open] <> null and [pas_counter_close] <> null then [pas_counter_open]
  else if [pas_std] <> null then List.Max({0,[pas_std]-60})
  else if [pas_sta] <> null then [pas_sta]
  else if [pas_counter_open] <> null then [pas_counter_open] else null
// WinHi
= if [pas_counter_open] <> null and [pas_counter_close] <> null then (if [pas_counter_close]<[pas_counter_open] then [pas_counter_close]+1440 else [pas_counter_close])
  else if [pas_std] <> null then [pas_std]
  else if [pas_sta] <> null then [pas_sta]+45
  else if [pas_counter_open] <> null then [pas_counter_open]+45 else null
```
**Duty** (เพิ่ม `DutyMin`):
```m
= if [pas_shift_start] <> null and [pas_shift_end] <> null
  then (if [pas_shift_end] <= [pas_shift_start] then [pas_shift_end]+1440 else [pas_shift_end]) - [pas_shift_start]
  else 0
```

## ความสัมพันธ์
Duty[pas_duty] 1─* Assignment[pas_duty] · Employee 1─* Duty · Team 1─* Duty · Team 1─* ManpowerReport
+ ตาราง **Hour** (ไม่ผูกความสัมพันธ์): `Hour = GENERATESERIES(0,23,1)` เปลี่ยนชื่อคอลัมน์เป็น `H`

## DAX Measures
```dax
Working    = CALCULATE(COUNTROWS(Duty), Duty[pas_bucket] IN {"WORKING","OT_OFF"}, Duty[pas_is_training]=FALSE, Duty[pas_is_support]=FALSE)
OT Hours   = SUM(Duty[pas_ot_hours])
BKK        = CALCULATE(COUNTROWS(Duty), Duty[pas_is_bkk]=TRUE)
Flights    = DISTINCTCOUNT(Flight[Name])
Porter Cases = COUNTROWS(PorterJob)

BusyMin (approx) = SUMX(Assignment, Assignment[WinHi] - Assignment[WinLo])   -- ต่อ context; ไม่หักซ้อน
Avg Util % = 
  VAR t = ADDCOLUMNS(FILTER(Duty, Duty[DutyMin]>0),
            "u", DIVIDE(CALCULATE(SUMX(Assignment, Assignment[WinHi]-Assignment[WinLo])), Duty[DutyMin]) * 100)
  RETURN AVERAGEX(t, [u])
Idle Hours = SUMX(FILTER(Duty, Duty[DutyMin]>0),
                  MAX(Duty[DutyMin] - CALCULATE(SUMX(Assignment, Assignment[WinHi]-Assignment[WinLo])), 0)) / 60
```

### แยกกลุ่ม HKT / BKK / Globex
**calculated column บน Duty** (แล้วใช้เป็นแกน/legend คู่กับ measure `Working`):
```dax
Grp =
  SWITCH(TRUE(),
    Duty[pas_is_bkk] = TRUE, "BKK",
    RELATED(Employee[pas_source]) = "GLOBEX", "GLOBEX",
    "HKT")
```
> visualize: แท่ง/ตาราง แกน = `Duty[Grp]`, ค่า = `[Working]`

### รายชั่วโมง: อยู่เวร vs ติดงาน (ใช้ตาราง Hour)
```dax
On Duty @Hour =
  VAR a = SELECTEDVALUE('Hour'[H]) * 60  VAR b = a + 60
  RETURN CALCULATE(COUNTROWS(Duty),
           FILTER(Duty, Duty[DutyMin]>0 && Duty[pas_shift_end] > a && Duty[pas_shift_start] < b))

On Flight @Hour =
  VAR a = SELECTEDVALUE('Hour'[H]) * 60  VAR b = a + 60
  RETURN CALCULATE(DISTINCTCOUNT(Assignment[pas_duty]),
           FILTER(Assignment, Assignment[WinHi] > a && Assignment[WinLo] < b))
```
> วางเป็น **Line/Column combo**: แกน X = `Hour[H]`, คอลัมน์ = On Duty @Hour, เส้น = On Flight @Hour
> (ข้อจำกัด: overlap แบบง่าย ไม่หักช่วงซ้อนของกะข้ามเที่ยงคืนเป๊ะ — พอสำหรับภาพรวม เท่ากราฟเว็บ)

## หน้ารายงาน (เทียบแท็บเว็บ)
1. **ภาพรวม** — card: Working / Flights / OT / BKK / Porter · แท่งแยกกลุ่ม HKT/BKK/Globex · ตารางรายทีม
2. **Productivity** — Avg Util%, Idle Hours · combo รายชั่วโมง (อยู่เวร vs ติดงาน) · ตารางรายคน (Util bar ด้วย conditional formatting)
3. **ไฟลท์** — ตาราง Flight + filter วันที่/ทิศ
4. **Porter / Pre-WC** — เคสรายวัน + สรุปตามสายการบิน/ชนิด (Pre-WC ดูอนาคตได้ด้วย slicer วันที่)

## รีเฟรช + แชร์
- ตั้ง **Scheduled refresh** (Import) หลัง flow นำเข้าเสร็จ · หรือ DirectQuery ถ้าต้องการสด
- แชร์ผ่าน **Workspace + App** ให้ group ของ Entra (ผู้ดูต้องมี Power BI Pro หรือ capacity)
