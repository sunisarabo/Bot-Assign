# หน้าตาใหม่ "PAS Control Tower" (Power Apps)

ตัวอย่างหน้าตา (กดเมนูได้ · ข้อมูลสมมุติ): <https://claude.ai/artifact/6oNVJXUgfdhVsfAy4dj6MX>

แนวคิด: **เมนูข้างสีกรมท่า แบ่ง 5 กลุ่ม** (แทนแถบปุ่มด้านล่าง 17 ปุ่ม) · **แถบหัว** บอกหน้า · วันที่ · ทีม · สถานะนำเข้าล่าสุด · เนื้อหาเป็น **การ์ดพื้นขาว มุมโค้ง เงาบาง** บนพื้นเทาฟ้า · สีเหลือง taxiway ใช้ที่เดียว คือ **เมนูที่เลือก / เส้น "ตอนนี้"** · สีเขียว/ส้ม/แดงใช้กับ **สถานะ** เท่านั้น
ทุกค่าสีและขนาดในเอกสารนี้ตรงกับตัวอย่างหน้าตา — ใช้ร่วมกับเอกสารหน้าเดิม (`POWERAPPS-*.md`) ได้เลย: สูตรข้อมูลเหมือนเดิม เปลี่ยนแค่ "เปลือก" และสไตล์

---

## 1) ธีมกลาง — `App.Formulas` (วางครั้งเดียว ใช้ทุกหน้า)
App → `Formulas` (ถ้าไม่เห็น: Settings → Updates → เปิด **Named formulas**)
```powerapps
T = {
    bg:       ColorValue("#F2F5FA"),   // พื้นหลังแอป
    surface:  ColorValue("#FFFFFF"),   // การ์ด
    surface2: ColorValue("#F7F9FC"),   // แถวสลับ / กล่องย่อย
    ink:      ColorValue("#14213D"),   // ตัวอักษรหลัก
    ink2:     ColorValue("#5A6782"),   // ตัวอักษรรอง / หัวตาราง
    line:     ColorValue("#DDE3EE"),   // เส้นแบ่ง
    rail:     ColorValue("#16336E"),   // เมนูข้าง
    railInk:  ColorValue("#C9D5EE"),   // ตัวอักษรเมนู
    railHi:   RGBA(255, 255, 255, 0.08),
    brand:    ColorValue("#1D428A"),   // ปุ่มหลัก / แถบกราฟ
    accent:   ColorValue("#E8A200"),   // เมนูที่เลือก / เส้นตอนนี้ (ใช้น้อย)
    ok:   ColorValue("#1E7F4F"), okSoft:   ColorValue("#E3F3EA"),
    warn: ColorValue("#A86300"), warnSoft: ColorValue("#FFF1D6"),
    bad:  ColorValue("#C0362C"), badSoft:  ColorValue("#FCE6E3"),
    info: ColorValue("#2559C7"), infoSoft: ColorValue("#E6EEFC"),
    barDuty: ColorValue("#B9C8E6"),
    font: "'Segoe UI', 'Leelawadee UI', sans-serif",   // Leelawadee UI = ไทยบน Windows
    r: 12                                               // มุมโค้งการ์ด
};
// เมนู — kind "g" = หัวกลุ่ม · "n" = หน้า
Menu = Table(
    {kind: "g", id: "", label: "ภาพรวม", ic: ""},
    {kind: "n", id: "dash",  label: "Dashboard",          ic: "▦"},
    {kind: "n", id: "tt",    label: "Timetable · Gantt",  ic: "☰"},
    {kind: "g", id: "", label: "ไฟลท์ & SLA", ic: ""},
    {kind: "n", id: "flt",   label: "Flights & SLA",      ic: "✈"},
    {kind: "n", id: "wflt",  label: "ไฟลท์สัปดาห์",        ic: "▤"},
    {kind: "g", id: "", label: "จัดคน", ic: ""},
    {kind: "n", id: "ac",    label: "ตรวจ Assign",        ic: "✓"},
    {kind: "n", id: "sup",   label: "Support / เติมคน",   ic: "⇄"},
    {kind: "n", id: "auto",  label: "Auto Assign",        ic: "⚙"},
    {kind: "n", id: "adv",   label: "จัดล่วงหน้า",         ic: "▸"},
    {kind: "g", id: "", label: "OT & ชั่วโมง", ic: ""},
    {kind: "n", id: "ot",    label: "OT Dashboard",       ic: "◷"},
    {kind: "n", id: "otah",  label: "OT ล่วงหน้า",         ic: "↗"},
    {kind: "n", id: "otc",   label: "ตรวจ OT",            ic: "≟"},
    {kind: "n", id: "wh",    label: "ชม./สัปดาห์",         ic: "⧗"},
    {kind: "n", id: "wsum",  label: "สรุปสัปดาห์",         ic: "Σ"},
    {kind: "g", id: "", label: "ข้อมูล", ic: ""},
    {kind: "n", id: "porter", label: "Porter / Pre-WC",   ic: "◫"},
    {kind: "n", id: "dc",    label: "ตรวจข้อมูล",          ic: "!"},
    {kind: "n", id: "log",   label: "สถานะนำเข้า",         ic: "⇣"}
);
```
> ทุกคอนโทรลอ้างสีผ่าน `T.xxx` → อยากเปลี่ยนโทนทั้งแอป แก้ที่นี่ที่เดียว

