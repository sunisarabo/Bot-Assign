# แอป PAS (Power Apps Canvas) บน SharePoint Lists

## 1) สร้างแอป + ต่อข้อมูล
1. <https://make.powerapps.com> → **Create → Blank canvas app → Tablet** → ชื่อ `PAS Manpower`
2. **Data → Add data → SharePoint** → ใส่ `https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA`
   → ติ๊ก `PAS_Manpower`, `PAS_Duty`, `PAS_Assignment`, `PAS_Flights`, `PAS_Porter`, `PAS_PreWC`, `PAS_Teams`, `PAS_Employees`, `PAS_ImportLog`
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
> **ฉบับเต็ม (ครบเท่า PAS เดิม): `POWERAPPS-dashboard.md`** — ด้านล่างเป็นฉบับเริ่มต้น
| การ์ด | Text |
|---|---|
| ทำงานจริง | `Sum(colMp, working)` |
| ลาป่วย / พักร้อน | `Sum(colMp, sick) & " / " & Sum(colMp, annual)` |
| OT รวม (ชม.) | `Text(Sum(colMp, ot_hours), "#,##0.0")` |
| Util เฉลี่ย | `With({d: Filter(colDuty, duty_min > 0)}, If(IsEmpty(d), "–", Text(Average(d, util_pct), "0") & "%"))` |
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

## 7) หน้า Gantt (`gantt`) — เหมือน Gantt ของ PAS เดิม (`rbTtGantt_`)
**ข้อมูลมาจากตัวนำเข้า** — `import-roster` คำนวณแถบของทุกคนแบบเดียวกับระบบเดิมแล้วเก็บใน `PAS_Duty.gantt_json`
(ช่วงงานตามเคาน์เตอร์/เกท/STD จริง · OT ก่อน/หลังกะตามเวลาที่ลง · อบรม · STBY ทีมพูล · เอกสาร crew sign รวมแถบ · ซัพข้ามทีม · งานทับกันแยกเลน · คนหยุด/ลา/ป่วย)
> ตรวจกับไฟล์จริง 10 ต.ค.: **798 แถว ตรงกับ PAS เดิมทุกแถว** (แถบกะ/OT 713 · งาน 803 · ซัพข้ามทีม 46 · หยุด/ลา 258) — ทดสอบอัตโนมัติ `test/reader-parity.test.js`
> ต้องรัน `provision-lists.js` (เพิ่ม `gantt_json` · `gantt_hide` · `gantt_ord` ใน PAS_Duty) แล้วนำเข้าไฟล์เวรใหม่ (Flow C) ก่อน — แถวเก่าไม่มีข้อมูลนี้

รูปแบบ `gantt_json`: `b` = แถบกะ/OT `[เริ่ม, จบ, "s" กะ | "o" OT | "g" กะไม่ระบุ, ป้าย]` · `f` = งาน `[เริ่ม, จบ, เฟส, ซัพข้ามทีม 0/1, เลน, ป้าย, รายละเอียด]` · `n` = จำนวนเลน · `st` = OFF / SL (ป่วย) / ลา
(นาที 0–1440 ของวันนั้น · ข้ามเที่ยงคืนตัดให้แล้ว → แกน 00–24 แบบเดิม)

### 7.1 Gallery `galG` — ใช้ **Blank flexible height gallery** (แถวสูงตามจำนวนเลน)
`Items`:
```powerapps
Filter(Sort(colDuty, gantt_ord), !gantt_hide && !IsBlank(gantt_json) &&
    (IsBlank(ddGTeam.Selected.Value) || ddGTeam.Selected.Value = "ทุกทีม" || team = ddGTeam.Selected.Value) &&
    (IsBlank(txtGFind.Text) || txtGFind.Text in emp_name || txtGFind.Text in team || txtGFind.Text in emp_code))
```
(`colDuty` ต้องโหลดทุกคอลัมน์ของ PAS_Duty — ถ้าเคยใช้ `ShowColumns` ให้เพิ่ม `gantt_json`, `gantt_hide`, `gantt_ord`)
`ddGTeam.Items = Ungroup(Table({v: Table({Value: "ทุกทีม"})}, {v: Distinct(colDuty, team)}), "v")` · `txtGFind.HintText = "ค้นชื่อ / ทีม / รหัส"`
`galG.OnSelect = Set(varGSel, ThisItem)`

