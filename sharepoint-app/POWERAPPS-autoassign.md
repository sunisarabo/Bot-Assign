# หน้า 🤖 Auto Assign (Power Apps) — แทนหน้าเดิมของ PAS

ข้อเสนอจัดคน **แบบอ่านอย่างเดียว** (ไม่แก้ไฟล์เวรต้นฉบับ) มี 2 โหมดเหมือนเดิม:

| โหมด | ทำอะไร |
|---|---|
| **A) เติมจาก Assign เดิม** | ใช้ตารางจริงเป็นฐาน → ไฟลท์ที่ขาด SLA ดึง **คนว่างข้ามทีม** มาเสริม · คนที่จัดแล้วถูกล็อกเวลา จึงไม่ถูกดึงซ้ำ |
| **B) จัดเวรใหม่ทั้งหมด** | ล้าง assign เดิม แล้วจัดคนที่มาทำงานวันนั้นทั้งพูลลงทุกไฟลท์ให้ครบ SLA · แสดง **คนพัก/สำรอง** ที่ยังไม่ถูกจัด |

ระบบคำนวณ **ตอนนำเข้าไฟล์เวร** (`import-roster.ts` → `autoPlanRows` พอร์ตจาก `AutoPlan.gs` `apFillGaps_` / `apReplan_`) แล้วเก็บใน `PAS_AutoPlan`
> **ตรวจแล้วว่าตรงกับของเดิม:** `test/autoplan-parity.test.js` รัน `AutoPlan.gs` ตัวจริงคู่กับตัวใหม่บนข้อมูลชุดเดียวกัน
> → โหมด A **ตรง 32/32 แถว** · โหมด B **ตรง 12/12 ไฟลท์** (ชื่อคนทุกเฟสและลำดับ) · คนพักตรงกัน

## กติกา (เหมือนเดิม)
| | |
|---|---|
| ลำดับจัด | ไล่ไฟลท์ตามเวลา STD/STA → ในแต่ละไฟลท์จัด **SUP → Check-in → Arrival → Gate** |
| สายรับคนข้ามทีมไหม | ตาม Data Airlines Check (QR/EK/KE/TK … ไม่รับ → ใช้คนทีมตัวเองเท่านั้น) |
| รู้ระบบ | SUP/Check-in ต้องเคยทำเช็คอินระบบเดียวกันวันนี้ · iPort ใครก็ได้ · ทีม CHARTER/ZF = พูล ASTRA |
| SUP | ต้องเป็น **Sup (PSS)** เท่านั้น · คุมหลายไฟลท์พร้อมกันได้ (ไม่ล็อกเวลา) |
| ว่างจริง | เวลางานครอบช่วงเฟส (±30 นาที) · ไม่ชนงานอื่น + เผื่อเดินทาง 55 นาที (ทำ 2 ไฟลท์ติดแล้ว → พัก 60 นาที) |
| เลือกคน (คะแนนต่ำสุด) | ตำแหน่งเหมาะกับเฟส (Check-in/Gate/Arrival: Agent → Senior → Sup) · โหมด B: **คนทีมเจ้าของสายได้ก่อน** · **กระจายงาน** (มีงานแล้วคะแนนเพิ่ม) |
| Gate (โหมด B) | คนเช็คอินเดินต่อไปยืนเกท (ไม่ใช้คนใหม่) · สายที่ไม่มีเช็คอิน (PG) → ส่วนเกินของ TTL ลง Gate |
| ไม่ใช่คนจัด | Porter / Crewsign / Admin Doc · คนอบรม · ลา/ป่วย |
| โหมด A ไฟลท์ไม่มีเวลา | ไม่เสนอคนข้ามทีม (เช็คความว่างไม่ได้) |

**ส่วนที่ยังไม่ได้ทำ (เทียบกับของเดิม):**
- แผง "➕ เพิ่มคนพิเศษ" (ขอคนเกิน SLA รายไฟลท์) — ตอนนี้ใช้หน้า 🆘 Support ดูรายชื่อคนว่างแทน
- คลิกชื่อเพื่อแก้ในหน้าเว็บ — ทำได้โดยคัดลอกข้อความ (ข้อ 5) แล้วแก้ก่อนส่ง
- ส่งออกเป็นไฟล์ชีตรายทีม — ใช้ปุ่มคัดลอกข้อความรายทีมแทน
- Common check-in / เลือก Flight Controller — ของเดิมปิดไว้ (`AP_COMMON_CI = []`) จึงไม่ได้พอร์ต