**ตั้งค่าแอป:** Settings → Display → **Scale to fit = Off** · Lock aspect ratio = Off (ให้ยืดตามจอ) · `Screen1.Fill = T.bg`

## 2) โครงหน้าจอ (Container ซ้อนกัน)
```
Screen1
└─ conApp            Horizontal container · X 0 · Y 0 · Width Parent.Width · Height Parent.Height · Gap 0
   ├─ conRail        Vertical container · Width 232 (มือถือ: ดูข้อ 9) · Fill T.rail · Padding Top/Bottom 18
   │   ├─ conBrand   (โลโก้ + ชื่อ)
   │   └─ galNav     Gallery แนวตั้ง (เมนู)
   └─ conMain        Vertical container · Fill Portion 1 · Gap 0
       ├─ conTop     Horizontal container · Height 68 · Fill T.surface · Padding L/R 24 · Gap 12 · Align (cross) Center
       └─ conContent Vertical container · Fill Portion 1 · Padding 20/24 · Gap 16 · **Vertical overflow = Scroll**
           ├─ conDash   Visible = varTab = "dash"   (หน้าเดิมย้ายเข้ามาเป็น container ละหน้า)
           ├─ conFlt    Visible = varTab = "flt"
           └─ …
```
- ทุก container: `BorderThickness = 0` · ตั้ง **Flexible height = On** กับการ์ดที่ความสูงขึ้นกับเนื้อหา
- เส้นใต้แถบหัว: Rectangle สูง 1 ใต้ `conTop` · `Fill = T.line`

## 3) เมนูข้าง `galNav`
`Items = Menu` · **TemplateSize** = `If(ThisItem.kind = "g", 30, 38)` (เปิด Flexible height) · `TemplatePadding = 0` · `ShowScrollbar = false`
| คอนโทรลในเทมเพลต | ค่าสำคัญ |
|---|---|
| `recNavHi` Rectangle (พื้นเมนูที่เลือก) | X 0 · Width Parent.TemplateWidth · Height Parent.TemplateHeight · `Fill = T.railHi` · `Visible = ThisItem.id = varTab` |
| `recNavBar` Rectangle (แถบเหลืองซ้าย) | Width 3 · `Fill = T.accent` · `Visible = ThisItem.id = varTab` |
| `lblNavIc` Label | X 18 · Width 22 · `Text = ThisItem.ic` · `Color = If(ThisItem.id = varTab, White, T.railInk)` · `Visible = ThisItem.kind = "n"` |
| `lblNav` Label | X `If(ThisItem.kind = "g", 18, 46)` · `Text = If(ThisItem.kind = "g", Upper(ThisItem.label), ThisItem.label)` · `Size = If(ThisItem.kind = "g", 8.5, 10.5)` · `FontWeight = If(ThisItem.id = varTab, FontWeight.Semibold, FontWeight.Normal)` · `Color = If(ThisItem.id = varTab, White, T.railInk)` · `Font = T.font` |
| `btnNavCnt` Button (ตัวเลขแดง) | ชิดขวา · Width 30 · Height 18 · `Fill = T.bad` · `Color = White` · Radius 9 · Size 8 · `Text = Switch(ThisItem.id, "flt", CountRows(Filter(colSla, !ok && !no_time)), "dc", CountRows(colIssue), "otah", CountRows(Filter(colOaPerson, flag = "over")), 0)` · `Visible = ThisItem.kind = "n" && Value(Self.Text) > 0` |
`galNav.OnSelect`:
```powerapps
If(ThisItem.kind = "n",
    Set(varTab, ThisItem.id);
    Switch(ThisItem.id,
        "wflt", Select(btnLoadWf),   "auto", Select(btnLoadAp),  "adv", Select(btnLoadAdv),
        "ot",   Select(btnLoadOT),   "otah", Select(btnLoadOtah), "otc", Select(btnLoadOtc),
        "dc",   Select(btnLoadDc)))
```
ปุ่ม Footer เดิม → ลบออกได้ทั้งหมด (เมนูนี้แทน)

