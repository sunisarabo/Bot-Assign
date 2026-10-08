# หน้า OT Dashboard (Power Apps) — แทน ⏱️ OT Dashboard ของ PAS เดิม

ตรงกับหน้าเดิม (`OTDashboard.gs`) + เพิ่มการเตือนรายคน (`rbOTAlerts_` ใน `RosterBot.gs`):

| ส่วน | เดิม | ใหม่ |
|---|---|---|
| การ์ด | OT รวม · จำนวนทีม · จำนวนเดือน · ทีมสูงสุด | เหมือนเดิม |
| แท็บ **รายเดือน** | กราฟแท่ง OT รายทีม + ตาราง ทีม × เดือน | เหมือนเดิม |
| แท็บ **รายสัปดาห์** | เลือกเดือน → ตาราง ทีม × (1-7, 8-14, 15-21, 22-สิ้นเดือน) | เหมือนเดิม |
| แท็บ **เตือน OT** | (อยู่ในรายงานประจำวัน) | สัปดาห์ จ.–อา. > 36 ชม. · เดือน > 144 ชม. · ใกล้ถึง ≥ 30 / ≥ 130 |

**ตัวเลข OT** = OT ปกติ + OT นักขัต X1 (มาทำงานวันหยุดประเพณี = ชั่วโมงกะ) · **ไม่นับแถวซัพพอร์ต** "ชื่อ (ทีม)" — กติกาเดียวกับเดิม
(เตือนรายคนใช้ OT ปกติ ไม่รวมนักขัต — เหมือน ledger เดิม)

> **ข้อมูลมาจากไหน:** `PAS_Manpower` (OT รายทีม/วัน) และ `PAS_OT_Person` (OT รายคน/วัน) ที่ Flow B เขียนตอนนำเข้าไฟล์เวร
> ข้อมูลที่นำเข้า **ก่อน** อัปเดตนี้ยังไม่มีคอลัมน์ OT ใหม่ → กด **Flow C** ใส่ `/Shared Documents/2026` ซ้ำ 1 ครั้งเพื่อคำนวณใหม่ทั้งปี
> เดือนที่ไม่มีไฟล์เวรบน SharePoint (เช่น ม.ค.–พ.ค. ที่เดิมอ่านจากไฟล์ OT Yearly) จะว่าง — ถ้าต้องการ แจ้งได้ จะทำตัวนำเข้า OT Yearly ให้

---

## 1) ต่อข้อมูลเพิ่ม
**Data → Add data → SharePoint** (ไซต์เดิม) → ติ๊ก `PAS_OT_Person`, `PAS_Holidays`

## 2) ค่าตั้งต้น (App.OnStart — เพิ่มต่อท้าย)
```powerapps
Set(varOTWeekLimit, 36); Set(varOTMonthLimit, 144);       // เกณฑ์เดิม OT_WEEK_LIMIT / OT_MONTH_LIMIT
Set(varOTWeekNear, 30);  Set(varOTMonthNear, 130);        // "ใกล้ถึง"
Set(varTHM, ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]);
Set(varOTYear, Year(Today())); Set(varOTTab, "month")
```
เพิ่มปุ่ม Footer: `Set(varTab, "ot"); Select(btnLoadOT)` · container หน้านี้ `Visible = varTab = "ot"`

## 3) ปุ่มโหลด `btnLoadOT` (ซ่อนได้ / ใช้เป็นปุ่ม 🔄) · `OnSelect`
```powerapps
// OT รายทีม/วัน ทั้งปี — โหลดทีละเดือน (≤ ~650 แถว/เดือน · ไม่ติดเพดาน 2,000)
Clear(colOT);
ForAll(Sequence(12, 1) As m,
    Collect(colOT,
        AddColumns(
            Filter(PAS_Manpower, month_key = Text(varOTYear) & "-" & Text(m.Value, "00")),
            mnum, m.Value,
            wk, Min(4, RoundDown((Value(Right(day_key, 2)) - 1) / 7, 0) + 1),        // 1-7 · 8-14 · 15-21 · 22-สิ้นเดือน
            ot, Coalesce(ot_total, ot_hours + Coalesce(ot_hol_hours, 0))
        )));
ClearCollect(colOTTeam,
    Sort(AddColumns(GroupBy(colOT, team, rows), total, Sum(rows, ot)), total, SortOrder.Descending));
ClearCollect(colOTMonths, Sort(Distinct(Filter(colOT, ot > 0), mnum), Value));
Set(varOTMonth, Last(colOTMonths).Value);

// เตือนรายคน: สัปดาห์ (จ.–อา.) และเดือน ของวันที่เลือก
Set(varOTDay, Coalesce(dpOT.SelectedDate, Today()));
Set(varOTWeekKey, Text(DateAdd(varOTDay, -(Weekday(varOTDay, StartOfWeek.Monday) - 1), TimeUnit.Days), "yyyy-mm-dd"));
Set(varOTMonthKey, Text(varOTDay, "yyyy-mm"));
Clear(colOTP); Clear(colOTW);
ForAll(Distinct(colOT, team) As t,
    Collect(colOTP, Filter(PAS_OT_Person, month_key = varOTMonthKey && team = t.Value));
    Collect(colOTW, Filter(PAS_OT_Person, week_key = varOTWeekKey && team = t.Value)));
ClearCollect(colOTAlert,
    ForAll(Distinct(Ungroup(Table({x: ShowColumns(colOTP, emp_code)}, {x: ShowColumns(colOTW, emp_code)}), x), emp_code) As e,
        With({p: LookUp(colOTP, emp_code = e.Value), w: LookUp(colOTW, emp_code = e.Value)},
            { emp_code: e.Value,
              name: Coalesce(p.emp_name, w.emp_name), team: Coalesce(p.team, w.team),
              month: Sum(Filter(colOTP, emp_code = e.Value), ot_hours),
              week:  Sum(Filter(colOTW, emp_code = e.Value), ot_hours) })))
```
> ถ้า Studio ฟ้องชื่อคอลัมน์ใน `AddColumns`/`GroupBy` (Power Apps รุ่นเก่า) ให้ใส่เครื่องหมายคำพูด เช่น `AddColumns(…, "mnum", m.Value, …)`, `GroupBy(colOT, "team", "rows")`

