# หน้า ⏱️ ชม./สัปดาห์ (Power Apps) — แทนหน้าเดิมของ PAS

ตรงกับ `rbWeekHoursHtml` + `whWeekStatsFromAssign_` ใน `WorkHours.gs`:
| | กติกา (เหมือนเดิม) |
|---|---|
| ช่วง | สัปดาห์ ISO **จันทร์–อาทิตย์** ของวันที่เลือก · นับเฉพาะวันที่ผ่านมาแล้ว (วันอนาคตยังไม่นับ) |
| ชม.กะ / วัน | รวม `shift_hours` และนับวัน **เฉพาะวันที่มาทำงานจริง** (bucket = WORKING หรือ OT_OFF) |
| OT | รวม `ot_hours` ทั้งสัปดาห์ |
| 1 คน/วัน | ถ้าวันเดียวมีหลายแถว (เช่น ไปช่วยทีมอื่น) นับแถวเดียว — ใช้แถวทีมต้นสังกัดก่อน |
| เตือน | ชม.กะ **> 48** · วัน **> 7** · OT **> 36** ต่อสัปดาห์ (ระเบียบ AOTGA) |
| รายชื่อ | คนที่อยู่ในเวร **ของวันที่เลือก** (ทีมตามวันนั้น) · เรียง: เกินเกณฑ์ก่อน → ชม.กะ+OT มากก่อน |

ข้อมูล: `PAS_Duty` (นำเข้าแล้วจาก Flow B) + `PAS_Employees` (ตำแหน่ง) — ไม่ต้องสร้าง List/flow เพิ่ม
> หมายเหตุ: หน้าเดิมรวมคนของ LL (ติดตามสัมภาระ) ด้วย — ยังไม่มีตัวนำเข้าไฟล์ LL ในชุดนี้ (จะทำในขั้นถัดไป) ตอนนี้แสดงเฉพาะ PSA

---

## 1) ค่าตั้งต้น (App.OnStart — เพิ่มต่อท้าย)
```powerapps
Set(varWhMaxHr, 48); Set(varWhMaxDay, 7); Set(varWhMaxOT, 36)      // WH_WEEK_MAXHR / WH_WEEK_MAXDAY / WH_WEEK_MAXOT
```
ปุ่มเมนู: `Set(varTab, "wh"); Select(btnLoadWh)` · container `Visible = varTab = "wh"`
และเพิ่ม `If(varTab = "wh", Select(btnLoadWh))` ต่อท้าย `dpDay.OnChange` (เปลี่ยนวันแล้วคำนวณใหม่)

## 2) ปุ่มโหลด `btnLoadWh` (ซ่อนได้) · `OnSelect`
```powerapps
// จันทร์ของสัปดาห์ที่มีวันที่เลือก
With({d0: Date(Value(Left(varDay, 4)), Value(Mid(varDay, 6, 2)), Value(Right(varDay, 2)))},
    Set(varWkMon, DateAdd(d0, -(Weekday(d0, StartOfWeek.Monday) - 1), TimeUnit.Days)));
Set(varWkLabel, Text(varWkMon, "yyyy") & "-W" & Text(ISOWeekNum(varWkMon), "00") & "  (" &
    Text(varWkMon, "d mmm") & " – " & Text(DateAdd(varWkMon, 6, TimeUnit.Days), "d mmm") & ")");

// เวรทั้งสัปดาห์ — โหลดทีละวัน (≤ ~650 แถว/วัน · ไม่ติดเพดาน 2,000) · ข้ามวันอนาคต
Clear(colWk);
ForAll(Sequence(7, 0) As i,
    With({dt: DateAdd(varWkMon, i.Value, TimeUnit.Days)},
        If(dt <= Today(),
            Collect(colWk,
                ShowColumns(Filter(PAS_Duty, day_key = Text(dt, "yyyy-mm-dd")),
                    day_key, team, emp_code, emp_name, bucket, shift_hours, ot_hours, is_support)))));
Set(varWhDays, CountRows(Distinct(colWk, day_key)));

// 1 คน/วัน (ใช้แถวที่ไม่ใช่ซัพพอร์ตก่อน)
ClearCollect(colWkDE,
    ForAll(GroupBy(colWk, day_key, emp_code, rows) As g,
        With({r: First(SortByColumns(g.rows, "is_support", SortOrder.Ascending))},
            { day_key: g.day_key, emp_code: g.emp_code, emp_name: r.emp_name, team: r.team,
              work: r.bucket.Value in ["WORKING", "OT_OFF"],
              hrs: Coalesce(r.shift_hours, 0), ot: Coalesce(r.ot_hours, 0) })));

// รวมรายคน
ClearCollect(colWh,
    ForAll(GroupBy(colWkDE, emp_code, rows) As p,
        With({ h: Sum(Filter(p.rows, work), hrs), d: CountRows(Filter(p.rows, work)), o: Sum(p.rows, ot),
               td: LookUp(colDuty, emp_code = p.emp_code && !is_support) },
            { emp_code: p.emp_code,
              name: First(p.rows).emp_name,
              team: Coalesce(td.team, LookUp(colDuty, emp_code = p.emp_code).team, First(p.rows).team),
              pos: LookUp(colEmp, Title = p.emp_code).position,
              hours: Round(h, 1), days: d, ot: Round(o, 1),
              over48: h > varWhMaxHr, over7: d > varWhMaxDay, otOver: o > varWhMaxOT,
              bad: If(h > varWhMaxHr || d > varWhMaxDay || o > varWhMaxOT, 1, 0),
              load: h + o,
              inToday: !IsBlank(LookUp(colDuty, emp_code = p.emp_code)) })))
```
> ต้องมี `colDuty` (เวรของวันที่เลือก — โหลดใน `btnLoad`) และ `colEmp` (รายชื่อพนักงาน — App.OnStart) อยู่แล้วตาม `POWERAPPS-app.md`
> Power Apps รุ่นเก่าฟ้องชื่อคอลัมน์ใน `GroupBy`/`ShowColumns` → ใส่เครื่องหมายคำพูด เช่น `GroupBy(colWk, "day_key", "emp_code", "rows")`