**โลโก้ `conBrand`** (Horizontal · Height 52 · Padding L 18 · Gap 10):
- `btnLogo` Button 34×34 · Text `"PAS"` · `Fill = T.accent` · `Color = T.ink` · Radius 9 · FontWeight Bold · Size 9 · (OnSelect ว่าง · HoverFill = Self.Fill)
- Label 2 บรรทัด: `"PAS Control Tower"` (White · Semibold 11) / `"PSA · Phuket Airport"` (T.railInk · Size 8.5)

## 4) แถบหัว `conTop`
| คอนโทรล | ค่า |
|---|---|
| `lblTitle` | `Text = LookUp(Menu, id = varTab).label` · Size 14 · Bold · `Color = T.ink` |
| `lblSub` (ใต้ title) | `Text = Text(dpDay.SelectedDate, "dddd d mmm yyyy", "th-TH")` · Size 9 · `Color = T.ink2` |
| `btnSync` (pill เขียว) | `Text = "● นำเข้าล่าสุด " & Text(varLastImp.Modified, "hh:mm") & " · " & varLastImp.Title` · `Fill = If(varLastImp.status.Value = "Done", T.okSoft, T.badSoft)` · `Color = If(varLastImp.status.Value = "Done", T.ok, T.bad)` · Radius 14 · Height 26 · Size 9 |
| `dpDay` DatePicker | `BorderColor = T.line` · Radius 9 · Height 34 (ของเดิม) |
| `ddTeam` Dropdown | `BorderColor = T.line` · `ChevronBackground = T.surface` · `ChevronFill = T.ink2` · Height 34 |
| `btnRefresh` | `Text = "รีเฟรช"` · `Fill = T.brand` · `HoverFill = ColorFade(T.brand, -15%)` · Radius 9 · Height 34 · Semibold |
ต่อท้าย `btnLoad.OnSelect`: `Set(varLastImp, First(Sort(PAS_ImportLog, Modified, SortOrder.Descending)))`

## 5) ส่วนประกอบมาตรฐาน (ทำครั้งเดียว แล้ว Copy/Paste)
**การ์ด** — Vertical container
`Fill = T.surface` · `RadiusTopLeft/TopRight/BottomLeft/BottomRight = T.r` · `DropShadow = DropShadow.Light` · `BorderThickness = 0` · Padding 14/16 · Gap 6
หัวการ์ด: Label หัว (Size 11.5 · Bold · `T.ink`) + Label hint (Size 9 · `T.ink2`) + ปุ่มลิงก์ "ดูทั้งหมด" (`Fill = Transparent` · `Color = T.brand` · Size 9)

