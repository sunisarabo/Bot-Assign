# หน้า 🆘 Support / เติมคน (Power Apps) — แทนหน้าเดิมของ PAS

2 แหล่งคำขอ → **ใครว่างและช่วยได้** เรียงตามความเหมาะสม
1. **📋 คำขอจากไฟล์เวร (RQ)** — แท็บ `SUPPORT REQUEST` (+ `Urgent Support`) ที่ทีมกรอกขอซัพ: แถวที่ดิวตี้ใส่ชื่อแล้ว = **จัดแล้ว** (โชว์ทางเลือกสำรอง 3 คน) · แถวที่ยังไม่มีชื่อ = **รอจัดคน** → ระบบเสนอคนให้
2. **ไฟลท์ที่ขาด SLA** — แต่ละเฟสที่ขาด (SUP / Check-in / Gate / Arrival)

คนที่ดิวตี้ใส่ชื่อส่งไปซัพแล้ว → ระบบ **ผูกงานซัพกลับที่ตัวคนนั้น** (ช่วงเวลาตามคำขอ) → ขึ้นใน Gantt/ตรวจ Assign · นับเป็นคนของไฟลท์นั้นใน SLA · **ไม่ถูกแนะนำซ้ำ** ช่วงเวลาเดียวกัน
คำนวณ **ตอนนำเข้าไฟล์เวร** (`import-roster.ts` → `supportRows` พอร์ตจาก `SLA.gs` `slaSupportRows_` / `slaCandidates_`) เก็บใน `PAS_Support` 1 แถว/ไฟลท์/เฟสที่ขาด
> **ตรวจกับไฟล์จริง 10OCT.xlsx:** รันตัวเดิม (`RosterReader.gs` + `WebDashboard.gs` + `SLA.gs`) คู่กับตัวใหม่ → อ่านคน **798/798 ตรงทุกคน** · ไฟลท์ SLA **88/88** · แถวไฟลท์ขาด **11/11** · **คำขอจากไฟล์ 54/54** (ชื่อคนแนะนำ + ลำดับ + พนักงานอื่นๆ) · ตรวจ Assign **510/510**
> ทดสอบถาวรใน repo: `test/reader-parity.test.js` (ไฟล์จำลองรูปแบบเดียวกัน)
>
> **ตรวจแล้วว่าตรงของเดิม:** `test/support-parity.test.js` รัน `SLA.gs` + `AirlineSupport.gs` ตัวจริงคู่กับตัวใหม่ → **ตรง 30/30 แถว** ทั้งรายชื่อคนช่วย **และลำดับ**, "พนักงานอื่นๆ", กฎสายการบิน, การจองคนไม่ให้แนะซ้ำ

## วิธีหาคนซัพพอร์ต (เหมือนระบบเดิม · เงื่อนไขแก้ได้ในระบบ)
ทุกขั้นคำนวณในตัวนำเข้า (`import-roster.ts`) จากข้อมูลไฟล์ assignment วันนั้น — ทั้งไฟลท์ที่ขาด SLA และ **คำขอ RQ** (แท็บ SUPPORT REQUEST / Urgent Support)

**ขั้นที่ 1 — ตั้งโจทย์**
| แหล่ง | ไฟลท์ · เฟส · ช่วงเวลา | จำนวน |
|---|---|---|
| ไฟลท์ขาด SLA | เฟสที่ขาด (SUP / Check-in / Gate / Arrival) · ช่วงตามเวลาไฟลท์ของสายนั้น (เช่น SQ เช็คอิน STD−240 ถึง STD−40) | จำนวนที่ขาด |
| คำขอ RQ | หน้าที่ → เฟส: SOD/SUP/FC = SUP · ARR/TF/CIQ = Arrival · CHECK/CI/CT/CS = Check-in · อื่น ๆ (GA/GM/G-I…) = Gate · เวลาที่ทีมเขียน (เวลาเดียว เช่น `2110` → กางเป็นช่วงตามเฟส) | 1 คน · ถ้า "จัดแล้ว" แสดงตัวสำรอง 3 คน |

**ขั้นที่ 2 — กฎรายสายการบิน** (List **`PAS_SupportRules`** — 1 แถวต่อสาย · ค่าตั้งต้น 84 สายจาก `AirlineSupport.gs`)
| คอลัมน์ | ผล |
|---|---|
| `support` = **ไม่รับ** | ไม่เสนอคนข้ามทีม แสดงเหตุผล "ไม่รับซัพพอร์ต (ใช้คนทีมตัวเอง)" (เช่น QR · EK · KE · TK) |
| `support` = **รับ** + `phases` | รับเฉพาะเฟสที่ระบุ เช่น `ARR,GATE` (ว่าง = ทุกเฟส) |
| `support` = ไม่กำหนด | รับทุกเฟส |
| `system` | ระบบเช็คอินของสาย (Altea / Gonow / ASTRA / TravelSky …) → คนช่วย **Check-in / SUP** ต้องรู้ระบบนี้ · **iPort ใครก็ช่วยได้** |
| `ci_in_team` | ✔ = เช็คอินต้องใช้คนทีมตัวเองเท่านั้น (ค่าตั้งต้น EY · QR · EK) |
> **คำขอ RQ ไม่ถูกบล็อกด้วย `support`** (ทีมขอมาเอง — เหมือนเดิม) แต่ยังต้องผ่านขั้น 3–5

