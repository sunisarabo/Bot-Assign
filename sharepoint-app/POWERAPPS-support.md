# หน้า 🆘 Support / เติมคน (Power Apps) — แทนหน้าเดิมของ PAS

ไฟลท์ที่ขาด SLA → แต่ละเฟสที่ขาด (SUP / Check-in / Gate / Arrival) → **ใครว่างและช่วยได้** เรียงตามความเหมาะสม
คำนวณ **ตอนนำเข้าไฟล์เวร** (`import-roster.ts` → `supportRows` พอร์ตจาก `SLA.gs` `slaSupportRows_` / `slaCandidates_`) เก็บใน `PAS_Support` 1 แถว/ไฟลท์/เฟสที่ขาด
> **ตรวจแล้วว่าตรงของเดิม:** `test/support-parity.test.js` รัน `SLA.gs` + `AirlineSupport.gs` ตัวจริงคู่กับตัวใหม่ → **ตรง 30/30 แถว** ทั้งรายชื่อคนช่วย **และลำดับ**, "พนักงานอื่นๆ", กฎสายการบิน, การจองคนไม่ให้แนะซ้ำ

## กติกา (เหมือนเดิม)
| | |
|---|---|
| สายรับซัพไหม | ตาม Data Airlines Check (`AirlineSupport.gs`) เช่น QR/EK/KE/TK ไม่รับ · SQ/EY/AK… รับเฉพาะ Arrival/Gate → แสดงเหตุผลแทนรายชื่อ |
| เช็คอินทีมตัวเอง | EY / QR / EK ไม่เสนอคนข้ามทีมช่วยเช็คอิน |
| รู้ระบบ | SUP/Check-in ต้องเคยทำเช็คอินระบบเดียวกันวันนี้ (Altea / Gonow / ASTRA / TravelSky …) · **iPort ใครก็ช่วยได้** · ทีม CHARTER/ZF = พูล ASTRA |
| ตำแหน่ง | SUP ต้องเป็น Sup หรือ Snr (Sup ก่อน) · เฟสอื่น Agent → Senior → Sup |
| ว่างจริง | เวลางานครอบช่วงเฟส (±30 นาที) · ไม่ติดไฟลท์อื่น + เผื่อเดินทาง **55 นาที** (ทำ 2 ไฟลท์ติดแล้ว → พัก **60 นาที**) · ไม่ถูกจองไปไฟลท์อื่นที่เวลาทับ |
| ไม่ใช่คนช่วย | ทีมเดียวกับไฟลท์ · Porter / Crewsign / Admin Doc · คนอบรม · ลา/ป่วย |
| ลำดับ | คนกะปกติก่อนคนวันหยุด (OT OFF) → ชั่วโมงไม่เกิน (กะ ≤ 12 / ต่อเนื่อง ≤ 14 ชม.) → ASTRA เช็คอิน: CHARTER ก่อน → **เวลากะตรงไฟลท์สุด** → **งานน้อยสุด** → ตำแหน่ง → ทีมพูล (PVT/LP/STBY/CHARTER) |
| จองคน | คน top-N (N = จำนวนที่ขาด) ถูกจองให้ไฟลท์นั้น → ไฟลท์ถัดไปที่เวลาทับจะไม่แนะคนเดิมซ้ำ (ไล่ตามเวลา STD) |
| ไม่มีเวลาเฟส | ขาด OP/CL/STD → ประเมินช่วงจากเวลาไฟลท์ที่มี (ติดป้าย "ประเมินเวลา") |

**ยังไม่มี (เทียบเดิม):** ฟอร์ม "ขอซัพพอร์ต" ที่ทีมกรอกเอง (Support Request) · ตรวจรายชื่อที่จะส่ง (วางข้อความ Duty) — แจ้งได้ถ้าใช้ประจำ

## เปิดใช้
1. รัน `provision-lists.js` ล่าสุด (สร้าง `PAS_Support`)
2. วาง `import-roster.ts` ใหม่ · Flow B ตาม `FLOW-import.md`: ข้อ 1d (`PosRows` → พารามิเตอร์ `posg`) · ลบของวันเดิม **7 รอบ**
3. Power Apps: Add data → `PAS_Support`