**การ์ด KPI** — การ์ดเดียวกัน · Height 110 · ใน `conKpis` (Horizontal · Gap 12 · **Wrap = On** · การ์ดละ Fill portion 1 · Minimum width 170)
| ชิ้น | ค่า |
|---|---|
| ชื่อ | Size 9 · `T.ink2` |
| ตัวเลข | Size 20 · Bold · `T.ink` (หน่วยต่อท้ายใช้ Label แยก Size 11 `T.ink2`) |
| แถบวัด (meter) | Rectangle พื้น: Height 6 · `Fill = T.surface2` · `BorderColor = T.line` / Rectangle ค่า: Width = `Parent.Width * Min(1, ค่า/100)` · `Fill = T.ok` (หรือ `T.brand`) |
| บรรทัดเล็ก | Size 9 · `T.ink2` |
ตัวอย่าง 5 ใบ (ใช้ collection เดิมใน `POWERAPPS-dashboard.md`): คนทำงาน `Sum(colMp, working) & " / " & Sum(colMp, total)` · ลา `Sum(colMp, sick) & " · " & Sum(colMp, annual) & " · " & Sum(colMp, training)` · OT `Sum(colMp, ot_people) & " คน"` · ไฟลท์ `CountRows(colSla)` + pill ขาด/ครบ · Util `With({d: Filter(colDuty, pu_duty_min > 0)}, If(IsEmpty(d), "–", Round(Sum(d, busy_min) / Sum(d, pu_duty_min) * 100, 0) & "%"))`

**ป้ายสถานะ (pill)** — Button (Label โค้งมนไม่ได้) · Height 22 · Radius 11 · Size 9 · Semibold · Padding L/R 9 · `OnSelect` ว่าง · `HoverFill = Self.Fill` · `PressedFill = Self.Fill`
| สถานะ | Fill / Color |
|---|---|
| ครบ / ปกติ | `T.okSoft` / `T.ok` |
| ใกล้ / ควรตรวจ | `T.warnSoft` / `T.warn` |
| ขาด / เกิน | `T.badSoft` / `T.bad` |
| ข้อมูล | `T.infoSoft` / `T.info` |
สูตรเดียวจบ (เช่นสถานะไฟลท์): `Fill = If(ThisItem.ok, T.okSoft, T.badSoft)` · `Color = If(ThisItem.ok, T.ok, T.bad)` · `Text = If(ThisItem.ok, "ครบ", "ขาด")`

**ชิปเฟส SLA** (SUP · CI · Gate · Arr = จัดแล้ว/ต้องการ) — Button 64×22 · Radius 7 · BorderThickness 1
`Text = ThisItem.as_ci & "/" & ThisItem.req_ci` · `Fill = If(ThisItem.short_ci > 0, T.badSoft, T.surface2)` · `BorderColor = If(ThisItem.short_ci > 0, T.bad, T.line)` · `Color = If(ThisItem.short_ci > 0, T.bad, T.ink)` · `Visible = ThisItem.req_ci > 0`

**ตาราง** (Gallery แทน Data table — คุมสีได้)
- หัวตาราง: Labels Size 8.5 · Semibold · `T.ink2` + Rectangle เส้นล่าง `T.line`
- แถว: TemplateSize 40 · `TemplateFill = If(ThisItem.IsSelected, T.surface2, Transparent)` · เส้นคั่น Rectangle สูง 1 `T.line` ที่ขอบล่าง · ตัวเลขจัดขวา (`Align = Align.Right`)
- แถบ Util ในตาราง: เหมือน meter กว้าง 64 · สี `If(ThisItem.util_pct >= 75, T.bad, ThisItem.util_pct >= 50, T.ok, T.warn)`

**แถบประกาศ** (วันหยุด/เตือน) — Horizontal container · `Fill = T.warnSoft` · Radius 10 · Padding 9/14 · Label `Color = T.warn`