**ซ้าย (กว้าง 186):** Label ชื่อ `ThisItem.emp_name` (ตัวหนา 13) · Label เล็ก `ThisItem.team & If(IsBlank(ThisItem.pos_group), "", " · " & ThisItem.pos_group)` (สี `#5B7189`)
ป้าย Util (Button ทำ pill · Size 9) `Text = ThisItem.util_pct & "%"` · `Visible = ThisItem.duty_min > 0`
· `Fill = If(ThisItem.util_pct >= 75, ColorValue("#DCF2E4"), ThisItem.util_pct >= 50, ColorValue("#DCEBFA"), ThisItem.util_pct >= 30, ColorValue("#FFF3D6"), ColorValue("#FBE9EC"))`

**ขวา: Image `imgG`** · X = 190 · `Width = Parent.TemplateWidth - 194` · `ImagePosition = ImagePosition.Fill`
`Height = With({g: ParseJSON(ThisItem.gantt_json)}, If(IsBlank(g.n), 44, 36 + Value(g.n) * 18))`
`Image =`
```powerapps
With({g: ParseJSON(ThisItem.gantt_json), W: Self.Width, H: Self.Height},
With({px: W / 1440},
"data:image/svg+xml;utf8," & EncodeUrl(
"<svg xmlns='http://www.w3.org/2000/svg' width='" & W & "' height='" & H & "' viewBox='0 0 " & W & " " & H &
"' font-family='Segoe UI, Leelawadee UI, Tahoma, sans-serif' font-weight='700'>" &
// เส้นกริดทุก 2 ชม.
Concat(Sequence(13, 0, 2) As t, "<line x1='" & t.Value * 60 * px & "' x2='" & t.Value * 60 * px & "' y1='0' y2='" & H & "' stroke='#EEF3F9'/>") &
If(!IsBlank(g.st),
  // หยุด / ป่วย / ลา
  With({st: Text(g.st)},
    "<rect x='8' y='11' width='" & (Len(st) * 7 + 20) & "' height='20' rx='6' fill='" & Switch(st, "OFF", "#EEF1F5", "SL (ป่วย)", "#FBE9EC", "#E8F1FA") & "'/>" &
    "<text x='18' y='25' font-size='11.5' fill='" & Switch(st, "OFF", "#5B7189", "SL (ป่วย)", "#C93A4E", "#1F4E79") & "'>" & st & "</text>"),
  // แถบกะ (น้ำเงิน) · OT (ส้มเหลือง) · กะไม่ระบุ (เทาเส้นประ)
  Concat(Table(g.b) As s,
    With({lo: Value(Index(s.Value, 1)), hi: Value(Index(s.Value, 2)), c: Text(Index(s.Value, 3)), lb: Text(Index(s.Value, 4))},
      "<rect x='" & lo * px & "' y='5' width='" & Max(3, (hi - lo) * px) & "' height='20' rx='6' fill='" & Switch(c, "s", "#2F74AD", "o", "#F7B733", "#EEF2F7") & "'" &
        If(c = "g", " stroke='#C3CCD8' stroke-dasharray='4 3'", "") & "/>" &
      If((hi - lo) * px >= 26,
        "<text x='" & (lo * px + 7) & "' y='19' font-size='10' fill='" & Switch(c, "s", "#FFFFFF", "o", "#3A2800", "#6B7B8E") & "'>" &
        Substitute(Substitute(Left(lb, RoundDown(((hi - lo) * px - 12) / 5.6, 0)), "&", "&amp;"), "<", "&lt;") & "</text>", ""))) &
  // งาน: สีตามเฟส · ซัพข้ามทีม = สีส้มแยก + 🔁 · ทับกันแยกเลน
  Concat(Table(g.f) As s,
    With({lo: Value(Index(s.Value, 1)), hi: Value(Index(s.Value, 2)), ph: Text(Index(s.Value, 3)), sup: Value(Index(s.Value, 4)) = 1,
          y: 30 + Value(Index(s.Value, 5)) * 18, lb: Text(Index(s.Value, 6))},
      "<rect x='" & lo * px & "' y='" & y & "' width='" & Max(3, (hi - lo) * px) & "' height='16' rx='5' fill='" &
        If(sup, "#FFD8B8", Switch(ph, "ci", "#DCEBFA", "gate", "#DCF2E4", "arr", "#ECE8FB", "sod", "#D6EFEE", "lp", "#FBE3EE", "stby", "#F2F4F7", "train", "#EDE7F6", "doc", "#FFF3D6", "#EEF1F5")) &
        "' stroke='" & If(sup, "#E8590C", Switch(ph, "ci", "#A8C6E6", "gate", "#96D1AB", "arr", "#C1B9E8", "sod", "#5CB8B6", "lp", "#E2A3C6", "stby", "#AAB6C4", "train", "#B9A3DD", "doc", "#E6B84D", "#D3DDEA")) &
        "' stroke-width='" & If(sup, 1.6, 1) & "'" & If(ph = "stby", " stroke-dasharray='4 3'", "") & "/>" &
      If((hi - lo) * px >= 22,
        "<text x='" & (lo * px + 5) & "' y='" & (y + 12) & "' font-size='10' fill='" &
        If(sup, "#B4430A", Switch(ph, "ci", "#1F4E79", "gate", "#1C7A4F", "arr", "#584FB0", "sod", "#0F6F6D", "lp", "#A33272", "train", "#5E3AA8", "doc", "#9A6A00", "#5B7189")) & "'>" &
        Substitute(Substitute(Left(lb, RoundDown(((hi - lo) * px - 8) / 5.6, 0)), "&", "&amp;"), "<", "&lt;") & "</text>", "")))) &
// เส้นเวลาปัจจุบัน (เฉพาะวันนี้)
If(varDay = Text(Today(), "yyyy-mm-dd"),
  "<line x1='" & (Hour(Now()) * 60 + Minute(Now())) * px & "' x2='" & (Hour(Now()) * 60 + Minute(Now())) * px & "' y1='0' y2='" & H & "' stroke='#E5484D' stroke-width='2'/>", "") &
"</svg>")))
```
**ไม้บรรทัดเวลา** (Image เหนือ gallery · X/Width เดียวกับ `imgG` · Height 22):
```powerapps
With({W: Self.Width}, "data:image/svg+xml;utf8," & EncodeUrl(
"<svg xmlns='http://www.w3.org/2000/svg' width='" & W & "' height='22' viewBox='0 0 " & W & " 22' font-family='Segoe UI, sans-serif' font-size='11' fill='#5B7189'>" &
Concat(Sequence(13, 0, 2) As t, "<text x='" & t.Value * 60 * W / 1440 & "' y='15' text-anchor='" & If(t.Value = 0, "start", t.Value = 24, "end", "middle") & "'>" & Text(t.Value, "00") & "</text>") &
"</svg>"))
```
**คำอธิบายสี** (Label ใต้ gallery):
`"■ กะ (น้ำเงิน) · ■ OT (ส้มเหลือง) · ■ เช็คอิน · ■ เกท · ■ ขาเข้า · ■ หัวหน้า/SOD · ■ โซน LP · ■ อบรม · ■ เอกสาร · ▨ STBY · 🔁 ซัพข้ามทีม (ส้มเข้ม) · | เวลาปัจจุบัน"`
(ทำเป็น Gallery แนวนอนเล็ก ๆ ที่มีสี่เหลี่ยมสีจริงได้ — สีตามสูตรด้านบน)