## เปิดใช้
1. รัน `provision-lists.js` ล่าสุด (สร้าง `PAS_AutoPlan`)
2. วาง `import-roster.ts` ใหม่ · Flow B ขั้นลบของวันเดิมเป็น **8 รอบ** (เพิ่ม `PAS_AutoPlan`) ตาม `FLOW-import.md`
3. ต้องมี `posg` (ข้อ 1d ของ Flow B — ทำไว้แล้วตอน Support) ไม่งั้นจัด SUP ไม่ได้ เพราะไม่รู้ว่าใครเป็น Sup
4. Power Apps: Add data → `PAS_AutoPlan`
5. ย้อนหลัง: กด Flow C ที่โฟลเดอร์ปี

---

## 1) ปุ่มเมนู + โหลด
ปุ่มเมนู: `Set(varTab, "auto"); Select(btnLoadAp)` · container `Visible = varTab = "auto"` · ต่อท้าย `dpDay.OnChange`: `If(varTab = "auto", Select(btnLoadAp))`

**`btnLoadAp.OnSelect`**
```powerapps
// คน 1 คน = [ชื่อ, ตำแหน่ง, ทีม, กะ, OT, ชม.รวม, งานเดิม, ไฟลท์เดิม]
ClearCollect(colApFill,
    AddColumns(Filter(PAS_AutoPlan, day_key = varDay && kind.Value = "FILL"),
        ppl, ForAll(Table(ParseJSON(people_json)) As c,
            { name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3)),
              shift: Text(Index(c.Value, 4)), ot: Text(Index(c.Value, 5)), n: Value(Index(c.Value, 7)), flts: Text(Index(c.Value, 8)) })));
ClearCollect(colApAuto,
    AddColumns(Filter(PAS_AutoPlan, day_key = varDay && kind.Value = "AUTO"),
        sup,  ForAll(Table(ParseJSON(sup_json))  As c, { name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3)), shift: Text(Index(c.Value, 4)) }),
        ci,   ForAll(Table(ParseJSON(ci_json))   As c, { name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3)), shift: Text(Index(c.Value, 4)) }),
        gate, ForAll(Table(ParseJSON(gate_json)) As c, { name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3)), shift: Text(Index(c.Value, 4)) }),
        arr,  ForAll(Table(ParseJSON(arr_json))  As c, { name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3)), shift: Text(Index(c.Value, 4)) })));
ClearCollect(colApBench, Filter(PAS_AutoPlan, day_key = varDay && kind.Value = "BENCH"));
Set(varApSum, LookUp(PAS_AutoPlan, day_key = varDay && kind.Value = "SUM"));
If(IsBlank(varApMode), Set(varApMode, "B"))
```
> `kind` เป็น Choice → เทียบกับ `kind.Value` (delegable บน SharePoint) · ไฟล์เวรเก่าที่นำเข้าก่อนอัปเดตจะยังไม่มีข้อมูล → กด Flow C ซ้ำ

ปุ่มสลับโหมด (2 ปุ่มติดกัน): `Set(varApMode, "A")` "🩹 เติมจาก Assign เดิม" · `Set(varApMode, "B")` "🤖 จัดใหม่ทั้งหมด"
สีปุ่มที่เลือก: `If(varApMode = "A", ColorValue("#1f4e79"), Color.White)` (อีกปุ่มใช้ `"B"`)

## 2) โหมด B — จัดเวรใหม่ทั้งหมด
**หัว** (พื้น `#eef6ff` เส้นซ้าย `#1f4e79`):
```powerapps
"📋 Auto Assign — จัดเวรใหม่ทั้งหมดตาม SLA · จัดคน " & varApSum.tot_asg & "/" & varApSum.tot_req &
" ลง " & CountRows(colApAuto) & " ไฟลท์ · พัก " & CountRows(colApBench) & " คน" &
With({s: CountRows(Filter(colApAuto, !ok))}, If(s > 0, " · ⚠️ " & s & " ไฟลท์ยังขาด", " · ครบ ✅"))
```
ตัวกรองทีม `ddApTeam.Items = Table({Value: "ALL"}, Sort(Distinct(colApAuto, team), Value))` · สวิตช์ `tglApShort` "เฉพาะไฟลท์ที่ยังขาด"

