# หน้า 📅 จัดล่วงหน้า (Power Apps) — แทนหน้าเดิมของ PAS

ข้อเสนอจัด assignment ของวันในอนาคต: เอาคนที่ขึ้นเวรใน **ROSTER ล่วงหน้า** มาจัดลงไฟลท์ใน **ตารางบิน** ตาม SLA โดยแยก 7 บทบาท
**SUP · FC (Flight Controller) · Check-in · Arrival · Standby · Gate Monitor · Gate Agent**
คำนวณโดย Flow G (`FLOW-advance.md`) เก็บใน `PAS_AdvPlan` (ต่อไฟลท์) + `PAS_AdvRoster` (ต่อคน)

## กติกา (เหมือนเดิม)
| | |
|---|---|
| คนที่จัดได้ | ขึ้นเวรใน ROSTER วันนั้น (มีช่วงเวลา TIME) · ไม่ OFF/ลา · ไม่ลาออก (ตาม PAS_Employees) |
| ทีม | จับเข้า **ทีมทางการ 15 ทีม** (JQ, AK, SQ, ZF, EK, QR, CHN, KE, PVT, TR, PG, SU, TK, EY, WY/WK) → รู้สายการบินและระบบเช็คอินของทีม · PVT ใช้ได้หลายระบบ |
| ลำดับ | ไล่ไฟลท์ตามเวลา · ในไฟลท์จัด SUP → FC → Check-in → Arrival → Standby → Gate Monitor → Gate Agent |
| เลือกคน | **คนทีมเจ้าของสายก่อนเสมอ** แล้วจึงข้ามทีม · SUP/FC/Check-in ต้องรู้ระบบ · SUP = Sup · FC = Sup/Senior · กระจายงาน · ไม่ซ้ำคนในไฟลท์เดียว |
| ว่างจริง | กะครอบช่วงงาน ±30 นาที · เผื่อเดินทาง 55 นาที (2 ไฟลท์ติด → พัก 60 นาที) |
| Gate Agent | คนเช็คอินเดินต่อไปเกท (ยกเว้นสายที่แยกคนเกท) |
| จำนวนคน | ตาราง SLA ต่อสาย · ปรับจำนวนเช็คอินตามชนิดเครื่อง (A/C TYPE จากตารางบิน) |
| ขาดคน | เสนอ **คนที่ให้ OT แล้วคลุมได้** (ต่อหลังกะ/เข้าก่อนกะ ไม่เกิน 4 ชม.) — OT น้อยและงานน้อยก่อน |

---

## 1) ปุ่มเมนู + โหลด
ปุ่มเมนู: `Set(varTab, "adv"); Select(btnLoadAdv)` · container `Visible = varTab = "adv"`
DatePicker ของหน้านี้ `dpAdv.DefaultDate = Today() + 1`

**`btnLoadAdv.OnSelect`**
```powerapps
Set(varAdvDay, Text(dpAdv.SelectedDate, "yyyy-mm-dd"));
ClearCollect(colAdv,
    AddColumns(Filter(PAS_AdvPlan, day_key = varAdvDay && kind.Value = "FLIGHT"),
        sup, ForAll(Table(ParseJSON(a_sup)) As c, {name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3))}),
        fc,  ForAll(Table(ParseJSON(a_fc))  As c, {name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3))}),
        ci,  ForAll(Table(ParseJSON(a_ci))  As c, {name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3))}),
        arr, ForAll(Table(ParseJSON(a_arr)) As c, {name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3))}),
        stb, ForAll(Table(ParseJSON(a_stb)) As c, {name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3))}),
        gm,  ForAll(Table(ParseJSON(a_gm))  As c, {name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3))}),
        ga,  ForAll(Table(ParseJSON(a_ga))  As c, {name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3))}),
        otc, ParseJSON(ot_json)));
ClearCollect(colAdvRos, Filter(PAS_AdvRoster, day_key = varAdvDay));
Set(varAdvSum, LookUp(PAS_AdvPlan, day_key = varAdvDay && kind.Value = "SUM"))
```