**ตัวเลือกบนหัวหน้า:**
- `ddOTYear`: `Items = Sequence(3, Year(Today()) - 2)` · `Default = Year(Today())` · `OnChange = Set(varOTYear, ddOTYear.Selected.Value); Select(btnLoadOT)`
- `dpOT` (วันที่สำหรับเตือนรายคน): `DefaultDate = Today()` · `OnChange = Select(btnLoadOT)`
- แท็บย่อย 3 ปุ่ม: `Set(varOTTab, "month")` / `"week"` / `"alert"`

## 4) การ์ด (แสดงทุกแท็บ)
| การ์ด | ค่า | บรรทัดล่าง |
|---|---|---|
| OT รวมทั้งหมด | `Text(Sum(colOT, ot), "#,##0.0")` | `"ชม. (ทุกทีม ทุกเดือน)"` |
| จำนวนทีม | `CountRows(Filter(colOTTeam, total > 0))` | `"ทีมที่มี OT"` |
| จำนวนเดือน | `CountRows(colOTMonths)` | `Concat(colOTMonths, Index(varTHM, Value).Value, " ")` |
| ทีมสูงสุด | `Text(First(colOTTeam).total, "#,##0.0")` | `First(colOTTeam).team` |

สีแถบบนการ์ด (เหมือนเดิม): ส้ม `#f97316` · น้ำเงิน `#3b82f6` · ม่วง `#a855f7` · แดง `#ef4444`

## 5) แท็บรายเดือน (`varOTTab = "month"`)
**กราฟแท่ง "OT รวมรายทีม (ทั้งช่วง)"** — Gallery `galOTBar` · `Items = Filter(colOTTeam, total > 0)` · TemplateHeight 32
- Label ทีม (กว้าง 180): `ThisItem.team`
- Rectangle แท่ง: `X = 190` · `Width = Max(4, (Parent.TemplateWidth - 280) * ThisItem.total / Max(1, First(colOTTeam).total))` · `Fill = ColorValue("#1D428A")`
- Label ค่า: `X = Self.X` ของแท่ง + Width + 6 · `Text = Text(ThisItem.total, "#,##0.0") & " ชม."`

**ตาราง "OT · ทีม × เดือน (ชม.)"**
- หัวตาราง: Gallery แนวนอน `Items = colOTMonths` · `Text = Index(varTHM, ThisItem.Value).Value` + Label "รวม" ท้าย
- Gallery `galOTMonth` · `Items = Filter(colOTTeam, total > 0)`
  - Label ทีม: `ThisItem.team`
  - Gallery แนวนอนซ้อนใน (`galOTCells`, ความกว้างช่องเท่าหัว): 
    `Items = AddColumns(colOTMonths, v, Sum(Filter(ThisItem.rows, mnum = Value), ot))` ·
    Label `Text = If(ThisItem.v > 0, Text(ThisItem.v, "#,##0.0"), "·")`
  - Label รวม: `Text(ThisItem.total, "#,##0.0")` (ตัวหนา)

