# แอป PAS (Power Apps Canvas) บน SharePoint Lists

## 1) สร้างแอป + ต่อข้อมูล
1. <https://make.powerapps.com> → **Create → Blank canvas app → Tablet** → ชื่อ `PAS Manpower`
2. **Data → Add data → SharePoint** → ใส่ `https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA`
   → ติ๊ก `PAS_Manpower`, `PAS_Duty`, `PAS_Assignment`, `PAS_Flights`, `PAS_Porter`, `PAS_PreWC`, `PAS_Teams`, `PAS_Employees`
3. **Settings → General → Data row limit = 2000**

> ทุกการกรองใช้ `day_key = varDay` (+ `team = …`) ซึ่ง **delegate ให้ SharePoint ได้** (Text eq บนคอลัมน์ที่มี index)
> จึงโหลดรายทีมทีละชุด → ไม่ติดเพดาน 2,000 แถวแม้ทั้งวันจะมีหลายพันงาน

## 2) ตัวแปร + ปุ่มโหลดข้อมูล
**App.OnStart**
```powerapps
Set(varTab, "dash");
Set(varDay, Text(Today(), "yyyy-mm-dd"))
```

**Screen1.OnVisible** → `Select(btnLoad)`

**DatePicker `dpDay`**: `DefaultDate = Today()` · `OnChange`:
```powerapps
Set(varDay, Text(dpDay.SelectedDate, "yyyy-mm-dd")); Select(btnLoad)
```

**ปุ่ม `btnLoad`** (Visible = false หรือใช้เป็นปุ่ม "รีเฟรช") · `OnSelect`:
```powerapps
ClearCollect(colMp, Filter(PAS_Manpower, day_key = varDay));
Clear(colDuty); Clear(colAsg);
ForAll(colMp As t,
    Collect(colDuty, Filter(PAS_Duty,       day_key = varDay && team = t.team));
    Collect(colAsg,  Filter(PAS_Assignment, day_key = varDay && team = t.team))
);
// กำลังคนรายชั่วโมง: อยู่เวร vs ติดงาน (รองรับกะ/งานข้ามเที่ยงคืน ด้วยการเทียบ +24 ชม.)
ClearCollect(colHour,
    ForAll(Sequence(24, 0) As h,
        With({a: h.Value * 60, b: h.Value * 60 + 60},
            { hour: h.Value,
              onDuty: CountRows(Filter(colDuty, duty_min > 0 &&
                  ((shift_start_min < b && shift_start_min + duty_min > a) ||
                   (shift_start_min < b + 1440 && shift_start_min + duty_min > a + 1440)))),
              onJob: CountRows(Distinct(Filter(colAsg, win_hi > win_lo &&
                  ((win_lo < b && win_hi > a) || (win_lo < b + 1440 && win_hi > a + 1440))), emp_code))
            })));
Set(varLo, RoundDown(Min(Filter(colDuty, duty_min > 0), shift_start_min) / 60, 0) * 60);
Set(varHi, RoundUp(Max(Filter(colDuty, duty_min > 0), shift_start_min + duty_min) / 60, 0) * 60)
```

**Dropdown `ddTeam`** (ใช้กรองหลายหน้า): `Items = Table({Value: "ALL"}, Sort(Distinct(colMp, team), Value))`
ตัวกรองที่ใช้ซ้ำ: `(ddTeam.Selected.Value = "ALL" || team = ddTeam.Selected.Value)`

## 3) โครงหน้าจอ
Header (โลโก้ + `dpDay` + `ddTeam` + ปุ่มรีเฟรช) · Main (เนื้อหา) · Footer ปุ่มแท็บ:
`Set(varTab,"dash")` / `"tt"` / `"util"` / `"gantt"` / `"porter"` — แต่ละ container ตั้ง `Visible = varTab = "…"`
สีหลัก AOTGA: `ColorValue("#1D428A")`

## 4) หน้า Dashboard (`dash`)
| การ์ด | Text |
|---|---|
| ทำงานจริง | `Sum(colMp, working)` |
| ลาป่วย / พักร้อน | `Sum(colMp, sick) & " / " & Sum(colMp, annual)` |
| OT รวม (ชม.) | `Text(Sum(colMp, ot_hours), "#,##0.0")` |
| Util เฉลี่ย | `Text(Average(Filter(colDuty, duty_min > 0), util_pct), "0") & "%"` |
| พีคอยู่เวร / ติดงาน | `Max(colHour, onDuty) & " / " & Max(colHour, onJob)` |

**ตารางรายทีม** — Gallery `Items = Sort(colMp, team)` · label: `team`, `total`, `working`, `sick`, `annual`, `training`, `ot_hours`, `util_pct & "%"`
สี Util: `Color = If(ThisItem.util_pct >= 75, Color.Red, ThisItem.util_pct >= 50, ColorValue("#E8A33D"), ColorValue("#2E7D32"))`

**กราฟรายชั่วโมง** — Insert → Charts → **Column chart** · `Items = colHour` · Labels = `hour` · Series = `onDuty`, `onJob`