**ปุ่ม 🔄 จัดใหม่** (เรียก Flow G เฉพาะวันนั้น — เช่น หลังแก้ ROSTER):
```powerapps
Set(varAdvBusy, true);
Set(varAdvMsg, PASGAdvanceplan.Run(varAdvDay, varAdvDay).done);
Set(varAdvBusy, false); Select(btnLoadAdv)
```
> Power Apps → Power Automate → เพิ่ม flow `PAS · G Advance plan` ก่อน (ชื่อฟังก์ชันตามชื่อ flow) · ระหว่างรอแสดง `"⏳ กำลังจัด…"` เมื่อ `varAdvBusy`

## 2) หัว
```powerapps
If(IsBlank(varAdvSum), "— ยังไม่มีแผนของวันนี้ (กด 🔄 จัดใหม่ · ต้องมีกะใน ROSTER และไฟลท์ใน PAS_Flights)",
"📅 จัดล่วงหน้า " & Text(dpAdv.SelectedDate, "dd mmm yyyy") & " · ไฟลท์ " & varAdvSum.n_flights &
" · คนขึ้นเวร " & varAdvSum.n_people & " (จัดแล้ว " & varAdvSum.n_assigned & ")" &
If(varAdvSum.n_short > 0, " · ⚠️ ยังขาดคน " & varAdvSum.n_short & " ไฟลท์", " · ครบ ✅"))
```
ตัวกรองทีม `ddAdvTeam.Items = Table({Value: "ALL"}, Sort(Distinct(colAdv, team), Value))` · สวิตช์ `tglAdvShort` "เฉพาะไฟลท์ที่ขาด"

## 3) ตารางไฟลท์ × บทบาท — Gallery `galAdv` (Flexible height)
`Items = SortByColumns(Filter(colAdv, (ddAdvTeam.Selected.Value = "ALL" || ddAdvTeam.Selected.Value in team) && (!tglAdvShort.Value || !ok)), "seq", SortOrder.Ascending)`

| ช่อง | Text |
|---|---|
| Flight | `ThisItem.flight` (ตัวหนา) · รอง `ThisItem.team & " · " & Coalesce(ThisItem.system, "iPort")` |
| STA/STD · เคาน์เตอร์ | `Coalesce(ThisItem.sta, "–") & "/" & Coalesce(ThisItem.std, "–") & Char(10) & "CI " & ThisItem.counter` |
| SUP · FC · Check-in · Arrival · Standby · Gate Monitor · Gate Agent | สูตรช่องบทบาทด้านล่าง |
| สถานะ | `If(ThisItem.ok, "✅", "⚠️ " & (ThisItem.tot_req - ThisItem.tot_asg))` |

**ช่องบทบาท** (ตัวอย่าง Check-in — เปลี่ยน `ci` / `req_ci` / `short_ci` / `"CI"` ให้ตรงบทบาท: `sup`/`"SUP"`, `fc`/`"FC"`, `arr`/`"ARR"`, `stb`/`"STB"`, `gm`/`"GM"`, `ga`/`"GA"`):
```powerapps
If(ThisItem.req_ci = 0, "—",
    CountRows(ThisItem.ci) & "/" & ThisItem.req_ci & If(ThisItem.short_ci > 0, " ⚠️", " ✓") & Char(10) &
    Concat(ThisItem.ci, name & " (" & pos & If(!(team in ThisItem.team), " ←" & team, "") & ")", Char(10)) &
    If(ThisItem.short_ci > 0, Char(10) & "💡 OT: " &
        Concat(Table(ThisItem.otc.CI) As o, Text(Index(o.Value, 1)) & " +" & Text(Index(o.Value, 5)) & "ช " & Text(Index(o.Value, 6)), ", "), ""))
```
พื้นแถว `If(ThisItem.ok, Color.White, ColorValue("#fff3cd"))`