### 7.2 แผงรายละเอียดเมื่อกดชื่อคน (เหมือน tooltip ของเดิม — ครบทุกงาน)
Container ขวา `conGDetail` · กว้าง 340 · `Visible = !IsBlank(varGSel)` · Fill White · เงา
- หัว: `varGSel.emp_name` (ตัวหนา 15) · Label เล็ก `varGSel.team & If(IsBlank(varGSel.pos_group), "", " · " & varGSel.pos_group) & " · " & varGSel.emp_code`
- ปุ่ม ✕: `Set(varGSel, Blank())`
- สรุป (Label): 
```powerapps
With({g: ParseJSON(varGSel.gantt_json)},
  If(!IsBlank(g.st), "สถานะ: " & Text(g.st),
    Concat(Table(g.b) As s, Switch(Text(Index(s.Value, 3)), "s", "🟦 กะ ", "o", "🟧 ", "⬜ กะไม่ระบุเวลา ") & Text(Index(s.Value, 4)), Char(10)) &
    Char(10) & "Util " & varGSel.util_pct & "% · ทำงาน " & Text(varGSel.busy_min / 60, "0.0") & " / " & Text(varGSel.duty_min / 60, "0.0") & " ชม." &
    If(IsBlank(varGSel.ac_status), "", Char(10) & "ตรวจ Assign: " & varGSel.ac_status & If(IsBlank(varGSel.ac_issue), "", " — " & varGSel.ac_issue))))
```
- รายการงาน — Gallery `galGJob` (Flexible height) · `Items`:
```powerapps
With({g: ParseJSON(varGSel.gantt_json)},
  SortByColumns(ForAll(Table(g.f) As s,
      { lo: Value(Index(s.Value, 1)), ph: Text(Index(s.Value, 3)), sup: Value(Index(s.Value, 4)) = 1,
        lb: Text(Index(s.Value, 6)), tip: Text(Index(s.Value, 7)) }), "lo", SortOrder.Ascending))
```
  แถว: แถบสีซ้าย (Rectangle กว้าง 5 · `Fill` = สีเส้นขอบตามเฟส/ซัพ เหมือนสูตร Gantt) ·
  Label หัว `ThisItem.lb` (ตัวหนา) ·
  Label รายละเอียด (Auto height) `Concat(Split(ThisItem.tip, "¦") As t, t.Value, Char(10))`
  → ได้ เช่น `SQ726/SQ725 🔁 / ขาเข้า · ARR / ช่วงงาน 08:00-08:45 / STD 09:25 · เคาน์เตอร์ 05:35-08:25 / 🔁 ซัพข้ามทีม`
  ไม่มีงาน: Label `"ไม่มีงานที่ระบุเวลา"` · `Visible = IsEmpty(galGJob.AllItems)`

