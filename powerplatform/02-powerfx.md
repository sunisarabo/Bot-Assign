# 02 · Power Apps (Canvas) + Power Fx

Canvas App ต่อ Dataverse · 1 หน้าจอ/แท็บ เหมือนเว็บที่ทำอยู่
(ภาพรวม / Timetable / Productivity / Gantt / Porter / Pre-WC)

> **แนวทางประสิทธิภาพ:** ให้ **flow นำเข้า (03) คำนวณ `pas_duty_min` / `pas_busy_min` เก็บใน Duty** ตั้งแต่ตอน import
> → แอปแค่อ่านมาแสดง (เร็ว, ตรงกับ Node module) · ด้านล่างมีสูตรฝั่งแอปไว้ทำ ad-hoc ด้วย

## ตัวแปรร่วม (App.OnStart / ปุ่มวันที่)
```powerapps
Set(varDate, Today());
// ช่วงเวลาทำงานของ 1 assignment เป็น [lo,hi] นาที (เทียบ winOf ใน productivity.js)
// เคาน์เตอร์ OP–CL / ขาออก gate→STD / ขาเข้า STA+buffer
```
ค่าคงที่: `DEP_LEAD = 60`, `ARR_TAIL = 45`, `DEF_JOB = 45`

## หน้า Timetable
Gallery `galDuty`:
```powerapps
Items = SortByColumns(
  Filter(pas_duties, pas_work_date = varDate,
         pas_bucket.Value in ["WORKING","OT_OFF"]),
  "pas_team", Ascending, "pas_shift_start", Ascending)
```
ในแต่ละแถว:
```powerapps
// กะ HH:MM
lblShift.Text = Text(RoundDown(ThisItem.pas_shift_start/60,0),"00") & ":" &
                Text(Mod(ThisItem.pas_shift_start,60),"00") & "–" &
                Text(RoundDown(ThisItem.pas_shift_end/60,0),"00") & ":" &
                Text(Mod(ThisItem.pas_shift_end,60),"00")
// งาน/ไฟลท์ที่ได้รับ (แกลเลอรีย่อย)
galTasks.Items = Filter(pas_assignments, pas_duty.pas_duty = ThisItem.pas_duty)
```

## หน้า Productivity
KPI:
```powerapps
// Util เฉลี่ย (อ่านจากที่ flow คำนวณไว้)
lblAvgUtil.Text = Text(
  Average(Filter(pas_duties, pas_work_date=varDate, pas_duty_min>0),
          pas_busy_min/pas_duty_min*100), "0") & "%"
lblIdleHrs.Text = Text(
  Sum(Filter(pas_duties, pas_work_date=varDate),
      Max(pas_duty_min - pas_busy_min,0))/60, "0.0")
```
Gallery รายคน + แถบ Util:
```powerapps
galPU.Items = SortByColumns(
  Filter(pas_duties, pas_work_date=varDate, pas_duty_min>0),
  "pas_busy_min", Descending)
// ในแถว: util%
With({u: RoundDown(ThisItem.pas_busy_min/ThisItem.pas_duty_min*100,0)},
  barFill.Width = u/100 * barTrack.Width;
  barFill.Fill = If(u>=80, ColorValue("#e8590c"), u>=50, ColorValue("#7ecfa0"), ColorValue("#f0b429"))
)
```

### สูตรคำนวณ busy-window ฝั่งแอป (ad-hoc / ถ้าไม่ให้ flow คำนวณ)
ต่อ 1 duty (เลือกใน galDuty) → ประมาณผลรวมนาทีติดงาน:
```powerapps
// สร้างช่วง [lo,hi] ต่อ assignment
ClearCollect(colIv,
  ForAll(Filter(pas_assignments, pas_duty.pas_duty = galDuty.Selected.pas_duty) As a,
    With({
      op:a.pas_counter_open, cl:a.pas_counter_close, sta:a.pas_sta, std:a.pas_std
    },
    If(!IsBlank(op) && !IsBlank(cl), {lo:op, hi:If(cl<op, cl+1440, cl)},
       !IsBlank(std), {lo:Max(0,std-60), hi:std},
       !IsBlank(sta), {lo:sta, hi:sta+45},
       !IsBlank(op),  {lo:op, hi:op+45},
       Blank())
    )
  )
);
// รวมช่วงซ้อน (merge) แล้วหาผลรวมนาที
With({s: Sort(Filter(colIv, !IsBlank(lo)), lo)},
  Set(varBusy, 0); Set(varHi, Blank()); Set(varLo, Blank());
  ForAll(s As r,
    If(IsBlank(varLo), Set(varLo, r.lo); Set(varHi, r.hi),
       r.lo <= varHi, Set(varHi, Max(varHi, r.hi)),
       Set(varBusy, varBusy + (varHi - varLo)); Set(varLo, r.lo); Set(varHi, r.hi))
  );
  Set(varBusy, varBusy + If(IsBlank(varLo),0, varHi - varLo))
)
// clamp เข้าเวลากะเองได้ถ้าต้องการความแม่น
```

## หน้า Gantt
Gallery `galGantt.Items` = duties ของวัน (เหมือน Timetable)
ในแต่ละแถวมี canvas กว้าง `W`; วางแท่งด้วยพิกัด X ตามนาที (แกน lo..hi ของทั้งวัน):
```powerapps
// varLo/varHi = นาทีต่ำสุด/สูงสุดของทั้งวัน (คำนวณครั้งเดียวตอนเปิดหน้า)
// แท่งกะ
rectShift.X = (ThisItem.pas_shift_start - varLo)/(varHi-varLo) * W
rectShift.Width = Max(2,(ThisItem.pas_shift_end - ThisItem.pas_shift_start)/(varHi-varLo) * W)
// แท่งงาน (แกลเลอรีย่อยของ assignment ในแถว): ใช้ winOf ด้านบนหา lo/hi
rectJob.Fill = If(ThisItem.pas_is_flight, ColorValue("#1D428A"), ColorValue("#7ecfa0"))
```

## หน้า Porter / Pre-WC
```powerapps
galPorter.Items = Filter(pas_porter_jobs, pas_work_date = varDate)
// Pre-WC ดูวันอนาคตได้ (ต่างจากเคส porter จริง)
galPrewc.Items  = Filter(pas_prewcs, pas_work_date = dpDate.SelectedDate)
lblPrewcTotal.Text = Sum(galPrewc.AllItems, pas_qty)
```

## แยกกลุ่ม HKT/BKK/Globex (การ์ดภาพรวม)
```powerapps
// นับคนทำงานวันนี้แยกแหล่ง
CountRows(Filter(pas_duties, pas_work_date=varDate, pas_is_bkk=true))              // BKK
CountRows(Filter(pas_duties, pas_work_date=varDate, pas_is_bkk=false,
          pas_employee.pas_source.Value="GLOBEX"))                                 // GLOBEX
// ที่เหลือ = HKT
```