## 6) แท็บรายสัปดาห์ (`varOTTab = "week"`)
- Dropdown `ddOTMonth`: `Items = colOTMonths` · แสดง `Index(varTHM, Value).Value` (ตั้ง Value ของ dropdown เป็นคอลัมน์ `Value`, ใช้ Label ซ้อนแสดงชื่อไทย หรือใช้ `Items = AddColumns(colOTMonths, th, Index(varTHM, Value).Value)` แล้วเลือกแสดง `th`) · `Default = varOTMonth`
- Gallery `galOTWeek`:
```powerapps
Sort(
    Filter(
        AddColumns(colOTTeam,
            w1, Sum(Filter(rows, mnum = ddOTMonth.Selected.Value && wk = 1), ot),
            w2, Sum(Filter(rows, mnum = ddOTMonth.Selected.Value && wk = 2), ot),
            w3, Sum(Filter(rows, mnum = ddOTMonth.Selected.Value && wk = 3), ot),
            w4, Sum(Filter(rows, mnum = ddOTMonth.Selected.Value && wk = 4), ot),
            mt, Sum(Filter(rows, mnum = ddOTMonth.Selected.Value), ot)),
        mt > 0),
    mt, SortOrder.Descending)
```
  คอลัมน์: `team` · `1-7` = `w1` · `8-14` = `w2` · `15-21` = `w3` · `22-สิ้นเดือน` = `w4` · `รวม` = `mt`
  (ช่องที่เป็น 0 แสดง `"·"`: `If(ThisItem.w1 > 0, Text(ThisItem.w1, "#,##0.0"), "·")`)
- กราฟแท่งของเดือนที่เลือก: ใช้ gallery แบบข้อ 5 กับ `Items` ด้านบน ค่า = `mt`

## 7) แท็บเตือน OT รายคน (`varOTTab = "alert"`)
**การ์ด:**
| การ์ด | ค่า |
|---|---|
| 🔴 สัปดาห์เกิน 36 | `CountRows(Filter(colOTAlert, week > varOTWeekLimit))` |
| 🟠 สัปดาห์ใกล้ (≥30) | `CountRows(Filter(colOTAlert, week >= varOTWeekNear && week <= varOTWeekLimit))` |
| 🔴 เดือนเกิน 144 | `CountRows(Filter(colOTAlert, month > varOTMonthLimit))` |
| 🟠 เดือนใกล้ (≥130) | `CountRows(Filter(colOTAlert, month >= varOTMonthNear && month <= varOTMonthLimit))` |

หัวข้อ: `"สัปดาห์ " & Text(DateValue(varOTWeekKey), "d mmm") & " – " & Text(DateAdd(DateValue(varOTWeekKey), 6, TimeUnit.Days), "d mmm") & " · เดือน " & Index(varTHM, Month(varOTDay)).Value`

**รายชื่อ** — Gallery `galOTAlert`:
```powerapps
Sort(
    Filter(colOTAlert, week >= varOTWeekNear || month >= varOTMonthNear),
    Max(week / varOTWeekLimit, month / varOTMonthLimit), SortOrder.Descending)
```
- Label: `ThisItem.name & "  (" & ThisItem.team & ")"`
- Label: `"สัปดาห์ " & Text(ThisItem.week, "0.0") & " · เดือน " & Text(ThisItem.month, "0.0") & " ชม."`
- ป้าย:
```powerapps
If(ThisItem.month > varOTMonthLimit, "🔴 เดือนเกิน " & varOTMonthLimit,
   ThisItem.week > varOTWeekLimit,   "🔴 สัปดาห์เกิน " & varOTWeekLimit,
   ThisItem.month >= varOTMonthNear, "🟠 เดือนใกล้ " & varOTMonthLimit,
                                     "🟠 สัปดาห์ใกล้ " & varOTWeekLimit)
```
- พื้นแถว: `Fill = If(ThisItem.month > varOTMonthLimit || ThisItem.week > varOTWeekLimit, ColorValue("#fdecec"), ColorValue("#fff3e0"))` (สีเดียวกับเดิม)

**คัดลอกข้อความแจ้งหัวหน้าทีม** — ปุ่ม `Copy(Concat(galOTAlert.AllItems, name & " (" & team & ") สัปดาห์ " & Text(week,"0.0") & " / เดือน " & Text(month,"0.0") & " ชม.", Char(10)))`

## 8) วันหยุดประเพณี (`PAS_Holidays`)
ตั้งต้นมี 14 วันของปี 2569 (ประกาศ AOTGA 403/2568 — คัดจาก `RosterReader.gs`)
**ขึ้นปีใหม่:** เปิด List → New → Title = ชื่อวันหยุด · `day_key` = `2027-01-01` · `holiday_date` = วันเดียวกัน
แล้ว Flow B คิด OT นักขัตให้เองตั้งแต่ไฟล์ถัดไป (ไฟล์ที่นำเข้าไปแล้ว → กด Flow C ใส่โฟลเดอร์เดือนนั้นซ้ำ)

## ตรวจว่าตัวเลขตรงกับ PAS เดิม
1. ในแอปใหม่ เลือกปี 2026 → แท็บรายเดือน → จดยอด ต.ค. ของ 3 ทีม
2. ใน PAS เดิม → ⏱️ OT Dashboard → รายเดือน → เทียบ 3 ทีมเดียวกัน
3. ต่างกัน → ส่งชื่อทีม + 2 ตัวเลขมา (มักเกิดจากคอลัมน์ OT ในแท็บทีมนั้นต่างจากตำแหน่งมาตรฐาน — แก้ใน `import-roster.ts`)