## 8) หน้า Porter / Pre-WC (`porter`) — แทน 🧳 Porter ของ PAS เดิม
ข้อมูลจาก Flow E (`FLOW-porter.md`) · ต่อข้อมูลเพิ่ม `PAS_PorterStaff`

**โหลด** (ต่อท้าย `btnLoad.OnSelect`):
```powerapps
ClearCollect(colPorter, Filter(PAS_Porter, day_key = varDay));
ClearCollect(colPStaff, Filter(PAS_PorterStaff, day_key = varDay));
ClearCollect(colPreWC,  Filter(PAS_PreWC,  day_key = varDay))
```

**การ์ด Porter (เหมือนเดิม):**
| การ์ด | ค่า |
|---|---|
| เคสทั้งหมด | `CountRows(colPorter)` |
| ขาเข้า / ขาออก | `CountRows(Filter(colPorter, is_arrival)) & " / " & CountRows(Filter(colPorter, is_departure))` |
| Completed · On process · Standby | `CountRows(Filter(colPorter, status = "COMPLETED"))` (เปลี่ยนคำเป็น `"ON PROCESS"` / `"STANDBY"`) |
| รอนาน (มีระยะเวลารอ) | `CountRows(Filter(colPorter, !IsBlank(wait_time) && !(wait_time in ["0:00","00:00","0:00:00"])))` |
| พอตเตอร์ที่มีเคส | `CountRows(Filter(colPStaff, cases > 0)) & " / " & CountRows(colPStaff)` |
| แยกชนิด | `Concat(Filter(ForAll(["WCHR","WCHS","WCHC","MAAS","AVIH","ETC"] As v, {k: v.Value, n: CountRows(Filter(colPorter, service.Value = v.Value))}), n > 0), k & " " & n, " · ")` |