## 6) กราฟรายชั่วโมงแบบสวย (SVG แทน Column chart)
Image `imgHour` · Width = Parent.Width · Height 230 · `ImagePosition = ImagePosition.Fit`
```powerapps
"data:image/svg+xml;utf8," & EncodeUrl(
"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 720 230' font-family='Segoe UI, Leelawadee UI, sans-serif'>" &
Concat([0, 60, 120, 180] As g,
    "<line x1='34' x2='712' y1='" & (10 + 194 - g.Value / 180 * 194) & "' y2='" & (10 + 194 - g.Value / 180 * 194) & "' stroke='#DDE3EE'/>" &
    "<text x='28' y='" & (14 + 194 - g.Value / 180 * 194) & "' font-size='11' fill='#5A6782' text-anchor='end'>" & g.Value & "</text>") &
Concat(colHour As h,
    With({x: 34 + h.hour * 28.25, yd: 10 + 194 - Min(h.onDuty, 180) / 180 * 194, yj: 10 + 194 - Min(h.onJob, 180) / 180 * 194},
        "<rect x='" & (x + 2) & "' y='" & yd & "' width='24.25' height='" & (204 - yd) & "' rx='3' fill='#B9C8E6'/>" &
        "<rect x='" & (x + 7) & "' y='" & yj & "' width='14' height='" & (204 - yj) & "' rx='2' fill='#1D428A'/>" &
        If(Mod(h.hour, 3) = 0, "<text x='" & (x + 14) & "' y='222' font-size='11' fill='#5A6782' text-anchor='middle'>" & Text(h.hour, "00") & ":00</text>", ""))) &
If(varDay = Text(Today(), "yyyy-mm-dd"),
    With({nx: 34 + (Hour(Now()) + Minute(Now()) / 60) * 28.25},
        "<line x1='" & nx & "' x2='" & nx & "' y1='10' y2='204' stroke='#E8A200' stroke-width='2' stroke-dasharray='4 3'/>" &
        "<rect x='" & (nx - 22) & "' y='10' width='44' height='17' rx='8' fill='#E8A200'/>" &
        "<text x='" & nx & "' y='22' font-size='11' font-weight='600' fill='#14213D' text-anchor='middle'>" & Text(Now(), "hh:mm") & "</text>"), "") &
"</svg>")
```
> แกนตั้งตายตัว 0–180 คน ถ้าวันไหนเกิน ให้เปลี่ยน `180` ทั้งหมดเป็น `RoundUp(Max(colHour, onDuty) / 60, 0) * 60`
> คำอธิบายสี (legend) ทำเป็น 3 Label + สี่เหลี่ยมเล็กบนหัวการ์ด: อยู่เวร `#B9C8E6` · ติดงาน `#1D428A` · ตอนนี้ `#E8A200`

**วงแหวน % (ใช้กับ Util / % OT)** — Image เล็ก 64×64:
```powerapps
With({p: With({d: Filter(colDuty, pu_duty_min > 0)}, If(IsEmpty(d), 0, Min(1, Sum(d, busy_min) / Sum(d, pu_duty_min))))},
"data:image/svg+xml;utf8," & EncodeUrl(
"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 36'><circle cx='18' cy='18' r='15.9' fill='none' stroke='#E6EEFC' stroke-width='4'/>" &
"<circle cx='18' cy='18' r='15.9' fill='none' stroke='#1D428A' stroke-width='4' stroke-linecap='round' stroke-dasharray='" & Round(p * 100, 1) & " 100' transform='rotate(-90 18 18)'/></svg>"))
```

## 7) การ์ด "ไฟลท์ต้องเสริมด่วน" แบบใหม่ (Dashboard)
Gallery `galUrgent` · `Items = FirstN(SortByColumns(Filter(colSla, !ok && !no_time && std_min >= Hour(Now()) * 60 - 30), "std_min", SortOrder.Ascending), 4)` · TemplateSize 76 · TemplatePadding 4
- กล่องแถว: Rectangle `Fill = T.surface2` · `BorderColor = T.line` · Radius 10
- ซ้าย: เวลา `ThisItem.std` (Size 13 · Bold) + `"STD"` (Size 8 · `T.ink2`)
- ขวา: เลขไฟลท์ Bold + ชิปเฟส 4 อัน (ข้อ 5) + บรรทัดคนแนะนำ:
  `Coalesce(Concat(Filter(colSup, flight = ThisItem.flight && IsBlank(block)), Substitute(picks, Char(10), " · "), " · "), "ยังไม่มีคนแนะนำ")` (Size 9 · `T.ink2`)