## 5) หน้า Timetable (`tt`)
Gallery `galTT`:
```powerapps
Items = Sort(
    Filter(colDuty, bucket.Value in ["WORKING", "OT_OFF"] && (ddTeam.Selected.Value = "ALL" || team = ddTeam.Selected.Value)),
    shift_start_min, SortOrder.Ascending)
```
- บรรทัด 1: `ThisItem.team & " · " & ThisItem.emp_name & "  (" & ThisItem.shift_code & " " & ThisItem.shift_start & ", " & ThisItem.shift_hours & " ชม." & If(ThisItem.ot_hours > 0, " +OT " & ThisItem.ot_hours, "") & ")"`
- บรรทัด 2 (ไฟลท์ของคนนี้):
```powerapps
Concat(
    Sort(Filter(colAsg, emp_code = ThisItem.emp_code && team = ThisItem.team), win_lo),
    Title & " [" & task & "] " & Coalesce(counter_open, sta) & "–" & Coalesce(counter_close, std),
    "   ·   ")
```
- ช่องค้นหาชื่อ `txtSearch`: เพิ่มในตัวกรอง `&& (IsBlank(txtSearch.Text) || txtSearch.Text in emp_name)`

## 6) หน้า Productivity / Util (`util`)
Gallery `Items = Sort(Filter(colDuty, duty_min > 0 && (ddTeam.Selected.Value = "ALL" || team = ddTeam.Selected.Value)), util_pct, SortOrder.Descending)`
- Label: `ThisItem.emp_name & " (" & ThisItem.team & ")"` · `ThisItem.util_pct & "%  ·  " & ThisItem.busy_min & "/" & ThisItem.duty_min & " นาที"`
- แถบ: Rectangle `Width = (Parent.TemplateWidth - 320) * ThisItem.util_pct / 100` · `Fill` ใช้สูตรสีเดียวกับหน้า Dashboard

> util_pct = เวลาติดงาน (รวมช่วงซ้อนแล้ว · ตัดตามกะ) ÷ เวลาเวร — คำนวณใน `import-roster.ts` ตอนนำเข้า แอปจึงเร็ว

## 7) หน้า Gantt (`gantt`)
Gallery `galG` (TemplateHeight 28) · `Items` เหมือนหน้า Util แต่เรียง `shift_start_min`
- Label ซ้าย (กว้าง 180): `ThisItem.emp_name`
- **Image** (X = 185, Width = `Parent.TemplateWidth - 190`, Height 24) · `Image =`
```powerapps
With({W: 1000, span: Max(1, varHi - varLo)},
  "data:image/svg+xml;utf8," & EncodeUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' width='" & W & "' height='24' preserveAspectRatio='none' viewBox='0 0 " & W & " 24'>" &
    "<rect x='" & (ThisItem.shift_start_min - varLo) / span * W & "' y='4' width='" & ThisItem.duty_min / span * W &
      "' height='16' rx='3' fill='#DCE4F2'/>" &
    Concat(Filter(colAsg, emp_code = ThisItem.emp_code && team = ThisItem.team && win_hi > win_lo) As j,
      "<rect x='" & (j.win_lo + If(j.win_lo < ThisItem.shift_start_min - 120, 1440, 0) - varLo) / span * W &
      "' y='6' width='" & (j.win_hi - j.win_lo) / span * W &
      "' height='12' rx='2' fill='" & If(j.is_flight, "#1D428A", "#E8A33D") & "'><title>" & j.Title & "</title></rect>") &
    "</svg>"))
```
- แกนเวลา (ด้านบน gallery): Label `Text = Concat(Sequence((varHi - varLo) / 60 + 1, varLo / 60), Text(Mod(Value, 24), "00") & ":00", "      ")`
  (หรือวาง gallery แนวนอน `Items = Sequence((varHi - varLo)/60 + 1, varLo/60)`)

แถบฟ้าอ่อน = กะ · น้ำเงิน = ไฟลท์ · ส้ม = งานอื่น (BRIEF/GOM)

## 8) หน้า Porter / Pre-WC (`porter`)
```powerapps
galPorter.Items = Sort(Filter(PAS_Porter, day_key = varDay), pickup_at_min)
galPreWC.Items  = Sort(Filter(PAS_PreWC,  day_key = varDay), Coalesce(sta_min, std_min))
```
สรุป: `CountRows(Filter(PAS_PreWC, day_key = varDay))` · ตามบริการ: `Sum(Filter(PAS_PreWC, day_key = varDay && service.Value = "WCHC"), qty)`

## 9) Publish + แชร์ + Teams
- **File → Save → Publish**
- **Share** → ใส่กลุ่ม (เช่น PSA Admin: Natty, Ice, Max, Fluke · LL Admin · หัวหน้าทีม) — ไม่ต้องให้สิทธิ์ Premium
  (ผู้ใช้ต้องมีสิทธิ์อ่าน Lists ในไซต์ — ดู README หัวข้อ "สิทธิ์ข้อมูล")
- Teams → แชนแนล → **+ (Add a tab) → Power Apps** → เลือก `PAS Manpower` → ทุกคนเปิดดูในแท็บได้เลย
- มือถือ: ติดตั้งแอป **Power Apps** → ล็อกอินบัญชีบริษัท → เห็นแอปที่แชร์ให้