**ตารางเคส** — `galPorter.Items = Sort(colPorter, Coalesce(eta_min, etd_min, pickup_at_min), SortOrder.Ascending)`
แสดง: `job_no` · `airline_iata & " " & flight_no` · `porter_names` · `service_raw` · `If(is_arrival, "ขาเข้า " & eta, "ขาออก " & etd)` · `pickup_at & "–" & delivered_at` · `gate` · `status` · `remark`
สีแถว: `If(status = "COMPLETED", ColorValue("#E8F5E9"), status = "STANDBY", ColorValue("#FFF8E1"), Color.White)`

**เคสต่อพอตเตอร์** — `Sort(colPStaff, cases, SortOrder.Descending)` · `staff_name & " (" & sked & ")"` · `cases & " เคส"`

**Pre-book Wheelchair (จองล่วงหน้า — ดูวันในอนาคตได้)**
- การ์ด: จองรวม `Sum(colPreWC, qty)` · ขาเข้า `Sum(Filter(colPreWC, direction.Value = "ARR"), qty)` · ขาออก `Sum(Filter(colPreWC, direction.Value = "DEP"), qty)`
  · ต่อชนิด `Sum(Filter(colPreWC, service.Value = "WCHC"), qty)` (WCHR/WCHS/WCHC/AVIH/MAAS)
- ตารางต่อไฟลท์: `galPreWC.Items = Sort(AddColumns(GroupBy(colPreWC, flight_no, routing, sta, std, ct_open, ct_close, rows), arrT, Sum(Filter(rows, direction.Value = "ARR"), qty), depT, Sum(Filter(rows, direction.Value = "DEP"), qty), brk, Concat(rows, direction.Value & " " & service.Value & " " & qty, " · ")), Coalesce(sta, std))`
  แสดง: `flight_no` · `routing` · `sta` · `std` · `ct_open & "–" & ct_close` · `arrT` · `depT` · `brk`
- วันที่ยังไม่มีข้อมูล: `If(IsEmpty(colPreWC), "วันนี้ยังไม่มีการจองรถเข็นล่วงหน้า")`

## 9) หน้าสถานะนำเข้า (`log`) — เดือนใหม่/ปีใหม่เข้าครบไหม
เพิ่มปุ่ม Footer `Set(varTab,"log")`

**แถบเตือนบน Header** (วันที่เลือกยังไม่มีข้อมูล): Label `Visible = IsEmpty(colMp)` ·
`Text = "ยังไม่มีข้อมูลวันที่ " & varDay & " — ตรวจหน้า 'สถานะนำเข้า'"`

**ตารางคิว:**
```powerapps
galLog.Items = Sort(Filter(PAS_ImportLog, status.Value <> "Done" || day_key = varDay), Modified, SortOrder.Descending)
```
Label: `ThisItem.file_name & " · " & ThisItem.status.Value & " · " & ThisItem.day_key & " · " & ThisItem.message`
สี: `If(ThisItem.status.Value = "Error", Color.Red, ThisItem.status.Value = "Skipped", ColorValue("#E8A33D"), ThisItem.status.Value = "Done", ColorValue("#2E7D32"), Color.Gray)`

