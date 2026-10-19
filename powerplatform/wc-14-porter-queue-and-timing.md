# WC/Porter · 14 · คิวพอตเตอร์รับเคส + นับเวลาถึงเวลาให้บริการ

2 ฟีเจอร์บน `scrLP` (ใช้ `PAS_Porter` lp_* ตาม `wc-11`):
1. **คิวรับเคส** — จัดลำดับพอตเตอร์ที่ควรได้งานถัดไป (เป็นธรรม: เคสน้อยสุด/ว่างก่อน)
2. **เวลาถึงเวลาให้บริการ** — ต่อเคส/ต่อคน เช่น *"ยุทธชัย · สาย SA · อีก 25 นาที"*

> คอลัมน์ที่ใช้: `flight_no` `airline_iata` `service` `is_arrival`/`is_departure` `eta` `etd` `notified_at` `lp_porter` `lp_porter_code` `lp_state`

---

## 0) ตัวช่วยแปลงเวลา + เวลาปัจจุบัน (วางที่ OnVisible / ใช้ซ้ำ)
```powerapps
// นาทีจากข้อความ "hh:mm" (ว่าง = blank)
// hhmmToMin(t) = If(IsBlank(t), Blank(), Value(Left(t,2))*60 + Value(Mid(t,4,2)))
Set(varNowMin, Hour(Now())*60 + Minute(Now()))
```

## 1) เวลาที่ "ต้องเริ่มให้บริการ" ของแต่ละเคส
ขาเข้า (วีลแชร์ไปรับผู้โดยสาร) ≈ เวลาถึง `eta` · ขาออก (พาไปขึ้นเครื่อง) ≈ ก่อนบินตามเวลาบอร์ดดิ้ง (ปรับ lead ได้)
```powerapps
// dueMin ของ 1 เคส (ThisItem) — ปรับ ARR_LEAD/DEP_LEAD ตามจริง
// ARR: ไปถึงเกทช่วงเครื่องลง → ใช้ eta · DEP: ก่อน etd ~ DEP_LEAD นาที (เช่น 40)
With({ due:
   If(ThisItem.is_arrival,
      hhmmToMin(ThisItem.eta),                       // + ARR_LEAD ถ้าต้องถึงก่อน
      hhmmToMin(ThisItem.etd) - 40) },               // DEP_LEAD = 40 (เวลาบอร์ดดิ้งโดยประมาณ)
   // เหลืออีกกี่นาที (บวก=ยังไม่ถึง, ลบ=เลยเวลา) · กันข้ามเที่ยงคืน
   With({ diff: Mod(due - varNowMin + 720, 1440) - 720 }, diff))
```
> `hhmmToMin` = named formula (ข้อ 0) · ถ้าไม่ทำ named formula ให้แทนสูตรเต็มตรง ๆ

## 2) ป้ายนับเวลา (ต่อแถวเคส — ฝั่ง LP และฝั่งพอตเตอร์)
```powerapps
// lblDue.Text
With({ m: /* diff จากข้อ 1 */ },
  If(IsBlank(m), "ไม่มีเวลา",
     m > 0, "อีก " & m & " นาที",
     m = 0, "ถึงเวลาแล้ว",
     "เลยเวลา " & -m & " นาที"))
// สี: ใกล้/เลยเวลา = แดง, ภายใน 15 นาที = ส้ม, อื่น ๆ = ปกติ
lblDue.Color = With({ m: /* diff */ }, If(m <= 0, T.bad, m <= 15, T.warn, T.ink2))
```
บรรทัดสรุปแบบที่ขอ (ต่อคน):
```powerapps
// เช่น "ยุทธชัย · สาย SA 123 · อีก 25 นาที"
ThisItem.lp_porter & " · สาย " & ThisItem.airline_iata & " " & ThisItem.flight_no &
  " · " & If(m > 0, "อีก " & m & " นาที", m = 0, "ถึงเวลาแล้ว", "เลย " & -m & " นาที")
```