Gallery `galApAuto` (Flexible height) · `Items`:
```powerapps
SortByColumns(Filter(colApAuto,
    (ddApTeam.Selected.Value = "ALL" || team = ddApTeam.Selected.Value) && (!tglApShort.Value || !ok)), "seq", SortOrder.Ascending)
```
| ช่อง | Text |
|---|---|
| Flight | `ThisItem.flight` (ตัวหนา) · บรรทัดรอง `ThisItem.airline & " · " & Coalesce(ThisItem.system, "iPort") & " · ทีม " & ThisItem.team` |
| STA / STD | `Coalesce(ThisItem.sta, "–") & " / " & Coalesce(ThisItem.std, "–")` |
| SUP | ดูสูตรช่องเฟสด้านล่าง (ใช้ `sup` · `req_sup` · `short_sup`) |
| Check-in | `ci` · `req_ci` · `short_ci` |
| Gate | `gate` · `req_gate` · `short_gate` |
| Arrival | `arr` · `req_arr` · `short_arr` |

**ช่องเฟส** (ตัวอย่าง SUP — เปลี่ยนชื่อคอลัมน์ให้ตรงเฟส):
```powerapps
If(ThisItem.req_sup = 0, "— ไม่มี",
    CountRows(ThisItem.sup) & "/" & ThisItem.req_sup & If(ThisItem.short_sup > 0, "  ⚠️ขาด " & ThisItem.short_sup, "  ✓") & Char(10) &
    Concat(ThisItem.sup, name & " (" & pos & If(team <> ThisItem.team, " ←" & team, "") & ")", Char(10)))
```
> `←ทีม` = คนข้ามทีม · พื้นแถว `If(ThisItem.ok, Color.White, ColorValue("#fff3cd"))`

**😴 คนพัก/สำรอง (ยังไม่ถูกจัด)** — Gallery `galApBench` · `Items = GroupBy(SortByColumns(colApBench, "team", SortOrder.Ascending), team, ppl)`
Text: `ThisItem.team & " " & CountRows(ThisItem.ppl) & ": " & Concat(ThisItem.ppl, person & " (" & pos & ")", ", ")`
> Power Apps รุ่นเก่า: `GroupBy(…, "team", "ppl")`

## 3) โหมด A — เติมจาก Assign เดิม
**หัว:**
```powerapps
"📋 เติมจาก Assign เดิม — คนว่างข้ามทีมมาเสริมไฟลท์ที่ขาด · เสริม " & Sum(colApFill, need_n - remain) & " คน" &
With({r: Sum(Filter(colApFill, IsBlank(block)), remain)}, If(r > 0, " · ยังขาด " & r & " คน", " · ครบ ✅"))
```
สวิตช์ `tglApBlocked` "แสดงเฟสที่สายไม่รับซัพ" (ค่าเริ่มต้นปิด)

Gallery `galApFill` · `Items = SortByColumns(Filter(colApFill, tglApBlocked.Value || IsBlank(block)), "seq", SortOrder.Ascending)`
| ช่อง | Text |
|---|---|
| Flight · สาย · STD | `ThisItem.flight` · `ThisItem.airline` · `ThisItem.std` |
| ตำแหน่งที่ขาด | `ThisItem.phase & " ขาด " & ThisItem.need_n` (แดง) |
| ช่วงเวลา | `ThisItem.win` |
| ระบบ | `Coalesce(ThisItem.need_sys, "iPort/ใดก็ได้")` |
| คนที่จัดให้ | `If(!IsBlank(ThisItem.block), "🚫 " & ThisItem.block, IsEmpty(ThisItem.ppl), If(!IsBlank(ThisItem.need_sys), "ไม่มีคนว่างที่รู้ระบบ " & ThisItem.need_sys, "ไม่มีคนว่าง"), Concat(ThisItem.ppl, "[" & team & "] " & name & " (" & pos & " · กะ " & shift & If(ot <> "-", " · OT " & ot, "") & ")", Char(10)))` |
| สถานะ | `If(!IsBlank(ThisItem.block), "🚫 ใช้คนทีมตัวเอง", ThisItem.remain = 0, "✅ เติมครบ", ThisItem.need_n > ThisItem.remain, "⚠️ ยังขาด " & ThisItem.remain, "🔴 ขาด " & ThisItem.remain)` |
พื้นแถว: `If(ThisItem.remain = 0, ColorValue("#f1f8e9"), ThisItem.need_n > ThisItem.remain, ColorValue("#fff8e1"), ColorValue("#fdecec"))`
ว่าง: `"✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA แล้ว — ไม่ต้องเสริม"` · `Visible = IsEmpty(colApFill)`