**ขั้นที่ 3 — เงื่อนไขของพนักงานแต่ละทีม** (List **`PAS_TeamRules`** — 1 แถวต่อแท็บทีม · ค่าตั้งต้น 19 ทีม)
| คอลัมน์ | ผล |
|---|---|
| `role` = **ไม่ดึงมาซัพ** | ไม่เอาคนทีมนี้ไปช่วย (ค่าตั้งต้น PORTER · PORTER CREWSIGN · ADMIN DOC) |
| `role` = **ทีมพูล (ดึงก่อน)** | เมื่อคุณสมบัติเท่ากัน ดึงคนทีมนี้ก่อน (ค่าตั้งต้น CHARTER · PVTLP) |
| `role` = ปกติ | ทีมทั่วไป |
| `systems` | ระบบเช็คอินที่ทีมรู้ **เพิ่มเติม** (คั่นด้วย ,) — ปกติระบบรู้เองจากงานเช็คอินที่ทีมทำในวันนั้น · ค่าตั้งต้น CHARTER = ASTRA |
> ทีมที่ไม่มีใน List ใช้กติกาเดิม (ชื่อทีมมี PORTER/CREWSIGN/ADMIN DOC = ไม่ดึง · PVT/LP/STBY/CHARTER/ZF = พูล) — ทีมใหม่ให้เพิ่มแถว

**ขั้นที่ 4 — คัดคนที่ "ช่วยได้จริง"** (ตายตัวตามระบบเดิม)
| เงื่อนไข | |
|---|---|
| คนละทีมกับไฟลท์ | ทีมเจ้าของไฟลท์ไม่นับเป็นคนช่วย |
| มาทำงาน | กะปกติ หรือ OT OFF · ไม่ใช่ลา/ป่วย/หยุด/อบรม |
| ตำแหน่ง | เฟส SUP ต้องเป็น **Sup หรือ Snr** (ตำแหน่งจากไฟล์เวร / `PAS_Employees.pos_group`) |
| รู้ระบบ | Check-in / SUP: ทีมต้องรู้ระบบของสาย (ขั้น 2–3) |
| ว่างจริง | เวลากะ+OT ครอบช่วงเฟส (±30 นาที) · ไม่ติดงานอื่น + เผื่อเดินทาง **55 นาที** (ถ้าเพิ่งทำ 2 ไฟลท์ติดกัน → พัก **60 นาที**) · ไม่ถูกจองให้ไฟลท์อื่นที่เวลาทับ · คนที่ดิวตี้ส่งไปซัพแล้วนับว่าไม่ว่างช่วงนั้น |

**ขั้นที่ 5 — เรียงลำดับ** แล้วจองคนอันดับต้นตามจำนวนที่ขาด (ไฟลท์ถัดไปเวลาทับจะไม่แนะคนเดิมซ้ำ · ไล่ตาม STD)
คนกะปกติก่อน OT OFF → ชั่วโมงไม่เกิน (กะ ≤ 12 · ต่อเนื่อง ≤ 14 ชม.) → ASTRA เช็คอิน: CHARTER ก่อน → **เวลากะตรงช่วงงานที่สุด** → **งานวันนั้นน้อยที่สุด** → ตำแหน่ง (SUP: Sup ก่อน · เฟสอื่น Agent → Senior → Sup) → ทีมพูลก่อน
**"คนอื่นที่ว่าง"** = ว่างจริงแต่ไม่ผ่านเงื่อนไขระบบ/ตำแหน่ง (ให้หัวหน้าพิจารณาเอง)

| เพิ่มจากเดิม | อ่านแท็บ `Urgent Support` ด้วย · ไฟลท์เขียนแบบ `RON/PG408` → อ่านเป็น PG408 · เขียนขาเดียว (`G9715`) → จับคู่กับไฟลท์ในเวร (`G9714/715`) · กฎขั้น 2–3 แก้ใน SharePoint ได้เอง |
|---|---|

> ตรวจกับไฟล์จริง 10 ต.ค.: ใช้ค่าตั้งต้นใน List แล้วผล **เหมือนระบบเดิมทุกแถว** (SLA 11 · คำขอ 54) · ทดสอบอัตโนมัติ: แก้ทีมเป็น "ไม่ดึงมาซัพ" / สายเป็น "ไม่รับ" แล้วผลเปลี่ยนตาม (`test/pipeline-parity.test.js`)

### แก้เงื่อนไข
- ง่ายสุด: เปิด List ใน SharePoint → **Edit in grid view** แก้เหมือน Excel → มีผลกับไฟล์เวรที่นำเข้า**รอบถัดไป** (ไฟล์ที่นำเข้าแล้ว → Flow C นำเข้าซ้ำ)
- ในแอป (หน้า ⚙️ ตั้งค่า · เฉพาะ Admin): Gallery `Items = Sort(PAS_TeamRules, Title)` · Dropdown `Items = Choices(PAS_TeamRules.role)` · `OnChange = Patch(PAS_TeamRules, ThisItem, {role: Self.Selected})` · TextInput systems `OnChange = Patch(PAS_TeamRules, ThisItem, {systems: Self.Text})`
  และ Gallery `Items = Sort(PAS_SupportRules, Title)` · Dropdown support · TextInput phases/system · Toggle `ci_in_team` แบบเดียวกัน