## 3) แกลเลอรี "งานที่ต้องให้บริการ" เรียงตามใกล้ถึงเวลา
```powerapps
// โหลดงานที่กำลังดำเนินของวันนี้ + คำนวณ dueMin
ClearCollect(colDue,
  AddColumns(
    Filter(PAS_Porter, day_key = varWDate,
      If(!IsBlank(lp_state), lp_state, Len(delivered_at)>=4, "DONE", Len(pickup_at)>=4, "ON_PROCESS", "NEW")
        in ["ASSIGNED","ACK","ON_PROCESS"]),
    "dueMin",
      With({ due: If(is_arrival, hhmmToMin(eta), hhmmToMin(etd) - 40) },
           Mod(due - (Hour(Now())*60+Minute(Now())) + 720, 1440) - 720)));
// galDue.Items = SortByColumns(colDue, "dueMin")   // ใกล้ถึง/เลยเวลา ขึ้นก่อน
```
> อัปเดตเรียลไทม์: ใส่ **Timer** (Duration 30000, Repeat) สั่ง `Set(varNowMin, ...)` + รีคำนวณ (หรือ Select ปุ่มโหลด) ให้ตัวเลขเดินทุก 30 วิ

## 4) คิวพอตเตอร์รับเคส — **1 คนรับได้หลายเคส ถ้าเวลาไม่ชน**
หลัก: **ไม่บล็อกคนที่มีงานอยู่** · จ่ายเคสใหม่ให้ได้ถ้า **ช่วงเวลาเซอร์วิสไม่ทับ** กับเคสเดิมของคนนั้น (เผื่อเวลาต่อเคส)
> `HANDLE_MIN` = เวลาทำ 1 เคสโดยประมาณ (เช่น 25 นาที) · `GAP_MIN` = เผื่อเดินทาง/คั่นระหว่างเคส (เช่น 10 นาที)
> เคส A กับ B "ชนกัน" เมื่อ `|dueA − dueB| < HANDLE_MIN + GAP_MIN`

### 4.1 เช็กว่าพอตเตอร์ "รับเคสที่เลือกได้ไหม" (ไม่ชนเวลา)
```powerapps
// dueNew = dueMin ของเคสที่กำลังจะจ่าย (varLPCase) — คำนวณเหมือนข้อ 1
Set(varDueNew, With({ due: If(varLPCase.is_arrival, hhmmToMin(varLPCase.eta), hhmmToMin(varLPCase.etd) - 40) },
                    Mod(due - (Hour(Now())*60+Minute(Now())) + 720, 1440) - 720));
// รายชื่อพอตเตอร์ขึ้นเวรวันนี้ + คำนวณว่าชนเวลาไหม
ClearCollect(colPorterQ,
  AddColumns(
    Filter(PAS_Duty, day_key = varWDate, team = "PORTER", bucket.Value in ["WORKING","OT_OFF"]),
    "cases", CountRows(Filter(PAS_Porter, day_key = varWDate, lp_porter_code = emp_code)),
    "lastDone", Max(Filter(PAS_Porter, day_key = varWDate, lp_porter_code = emp_code), lp_done_at),
    // ชน = มีเคสของคนนี้ (ยังไม่จบ) ที่เวลาเซอร์วิสห่างจากเคสใหม่ < HANDLE_MIN+GAP_MIN
    "conflict",
      CountRows(
        Filter(
          AddColumns(
            Filter(PAS_Porter, day_key = varWDate, lp_porter_code = emp_code,
              If(!IsBlank(lp_state), lp_state, Len(delivered_at)>=4,"DONE", Len(pickup_at)>=4,"ON_PROCESS","NEW") in ["ASSIGNED","ACK","ON_PROCESS"]),
            "dd", With({ due: If(is_arrival, hhmmToMin(eta), hhmmToMin(etd) - 40) },
                       Mod(due - (Hour(Now())*60+Minute(Now())) + 720, 1440) - 720)),
          Abs(dd - varDueNew) < 35)) > 0   // 35 = HANDLE_MIN(25) + GAP_MIN(10)
  ));
```
### 4.2 คิว: คนที่ "รับได้" (ไม่ชน) ก่อน → เคสน้อยสุด → จบงานนานสุด
```powerapps
ClearCollect(colQueue,
  SortByColumns(colPorterQ, "conflict", Ascending, "cases", Ascending, "lastDone", Ascending));
// คนถัดไปที่ควรได้เคสนี้ = ไม่ชนเวลา + เคสน้อยสุด
Set(varNextPorter, First(Filter(colQueue, !conflict)))
```
แสดง + จ่ายงาน:
```powerapps
lblNext.Text = If(IsBlank(varNextPorter),
  "⚠ ไม่มีพอตเตอร์ว่างช่วงเวลานี้ (ทุกคนมีเคสชนเวลา)",
  "ถัดไป: " & varNextPorter.emp_name & " (เคสวันนี้ " & Coalesce(varNextPorter.cases,0) & ")")
ddLPPorter.Default = varNextPorter.emp_name
// ในดรอปดาวน์เลือกพอตเตอร์: โชว์สถานะชนเวลา เพื่อ LP ตัดสินใจ
// galLPPorter row: emp_name & " · เคส " & cases & If(conflict, " · ⚠ เวลาชน", " · ว่างช่วงนี้")
```
> LP เลือกจ่ายให้คนที่ "ชนเวลา" ก็ยังได้ (ระบบเตือนแต่ไม่ห้าม) เผื่อกรณีจำเป็น · ค่าปริยายคือคนที่ว่างช่วงนั้น