## 8) Gantt รายคนแบบ SVG (หน้า Timetable)
Image ต่อคนใน Gallery (TemplateSize 42) — แถบกะอ่อน + แถบไฟลท์เข้ม + OT ส้ม:
```powerapps
With({lo: varLo, span: Max(60, varHi - varLo), W: 760},
"data:image/svg+xml;utf8," & EncodeUrl(
"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 760 30'>" &
"<rect x='" & (ThisItem.shift_start_min - lo) / span * W & "' y='2' width='" & ThisItem.duty_min / span * W & "' height='26' rx='6' fill='#E6EEFC' stroke='#DDE3EE'/>" &
Concat(Filter(colAsg, emp_code = ThisItem.emp_code && win_hi > win_lo) As a,
    "<rect x='" & (a.win_lo - lo) / span * W & "' y='7' width='" & (a.win_hi - a.win_lo) / span * W & "' height='16' rx='4' fill='#1D428A'/>") &
"</svg>"))
```
ชื่อคนเป็น Label ซ้าย (Width 110) · เส้นเวลา/ชั่วโมงทำเป็นอีก Image เดียวด้านบนของ Gallery
> **ฉบับใช้งานจริง:** ใช้ `POWERAPPS-app.md` ข้อ 7 แทน — แถบมาจาก `PAS_Duty.gantt_json` ที่ตัวนำเข้าคำนวณเหมือน PAS เดิม (ป้ายไฟลท์/งาน · ซัพข้ามทีมสีส้ม · เลนซ้อน · แผงรายละเอียด)

## 9) มือถือ / จอแคบ
- `conRail.Visible = App.Width >= 760`
- เพิ่ม `galNavTop` (Gallery **แนวนอน**) บนสุดของ `conMain` · `Visible = App.Width < 760` · `Items = Filter(Menu, kind = "n")` · TemplateSize 130 · `Fill = T.rail` · ใช้ OnSelect เดียวกับ `galNav` · ป้ายเลือก = Rectangle เหลืองสูง 3 ด้านล่าง
- `conKpis` เปิด Wrap แล้ว → มือถือเหลือ 2 ใบต่อแถว เอง · การ์ด 2 คอลัมน์ (`conRow`): `LayoutDirection = If(App.Width < 1100, LayoutDirection.Vertical, LayoutDirection.Horizontal)`

## 9.5) แก้ "ขนาดในหน้าเว็บไม่สมดุล" (เช็คตามลำดับ)
อาการที่เจอบ่อยเมื่อเปิดใน browser: มีขอบดำ/ขาวรอบแอป · ตัวหนังสือเล็ก/ใหญ่ผิดสัดส่วน · ด้านขวาโล่ง หรือของล้นจอ · การ์ดสูงไม่เท่ากัน

| # | จุดที่ตรวจ | ค่าที่ถูก |
|---|---|---|
| 1 | Settings → Display | **Scale to fit = Off** · **Lock aspect ratio = Off** · Lock orientation = Off (ถ้ายังเปิด Scale to fit แอปจะถูกย่อ/ขยายทั้งก้อน → ขอบเหลือและตัวหนังสือเพี้ยน) |
| 2 | ทุก Screen | `Width = Max(App.Width, App.MinScreenWidth)` · `Height = Max(App.Height, App.MinScreenHeight)` (ค่าเริ่มต้น — ถ้าเคยพิมพ์ 1366/768 ตายตัว ให้คืนค่านี้) |
| 3 | `conApp` | X 0 · Y 0 · `Width = Parent.Width` · `Height = Parent.Height` |
| 4 | `conMain` / `conContent` | ใน container แม่: **Flexible width = On** (Fill portions 1) · `conRail` เท่านั้นที่กว้างตายตัว 232 |
| 5 | ของในหน้า (การ์ด, gallery, กราฟ) | ห้ามใส่ Width เป็นตัวเลข → ใช้ **Flexible width / Fill portions** ในแนวนอน หรือ `Width = Parent.Width - 32` (เผื่อ Padding ซ้ายขวา 16) ในแนวตั้ง · ตัด X/Y ที่พิมพ์ตายตัวทิ้ง (container จัดตำแหน่งเอง) |
| 6 | แถว KPI `conKpis` | Horizontal · **Wrap = On** · การ์ดแต่ละใบ Fill portions 1 · **Minimum width 170** → จอกว้างได้ 6 ใบเท่ากัน จอแคบตกบรรทัดเอง |
| 7 | การ์ด 2 คอลัมน์ `conRow` | ทั้งสองการ์ด Fill portions **เท่ากัน** (หรือ 2:1 ถ้าต้องการตารางใหญ่กว่า) · `Align (cross-axis) = Stretch` → การ์ดสูงเท่ากัน |
| 8 | Gallery | `Width = Parent.Width` · `TemplateSize` คงที่ (เช่น 44) · Label ในแถว `Width = Parent.TemplateWidth * 0.3` (แบ่งเป็นสัดส่วน ไม่ใช่ px) |
| 9 | กราฟ SVG (Image) | `Width = Parent.Width` · `ImagePosition = ImagePosition.Fit` · ใน SVG ใช้ `viewBox` + `preserveAspectRatio='none'` ถ้าอยากให้ยืดเต็มกว้าง |
| 10 | ตัวหนังสือ | ใช้ขนาดจากธีมเท่านั้น (หัวหน้า 18 · หัวการ์ด 13 · เนื้อ 11 · ตัวเลข KPI 24) ไม่ต้องคูณตาม App.Width |