**ยังไม่มี (เทียบเดิม):** ช่องเพิ่มคำขอเองในหน้าเว็บ (Duty) · ตรวจรายชื่อที่จะส่ง (วางข้อความ Duty) · แปลงข้อความไลน์เป็นชีต — ตอนนี้ให้กรอกในแท็บ SUPPORT REQUEST ของไฟล์เวร แล้วระบบนำเข้าให้เอง (~25 นาที)

## เปิดใช้
1. รัน `provision-lists.js` ล่าสุด (สร้าง/เพิ่มคอลัมน์ `PAS_Support`: `source`, `req_team`, `req_duty`, `req_time`, `assigned`, `from_team`, `req_status`, `open_n` … · `PAS_Duty`: `pos_group`)
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

## 1.5) 📋 คำขอซัพพอร์ตจากไฟล์ (แสดงก่อน — เหมือนเดิม)
`colSupReq = Filter(colSup, source.Value = "REQ")` (ใส่เป็น `Items` ได้เลย) · หัว:
```powerapps
"📋 คำขอซัพพอร์ตจากไฟล์ (SUPPORT REQUEST) — " & CountRows(Filter(colSup, source.Value = "REQ")) & " รายการ · ✅ จัดแล้ว " &
CountRows(Filter(colSup, source.Value = "REQ" && open_n = 0)) & " · ⏳ รอจัดคน " & CountRows(Filter(colSup, source.Value = "REQ" && open_n > 0))
```
Gallery `galSupReq` · `Items = SortByColumns(Filter(colSup, source.Value = "REQ" && (!tglReqOpen.Value || open_n > 0)), "std_min", SortOrder.Ascending)` · สวิตช์ `tglReqOpen` "เฉพาะที่รอจัดคน"
| ช่อง | Text |
|---|---|
| ทีมที่ขอ · ไฟลท์ | `ThisItem.req_team` (pill ฟ้า) · `ThisItem.flight` (ตัวหนา) |
| หน้าที่ · เวลา | `ThisItem.req_duty & " → " & ThisItem.phase.Value` · `Coalesce(ThisItem.req_time, ThisItem.win)` |
| ผู้ไปซัพ | `If(ThisItem.open_n = 0, "✅ " & ThisItem.assigned & If(!IsBlank(ThisItem.from_team), " (" & ThisItem.from_team & ")", ""), "⏳ รอจัดคน")` · สี `If(ThisItem.open_n = 0, T.ok, T.warn)` |
| แนะนำ (รอจัดคน) | `If(ThisItem.open_n > 0, If(IsBlank(ThisItem.picks), If(ThisItem.no_roster, "— ไม่พบไฟลท์ในเวร/ไม่มีเวลา (ใส่เวลาในคอลัมน์ เวลา/STBY)", "— ไม่มีคนว่างช่วงนี้"), "👉 " & Substitute(ThisItem.picks, Char(10), " · ")), "")` |
| ทางเลือกสำรอง (จัดแล้ว) | `If(ThisItem.open_n = 0, "สำรอง: " & Concat(FirstN(ThisItem.cands, 3), name & " (" & team & ")", ", "), "")` (ตัวเล็ก สีรอง) |
| Remark | `ThisItem.req_remark` (เช่น RE 07-17) |
กดแถว → กางรายชื่อเต็ม (ใช้ gallery ซ้อน `galSupCand` แบบข้อ 3)

> ในข้อ 3 (การ์ดไฟลท์ขาด SLA) ให้กรองเฉพาะ `source.Value = "SLA"` — `Items` เดิมเติม `&& source.Value = "SLA"`

## 2) หัว + ตัวกรอง
```powerapps
"🆘 Support / เติมคน · ไฟลท์ขาด " & CountRows(Distinct(Filter(colSup, source.Value = "SLA"), flight)) & " · ตำแหน่งที่ขาด " & Sum(colSup, short_n) & " คน" &
" · มีคนแนะนำ " & CountRows(Filter(colSup, n_cand > 0 && IsBlank(block))) & "/" & CountRows(colSup) & " แถว"
```
- `ddSupPhase.Items = ["ทั้งหมด", "SUP", "Check-in", "Gate", "Arrival"]`
- `tglSupBlocked` "แสดงแถวที่สายไม่รับซัพ" (ค่าเริ่มต้นปิด — ไม่มีอะไรให้ทำ)

## 3) การ์ดต่อแถว (ไฟลท์ × เฟส) — Gallery `galSup` (Flexible height)
```powerapps
SortByColumns(
    Filter(colSup,
        source.Value = "SLA" && (ddSupPhase.Selected.Value = "ทั้งหมด" || phase.Value = ddSupPhase.Selected.Value)
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