## 4) คนพัก/สำรอง + เลือกคนแทน (แทน dropdown เดิม)
- **😴 คนพัก** `Items = GroupBy(Filter(colAdvRos, n_jobs = 0), team, ppl)` · Text `ThisItem.team & ": " & Concat(ThisItem.ppl, emp_name & " " & shift, ", ")`
- **หาคนแทนในช่องที่ขาด**: กดแถวไฟลท์ → `Set(varAdvF, ThisItem)` → แผงขวา `galAdvCand`:
  ```powerapps
  SortByColumns(Filter(colAdvRos,
      ds_min <= Value(Left(varAdvF.counter, 2)) * 60 + Value(Mid(varAdvF.counter, 4, 2)) + 30),
      "n_jobs", SortOrder.Ascending)
  ```
  แสดง `emp_name & " · " & pos & " · " & team & " · " & shift & " · " & n_jobs & " งาน"` และให้ทีมเจ้าของสายขึ้นก่อน (`team in varAdvF.team`)
  > เป็นรายชื่อคร่าว ๆ (คนที่เข้างานทันเคาน์เตอร์เปิด) — ยังไม่ได้ตรวจระบบ/งานชนแบบตัวจัดอัตโนมัติ

## 5) 📋 คัดลอกแผนรายทีม (แทน "ส่งออก Assignment")
```powerapps
Copy("📅 แผนล่วงหน้า " & varAdvDay & " — ทีม " & ddAdvTeam.Selected.Value &
    Concat(SortByColumns(Filter(colAdv, ddAdvTeam.Selected.Value = "ALL" || ddAdvTeam.Selected.Value in team), "seq", SortOrder.Ascending) As f,
        Char(10) & Char(10) & f.flight & "  " & Coalesce(f.sta, "–") & "/" & Coalesce(f.std, "–") & "  CI " & f.counter &
        If(f.req_sup > 0, Char(10) & "• SUP: " & Coalesce(Concat(f.sup As p, p.name, ", "), "—")) &
        If(f.req_fc > 0,  Char(10) & "• FC: "  & Coalesce(Concat(f.fc  As p, p.name, ", "), "—")) &
        If(f.req_ci > 0,  Char(10) & "• Check-in: " & Coalesce(Concat(f.ci As p, p.name, ", "), "—")) &
        If(f.req_arr > 0, Char(10) & "• Arrival: " & Coalesce(Concat(f.arr As p, p.name, ", "), "—")) &
        If(f.req_stb > 0, Char(10) & "• Standby: " & Coalesce(Concat(f.stb As p, p.name, ", "), "—")) &
        If(f.req_gm > 0,  Char(10) & "• Gate Monitor: " & Coalesce(Concat(f.gm As p, p.name, ", "), "—")) &
        If(f.req_ga > 0,  Char(10) & "• Gate Agent: " & Coalesce(Concat(f.ga As p, p.name, ", "), "—"))))
```

## 6) วางแผนหลายวัน (แทน "วางแผนสัปดาห์")
`galAdvWeek.Items`:
```powerapps
ForAll(Sequence(7, 0) As i,
    With({k: Text(DateAdd(dpAdv.SelectedDate, i.Value, TimeUnit.Days), "yyyy-mm-dd")},
        With({s: LookUp(PAS_AdvPlan, day_key = k && kind.Value = "SUM")},
            {k: k, found: !IsBlank(s), flights: s.n_flights, people: s.n_people, asg: s.n_assigned, short: s.n_short})))
```
แสดงต่อวัน: `k` · ไฟลท์ · คนขึ้นเวร · จัดแล้ว · ไฟลท์ขาด (แดงถ้า > 0) · กดแถว → `Set(dpAdv.SelectedDate…)` ใช้ `Reset` + `varAdvDay` แล้ว `Select(btnLoadAdv)`

## ตรวจกับ PAS เดิม (ก่อน Google ปิด)
เลือกวันพรุ่งนี้ทั้งสองระบบ → เทียบ "ไฟลท์ / คนขึ้นเวร / จัดแล้ว" และ 3 ไฟลท์แรก
- คนขึ้นเวรต่างกัน → ไฟล์ ROSTER ที่ย้ายมาเป็นคนละเวอร์ชันกับ Google Sheet หรือ `PAS_Employees` สถานะไม่ตรง
- ไฟลท์ต่างกัน → `PAS_Flights` ยังไม่ sync วันนั้น (Flow F อ่านล่วงหน้าแค่ 14 วัน)