---

## 1) โหลด — เพิ่มต่อท้าย `btnLoad.OnSelect`
```powerapps
ClearCollect(colSup,
    AddColumns(Filter(PAS_Support, day_key = varDay),
        cands, ForAll(Table(ParseJSON(cands_json)) As c,
            { name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3)),
              rest: Boolean(Index(c.Value, 5)), shift: Text(Index(c.Value, 6)), ot: Text(Index(c.Value, 7)),
              hrs: Value(Index(c.Value, 8)), hlevel: Text(Index(c.Value, 9)), htxt: Text(Index(c.Value, 10)),
              n: Value(Index(c.Value, 11)), flts: Text(Index(c.Value, 12)) }),
        others, ForAll(Table(ParseJSON(others_json)) As c,
            { name: Text(Index(c.Value, 1)), pos: Text(Index(c.Value, 2)), team: Text(Index(c.Value, 3)),
              shift: Text(Index(c.Value, 6)), n: Value(Index(c.Value, 11)) })))
```
> `cands_json` = อาร์เรย์ของ `[ชื่อ, ตำแหน่ง, ทีม, OFF, วันหยุด, กะ, OT, ชม.รวม, ระดับชม., ข้อความชม., จำนวนงาน, ไฟลท์ที่ทำ]` · ต้องเปิด **Settings → Updates → ParseJSON / Untyped objects** (เปิดอยู่แล้วในเวอร์ชันใหม่)

## 2) หัว + ตัวกรอง
```powerapps
"🆘 Support / เติมคน · ไฟลท์ขาด " & CountRows(Distinct(colSup, flight)) & " · ตำแหน่งที่ขาด " & Sum(colSup, short_n) & " คน" &
" · มีคนแนะนำ " & CountRows(Filter(colSup, n_cand > 0 && IsBlank(block))) & "/" & CountRows(colSup) & " แถว"
```
- `ddSupPhase.Items = ["ทั้งหมด", "SUP", "Check-in", "Gate", "Arrival"]`
- `tglSupBlocked` "แสดงแถวที่สายไม่รับซัพ" (ค่าเริ่มต้นปิด — ไม่มีอะไรให้ทำ)

## 3) การ์ดต่อแถว (ไฟลท์ × เฟส) — Gallery `galSup` (Flexible height)
```powerapps
SortByColumns(
    Filter(colSup,
        (ddSupPhase.Selected.Value = "ทั้งหมด" || phase.Value = ddSupPhase.Selected.Value)
        && (tglSupBlocked.Value || IsBlank(block))),
    "std_min", SortOrder.Ascending)
```
| ส่วน | สูตร |
|---|---|
| หัว | `ThisItem.flight & "  ·  " & ThisItem.phase.Value & " ขาด " & ThisItem.short_n & "  ·  STD " & ThisItem.std` |
| บรรทัดรอง | `"ทีม " & ThisItem.team & If(!IsBlank(ThisItem.system), " · ระบบ " & ThisItem.system, "") & If(!IsBlank(ThisItem.win), " · ช่วงต้องการ " & ThisItem.win, "") & If(ThisItem.win_fb, " (ประเมินเวลา)", "")` |
| ป้ายห้าม | `Visible = !IsBlank(ThisItem.block)` · `Text = "⛔ " & ThisItem.block` (สีเทา) |
| ไม่มีคน | `Visible = IsBlank(ThisItem.block) && ThisItem.n_cand = 0` · `Text = If(!IsBlank(ThisItem.need_sys), "— ไม่มีคนว่างที่รู้ระบบ " & ThisItem.need_sys, "— ไม่มีคนว่างช่วงนี้")` |
| แนะนำ (N คนแรก) | Label ตัวหนาสีเขียว: `"✅ เลือก: " & Substitute(ThisItem.picks, Char(10), " · ")` |