## 4) ดูงานเดิมของคน (แทน ⓘ ของเดิม)
ในโหมด A กดแถว → `Set(varApPick, ThisItem)` แล้วแสดงแผงขวา:
`Concat(varApPick.ppl, name & " — กะ " & shift & " · OT " & ot & " · งานเดิม " & n & If(!IsBlank(flts), ": " & flts, ""), Char(10))`

## 5) 📋 คัดลอกข้อความแจ้งรายทีม (แทน "ส่งออกชีตรายทีม")
เลือกทีมใน `ddApTeam` แล้วกดปุ่ม (ตัวอย่างโหมด B):
```powerapps
Copy(
    "🤖 Auto Assign " & varDay & If(ddApTeam.Selected.Value <> "ALL", " — ทีม " & ddApTeam.Selected.Value, "") &
    Concat(SortByColumns(Filter(colApAuto, ddApTeam.Selected.Value = "ALL" || team = ddApTeam.Selected.Value), "seq", SortOrder.Ascending) As f,
        Char(10) & Char(10) & f.flight & "  " & Coalesce(f.sta, "–") & "/" & Coalesce(f.std, "–") &
        If(f.req_sup > 0, Char(10) & "• SUP: "      & Coalesce(Concat(f.sup  As p, p.name & If(p.team <> f.team, " ←" & p.team, ""), ", "), "—")) &
        If(f.req_ci > 0,  Char(10) & "• Check-in: " & Coalesce(Concat(f.ci   As p, p.name & If(p.team <> f.team, " ←" & p.team, ""), ", "), "—")) &
        If(f.req_gate > 0, Char(10) & "• Gate: "    & Coalesce(Concat(f.gate As p, p.name & If(p.team <> f.team, " ←" & p.team, ""), ", "), "—")) &
        If(f.req_arr > 0, Char(10) & "• Arrival: "  & Coalesce(Concat(f.arr  As p, p.name & If(p.team <> f.team, " ←" & p.team, ""), ", "), "—")) &
        If(!f.ok, Char(10) & "⚠️ ยังขาด " &
            Concat(Filter(Table({k: "SUP", v: f.short_sup}, {k: "Check-in", v: f.short_ci}, {k: "Gate", v: f.short_gate}, {k: "Arrival", v: f.short_arr}), v > 0), k & " " & v, " · "), ""))))
```
โหมด A:
```powerapps
Copy("🩹 เติมคนเสริม " & varDay & Concat(Filter(colApFill, IsBlank(block) && !IsEmpty(ppl)) As g,
    Char(10) & "• " & g.flight & " " & g.phase & " (" & g.win & "): " & Concat(g.ppl As p, p.name & " ←" & p.team, ", ")))
```

## ตรวจกับ PAS เดิม
เลือกวันเดียวกัน → 🤖 Auto Assign → เทียบ "จัดคน x/y" · จำนวนไฟลท์ที่ยังขาด · ชื่อในไฟลท์แรก 3 ไฟลท์
- SUP ว่างแทบทุกไฟลท์ → ยังไม่ได้ส่ง `posg` (ไม่รู้ว่าใครเป็น Sup) ให้ตรวจ Flow B ข้อ 1d
- ชื่อต่างแต่จำนวนตรง → ส่วนใหญ่มาจาก **ตำแหน่ง** (PAS_Employees ไม่ตรงกับ MASTER เดิม) หรือ **เวลากะ/OT** ของคนนั้นในแท็บไม่อยู่คอลัมน์ E–F / K–P
- มีไฟลท์เกินมา → ไฟลท์ในตารางบินที่ยังไม่มีใครถูกจัด (หน้าใหม่นับรวมให้จัดคนด้วย ส่วน PAS เดิมไม่เห็นไฟลท์เหล่านี้)