**ปฏิทินวันที่ขาดของเดือนที่เลือก** (Gallery แนวนอน/ตาราง 7 คอลัมน์):
```powerapps
With({m1: Date(Year(dpDay.SelectedDate), Month(dpDay.SelectedDate), 1)},
  With({done: Filter(PAS_ImportLog, status.Value = "Done" && StartsWith(day_key, Text(m1, "yyyy-mm")))},
    ForAll(Sequence(Day(EOMonth(m1, 0)), 1) As d,
      With({k: Text(DateAdd(m1, d.Value - 1, TimeUnit.Days), "yyyy-mm-dd")},
        {day: d.Value, key: k, ok: !IsBlank(LookUp(done, day_key = k))}))))
```
แต่ละช่อง: `Text = ThisItem.day` · `Fill = If(ThisItem.ok, ColorValue("#DCEFE0"), DateValue(ThisItem.key) <= Today(), ColorValue("#FBE3E3"), Color.White)`
· `OnSelect = Set(varDay, ThisItem.key); Select(btnLoad)` → แดง = วันที่ผ่านมาแล้วแต่ยังไม่มีไฟล์/นำเข้าไม่สำเร็จ

## 10) ใช้รายชื่อพนักงาน (`PAS_Employees`)
**App.OnStart** เพิ่ม (โหลดครั้งเดียว ~1–2 พันแถว · กรอง ACTIVE ให้ SharePoint ทำ):
```powerapps
ClearCollect(colEmp, Filter(PAS_Employees, status.Value = "ACTIVE"))
```
- **การ์ดอัตรากำลัง (ทั้งหมดในสังกัด)**: PSA `CountRows(Filter(colEmp, dept.Value = "PSA"))` · LL `CountRows(Filter(colEmp, dept.Value = "LL"))`
- **% มาทำงาน**: `Text(Sum(colMp, working) / Max(1, CountRows(Filter(colEmp, dept.Value = "PSA"))), "0%")`
- **แยก HKT/BKK/Globex ของคนทำงานวันนี้**:
  `CountRows(Filter(colDuty, isWork && LookUp(colEmp, Title = emp_code).source.Value = "BKK"))`
  (isWork = `bucket.Value in ["WORKING","OT_OFF"]`)
- **คนในเวรที่ไม่มีในรายชื่อ** (ตรวจข้อมูล): `Filter(colDuty, IsBlank(LookUp(colEmp, Title = emp_code)))`
- **ค้นหาพนักงาน**: `Search(colEmp, txtFind.Text, name_th, name_en, Title)`

## 11) หน้า OT Dashboard
ดู `POWERAPPS-ot.md` (รายเดือน · รายสัปดาห์ · เตือน OT รายคน)

## 12) หน้า ชม./สัปดาห์
ดู `POWERAPPS-weekhours.md`

## 13) หน้า สรุปสัปดาห์
ดู `POWERAPPS-weeksummary.md`

## 14) หน้า ตรวจข้อมูล
ดู `POWERAPPS-datacheck.md`

## 15) หน้า Flights & SLA
ดู `POWERAPPS-flights.md`

## 16) หน้า ไฟลท์สัปดาห์
ดู `POWERAPPS-weekflights.md`

## 17) หน้า ตรวจ Assign
ดู `POWERAPPS-assigncheck.md`

## 18) หน้า Support / เติมคน
ดู `POWERAPPS-support.md`

## 19) Publish + แชร์ + Teams
- **File → Save → Publish**
- **Share** → ใส่กลุ่ม (เช่น PSA Admin: Natty, Ice, Max, Fluke · LL Admin · หัวหน้าทีม) — ไม่ต้องให้สิทธิ์ Premium
  (ผู้ใช้ต้องมีสิทธิ์อ่าน Lists ในไซต์ — ดู README หัวข้อ "สิทธิ์ข้อมูล")
- Teams → แชนแนล → **+ (Add a tab) → Power Apps** → เลือก `PAS Manpower` → ทุกคนเปิดดูในแท็บได้เลย
- มือถือ: ติดตั้งแอป **Power Apps** → ล็อกอินบัญชีบริษัท → เห็นแอปที่แชร์ให้