รายชื่อคนช่วย — Gallery ซ้อน `galSupCand` · `Items = ThisItem.cands` (แสดง 6 คนแรก + ปุ่ม "ดูทั้งหมด")
| ช่อง | Text |
|---|---|
| ลำดับ | `CountRows(Filter(...))` หรือใช้ `Sequence` — ง่ายสุด: `Text(ThisItem.n)` แทน "งาน" |
| ชื่อ | `ThisItem.name & "  (" & ThisItem.pos & " · " & ThisItem.team & ")"` · ตัวหนาถ้าอยู่ใน `picks` |
| กะ / OT | `ThisItem.shift & If(ThisItem.ot <> "-", " · OT " & ThisItem.ot, "")` |
| งานวันนี้ | `ThisItem.n & " งาน" & If(!IsBlank(ThisItem.flts), ": " & ThisItem.flts, "")` (ตัวเล็ก) |
| ป้าย | `If(ThisItem.rest, "วันหยุด", "") & If(ThisItem.hlevel in ["over", "high"], " ⚠️ " & ThisItem.htxt, "")` (สีส้ม) |
พื้นแถว: `If(ThisItem.name in Parent.Parent... picks, ColorValue("#E8F5E9"), Color.White)` → ง่ายกว่า: เทียบกับ `galSup.Selected.picks` หรือใส่ไอคอน ✅ เมื่อ `ThisItem.name & " / " & ThisItem.team in ThisItem.picks` ไม่ได้ (คนละ scope) — ใช้ `Find(ThisItem.name & " / ", <picks ของแถว>) > 0` โดยเก็บ picks ไว้ใน label ซ่อนของการ์ด (`lblPicks.Text`) แล้วใช้ `Find(ThisItem.name & " / ", lblPicks.Text) > 0`

"พนักงานอื่นๆ (ว่างแต่ไม่ตรงระบบ/ตำแหน่ง)" — ปุ่มกางดู · `Items = ThisItem.others` · แสดง `name (pos · team) · shift · n งาน`

## 4) ข้อความ SOS (คัดลอกส่งไลน์/Teams — เหมือนเดิม)
ปุ่ม `📋 คัดลอกข้อความขอ Support`:
```powerapps
Copy(
    If(IsEmpty(Filter(colSup, IsBlank(block))), "✅ ทุกไฟลท์ส่งคนครบตาม SLA — ไม่ต้องขอ Support",
    "🆘 ขอ Support — " & varDay &
    Concat(
        SortByColumns(AddColumns(GroupBy(Filter(colSup, IsBlank(block)), flight, std, system, rows), smin, Min(rows, std_min)), "smin", SortOrder.Ascending),
        Char(10) & Char(10) & flight & If(!IsBlank(std), "  STD " & std, "") & If(!IsBlank(system), "  · " & system, "") &
        Concat(rows, Char(10) & "• " & phase.Value & " ขาด " & short_n & If(!IsBlank(win), " (" & win & ")", "") &
            If(IsBlank(picks),
                Char(10) & "   — " & If(!IsBlank(need_sys), "ไม่มีคนว่างที่รู้ระบบ " & need_sys, "ไม่มีคนว่าง"),
                Concat(ForAll(Split(picks, Char(10)) As pk, pk.Value), Char(10) & "   • " & Value)), ""))))
```

## 5) Dashboard — ปุ่มจากการ์ด 🚨 ไฟลท์ต้องเสริมด่วน
ในการ์ด (`POWERAPPS-flights.md` ข้อ 4) เพิ่มปุ่ม "หาคนช่วย" → `Set(varTab, "sup")`
และใต้แต่ละไฟลท์ขาด แสดงคนแนะนำ: `Concat(Filter(colSup, flight = ThisItem.flight && IsBlank(block)), phase.Value & ": " & Substitute(picks, Char(10), ", "), " · ")`

## ตรวจกับ PAS เดิม
เลือกวันเดียวกัน → 🆘 Support → เทียบไฟลท์ 3 ไฟลท์แรก: เฟสที่ขาด · จำนวน · 3 ชื่อแรกที่แนะนำ
- ชื่อต่าง → ส่วนใหญ่มาจาก **ตำแหน่ง** (ต้องมี Flow D sync รายชื่อ + ส่ง `posg`) หรือ **เวลา OT** ของคนนั้นในแท็บไม่อยู่คอลัมน์ K–P