### 4.3 งานของพอตเตอร์ 1 คน (หลายเคส) เรียงตามเวลา
ในหน้าพอตเตอร์/งานของฉัน: โหลดทุกเคสของคนนั้น (ไม่จำกัด 1 เคส) แล้ว **เรียงตาม dueMin** → เห็นลำดับว่าเคสไหนต้องไปก่อน
```powerapps
// galMyWC.Items = SortByColumns(colMeWC-with-dueMin, "dueMin")  // เคสใกล้ถึงเวลาขึ้นก่อน
// ป้ายเตือนถ้ามี 2 เคสใกล้กันเกินไป: If(Abs(dueA-dueB) < 35, "⚠ สองเคสเวลาใกล้กัน")
```
// ถ้าจ่ายให้คนถัดไป → Patch PAS_Porter {lp_porter: varNextPorter.emp_name, lp_porter_code: varNextPorter.emp_code, lp_state:"ASSIGNED", ...}
```

## 5) รวมเป็นมุมมองเดียว (ที่ขอ)
ในแกลเลอรีคิว/งาน แต่ละแถวโชว์: **ชื่อพอตเตอร์ · สายการบิน+ไฟลท์ · เหลืออีกกี่นาที** เรียงตามใกล้ถึงเวลา
→ หัวหน้าเห็นภาพรวมว่า *"ยุทธชัย ต้องให้บริการสาย SA ในอีก 25 นาที"* และรู้ว่าใครคือคิวถัดไปที่ควรจ่ายเคส

## หมายเหตุ
- `ARR_LEAD`/`DEP_LEAD` ปรับตามจริง (ขาออกใช้เวลาบอร์ดดิ้ง ≈ STD − 40 นาที จากไฟล์ PRE-WHEELCHAIR)
- ถ้าเก็บ "เวลาสแตนบาย/บอร์ดดิ้ง" เป็นคอลัมน์ตรง ๆ ใน PAS_Porter ได้ ใช้ค่านั้นแทนการคำนวณจาก eta/etd จะแม่นกว่า
- ควรให้ **Timer** เดินทุก 15–30 วิ เพื่อให้ "อีกกี่นาที" และสีเตือนอัปเดตเอง