ทดสอบ: เปิดแอปแล้วย่อ/ขยายหน้าต่าง browser — ทุกอย่างต้องยืดตาม ไม่มีขอบเหลือ ถ้ามีกล่องไหนไม่ยืด แปลว่ากล่องนั้นยังมี Width เป็นตัวเลข

## 9.6) แถบแดง error บนหน้าแอป
| ข้อความ | สาเหตุ | แก้ |
|---|---|---|
| `ไม่สามารถใช้ฟังก์ชัน Average กับตารางว่างเปล่า` | วัน/ช่วงที่ยังไม่มีข้อมูล (เช่น ก่อนนำเข้า) แล้วการ์ด Util/ค่าเฉลี่ยเรียก `Average` | ครอบด้วย `If(IsEmpty(ตาราง), "–", Average(ตาราง, คอลัมน์))` — สูตรในเอกสารแก้ให้แล้ว (Util ใน Dashboard · วงแหวน Util · ไฟลท์เฉลี่ย/วัน) |
| `อาร์กิวเมนต์ที่สองของฟังก์ชัน 'Index' ต้องอยู่ระหว่าง 1 และ N` | `Index(ตาราง, n)` ที่ n เกินจำนวนแถว (เช่น ตารางสัดส่วนคอลัมน์มี N ค่า แต่เรียกช่องที่ N+1 · หรือ Index ของ 7 วันแต่ n เป็น 0/8) | ใน Studio เปิด **App checker (ไอคอนหูฟัง) → Formulas** จะชี้ control ที่ผิด · แก้เป็น `If(n >= 1 && n <= CountRows(ตาราง), Index(ตาราง, n).Value)` · ถ้าเป็น `WfCol` ต้องมีค่า = จำนวนคอลัมน์ + 1 (เริ่ม 0 จบ 1) |

## 10) ลำดับลงมือ (ประมาณ 2–3 ชม. สำหรับเปลือก + Dashboard)
1. วาง `App.Formulas` (ข้อ 1) → ตั้ง Scale to fit = Off
2. สร้าง `conApp` → `conRail` + `galNav` → `conMain` + `conTop` + `conContent` (ข้อ 2–4)
3. ย้าย container ของแต่ละหน้าเดิมเข้า `conContent` (ตัด/วาง) แล้วลบปุ่ม Footer
4. ทำการ์ด/KPI/pill ต้นแบบ 1 ชุด (ข้อ 5) → Copy ไปใช้ทุกหน้า
5. เปลี่ยนกราฟ Dashboard เป็น SVG (ข้อ 6) และการ์ดไฟลท์ด่วน (ข้อ 7)
6. ทดสอบที่ความกว้าง 1366 (คอม) และเปิดในแอป Power Apps บนมือถือ (ข้อ 9)

**ข้อจำกัดที่ควรรู้:** Label ใน Power Apps ทำมุมโค้งไม่ได้ (จึงใช้ Button แทน pill) · เงาการ์ดมี 4 ระดับคงที่ (`DropShadow.Light` ดูใกล้ตัวอย่างที่สุด) · แอปไม่เปลี่ยนเป็นโหมดมืดตามระบบเอง (ตัวอย่างหน้าตามีโหมดมืดให้ดู แต่ในแอปใช้โทนสว่างเป็นหลัก)