## 3) แถบหัว (เหมือนเดิม — พื้นเหลือง `#fff7e6` ขอบซ้าย `#fec909`)
```powerapps
"⏱️ ชั่วโมงทำงานรายสัปดาห์ " & varWkLabel &
" — เพดาน " & varWhMaxHr & " ชม. / " & varWhMaxDay & " วัน · OT " & varWhMaxOT & " ชม. ต่อสัปดาห์ · " &
With({n: CountRows(Filter(colWh, inToday && (over48 || over7))), m: CountRows(Filter(colWh, inToday && otOver))},
    If(n > 0, "⚠️ ชม.กะ/วันเกิน " & n & " คน", "✅ ชม.กะอยู่ในเกณฑ์") & If(m > 0, " · ⚠️ OT เกิน " & m & " คน", "")) &
If(varWhDays < 7, "  · นับถึงวันที่มีข้อมูล " & varWhDays & "/7 วัน (สัปดาห์ยังไม่ครบ)", "")
```

## 4) ตัวกรอง
- `ddWhTeam`: `Items = Table({Value: "ALL"}, Sort(Distinct(Filter(colWh, inToday), team), Value))`
- `tglWhBad` (Toggle "เฉพาะคนเกินเกณฑ์") · `txtWhFind` (ค้นชื่อ/รหัส)

## 5) ตารางรายคน — Gallery `galWh`
```powerapps
SortByColumns(
    Filter(colWh, inToday
        && (ddWhTeam.Selected.Value = "ALL" || team = ddWhTeam.Selected.Value)
        && (!tglWhBad.Value || bad = 1)
        && (IsBlank(txtWhFind.Text) || txtWhFind.Text in name || txtWhFind.Text in emp_code)),
    "bad", SortOrder.Descending, "load", SortOrder.Descending)
```
| คอลัมน์ | Text |
|---|---|
| ทีม | `ThisItem.team` |
| รหัส | `ThisItem.emp_code` |
| ชื่อ | `ThisItem.name` |
| ตำแหน่ง | `ThisItem.pos` |
| ชม.กะ/สัปดาห์ | `ThisItem.hours` (ตัวหนา) |
| วัน | `ThisItem.days` |
| OT/สัปดาห์ | `If(ThisItem.ot > 0, Text(ThisItem.ot), "–")` · สี `If(ThisItem.otOver, Color.Red, Color.Black)` |
| สถานะ | ดูด้านล่าง |

```powerapps
If(ThisItem.bad = 1,
    "⚠️ " & Concat(Filter(Table(
        {on: ThisItem.over48, t: "ชม.กะเกิน 48ช (" & ThisItem.hours & ")"},
        {on: ThisItem.over7,  t: "เกิน 7 วัน (" & ThisItem.days & ")"},
        {on: ThisItem.otOver, t: "OT เกิน " & varWhMaxOT & "ช (" & ThisItem.ot & ")"}), on), t, " · "),
    "✅ " & ThisItem.hours & "ช / " & ThisItem.days & "วัน" & If(ThisItem.ot > 0, " · OT " & ThisItem.ot & "ช", ""))
```
พื้นแถว: `If(ThisItem.bad = 1, ColorValue("#fdecec"), Color.White)`

**ส่งออก/แจ้งหัวหน้าทีม** — ปุ่ม `Copy(Concat(Filter(galWh.AllItems, bad = 1), team & " · " & name & " — ชม.กะ " & hours & " / " & days & " วัน / OT " & ot, Char(10)))`

## ตรวจว่าตรงกับ PAS เดิม
1. เลือกวันเดียวกันทั้ง 2 ระบบ → เทียบ: จำนวน "ชม.กะ/วันเกิน" · "OT เกิน" บนแถบหัว
2. สุ่ม 5 คน (ทีมต่างกัน) → เทียบ ชม.กะ / วัน / OT
3. ไม่ตรง: ถ้าต่างที่ **ชม.กะ** → มักเป็นทีมที่คอลัมน์ ชม. (G) ต่างตำแหน่ง · ต่างที่ **OT** → คอลัมน์ OT (M/P) — ส่งชื่อทีม+ตัวอย่างมา จะแก้ `import-roster.ts`
