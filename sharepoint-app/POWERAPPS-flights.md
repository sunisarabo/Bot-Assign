# หน้า ✈ Flights & SLA (Power Apps) — แทนหน้าเดิมของ PAS

คำนวณ **ตอนนำเข้าไฟล์เวร** (`import-roster.ts` → `computeSla` พอร์ตจาก `SLA.gs` `slaCollectFlights_`) เก็บใน `PAS_FlightSLA` 1 แถว/ไฟลท์/วัน
> **ตรวจแล้วว่าตรงของเดิม:** `test/sla-parity.test.js` รัน `SLA.gs` ตัวจริงกับตัวใหม่บนชุดข้อมูลเดียวกัน → ตรงกันทุกไฟลท์ (ต้องการ / มีจริง / ขาด / ครบ)

## กติกา (เหมือนเดิม)
| | |
|---|---|
| ไฟลท์ | รวมจากงานของทุกคนที่มาทำงาน (ไม่นับทีม Porter / Crewsign / Admin Doc) · ไฟลท์เดียวกัน = สาย + เลขไฟลท์ชุดแรก (EY410/411 = EY410) |
| ต้องการ | ตามสาย + **ชนิดเครื่อง** (SLA_AC เช่น TR A320 = 8, B787 = 10) → ไม่มี → **`PAS_SLARules`** (แก้ได้ แทนชีต STANDARD MANNING) → ค่าตั้งต้น SLA_RQ |
| ชนิดเครื่อง/เวลา | ช่องในแท็บเวรก่อน → ว่าง → เติมจาก **ตารางบิน** (`PAS_Flights` ของวันนั้น) |
| ขา | มีแต่ STA = ขาเข้า (ไม่ต้องการ Check-in/Gate) · มีแต่ STD = ขาออก (ไม่ต้องการ Arrival) · STA=STD = RON · ไม่มีทั้งคู่ = "ไม่มีเวลา" (เตือนให้เติม) |
| มีจริง | นับเฟสจากรหัสงาน: SUP/FC · Check-in (CT/C1/Y/J/KIOSK/PRIO…) · Gate (G/GA/GM/BOARD/PFD…) · Arrival (ARR/MEET/CIQ…) · 1 คนหลายเฟสได้ · TRAINING ไม่นับ |
| เครดิต | หัวหน้า (PSS) ที่ทำงานคาบช่วงไฟลท์ = มี SUP · คนนั่ง COUNTER/CT รวมของทีมเจ้าของ = เครดิต Check-in |
| เกลี่ย | Gate ↔ Arrival ใช้คนเกินแทนกันได้ · คนรวมครบ → Check-in/Gate/Arrival ที่ขาดถือว่าจัดสรรได้ (SUP ต้องมีจริง) |
| AK เลข 4 หลัก | ferry → ต้องการ SUP อย่างเดียว |

**เพิ่มจากเดิม**
- ไฟลท์ที่อยู่ใน **ตารางบิน** แต่ **ยังไม่มีใครถูกจัด** (และสายนั้นทีมเราทำวันนี้) → แสดงเป็น "ยังไม่จัดคน" ขาดทั้งไฟลท์
- ไฟลท์ที่ตารางบินระบุ **ยกเลิก** → ป้าย "ยกเลิก (ตารางบิน)" (ยังคิด SLA ตามเดิม เพื่อกันตารางกำกวม — เหมือนเดิม)

**ยังไม่มี (เทียบเดิม):** เพดานเคาน์เตอร์ที่ท่าจัดให้ (ไฟล์ counter ของท่า) · แยก Gate Dom/Int ของ PG — แจ้งได้ถ้าต้องใช้
**ข้อควรรู้:** SLA คำนวณตอนนำเข้า**ไฟล์เวร** — ถ้าตารางบินเปลี่ยนทีหลัง (A/C TYPE) ให้แก้ไฟล์เวรวันนั้น 1 ครั้ง หรือใน `PAS_ImportLog` ตั้งแถวของไฟล์นั้นเป็น `Pending` → คำนวณใหม่

## เปิดใช้
1. รัน `provision-lists.js` ล่าสุด → ได้ `PAS_FlightSLA` + `PAS_SLARules` (78 สายการบิน ค่าตั้งต้นจาก SLA.gs)
2. วาง `import-roster.ts` ใหม่ · แก้ Flow B ตาม `FLOW-import.md` (ข้อ 1c, 1d, ขั้น 0 GetDate, ลบ 6 รอบ)
3. Power Apps: Add data → `PAS_FlightSLA`, `PAS_SLARules`

---

## 1) โหลด — เพิ่มต่อท้าย `btnLoad.OnSelect`
```powerapps
ClearCollect(colSla, Filter(PAS_FlightSLA, day_key = varDay && !(no_time && fragment)));
Set(varSlaShort, Filter(colSla, !ok && !no_time));
```

## 2) หัวหน้า
`"✈️ ไฟลท์บินประจำวัน + เช็ค SLA · " & CountRows(colSla) & " ไฟลท์ · ✅ ครบ " & CountRows(Filter(colSla, ok && !no_time)) & " · 🔴 ขาด " & CountRows(varSlaShort) & If(CountRows(Filter(colSla, no_time)) > 0, " · ⚪ ไม่มีเวลา " & CountRows(Filter(colSla, no_time)), "")`

ตัวกรอง:
- `ddSlaStatus.Items = ["ทั้งหมด", "ขาด", "ครบ", "ไม่มีเวลา", "ยังไม่จัดคน"]`
- `ddSlaTeam.Items = Table({Value: "ALL"}, Sort(Distinct(colSla, team_list), Value))`
- `txtSlaFind` (ค้นเลขไฟลท์)

## 3) การ์ดไฟลท์ — Gallery `galSla` (Flexible height · 2–3 คอลัมน์บนจอกว้าง)
```powerapps
SortByColumns(
    Filter(colSla,
        Switch(ddSlaStatus.Selected.Value,
            "ขาด", !ok && !no_time, "ครบ", ok && !no_time, "ไม่มีเวลา", no_time, "ยังไม่จัดคน", unassigned, true)
        && (ddSlaTeam.Selected.Value = "ALL" || team_list = ddSlaTeam.Selected.Value)
        && (IsBlank(txtSlaFind.Text) || Upper(txtSlaFind.Text) in Upper(flight))),
    "std_min", SortOrder.Ascending, "sta_min", SortOrder.Ascending)
```
แต่ละการ์ด:
| ส่วน | สูตร |
|---|---|
| หัว | `ThisItem.flight & "  ·  " & ThisItem.team_list` |
| เวลา/เครื่อง | `"STA " & Coalesce(ThisItem.sta, "–") & " · STD " & Coalesce(ThisItem.std, "–") & If(!IsBlank(ThisItem.ac), " · " & ThisItem.ac, "")` |
| ป้ายสถานะ | `If(ThisItem.no_time, "⚪ ไม่มีเวลา — เติม STA/STD", ThisItem.unassigned, "🔴 ยังไม่จัดคน", ThisItem.ok, "✅ ครบ SLA", "🔴 " & ThisItem.short_text)` |
| สีป้าย | `If(ThisItem.ok && !ThisItem.no_time, ColorValue("#2E7D32"), ThisItem.no_time, Color.Gray, Color.Red)` |
| ป้ายเสริม | `If(ThisItem.ferry, "Ferry ", "") & If(ThisItem.sched_cancelled, "ยกเลิก (ตารางบิน) ", "") & If(!IsBlank(ThisItem.redist), "เกลี่ยคน: " & ThisItem.redist, "")` |
| แถบ 4 เฟส | Gallery แนวนอนซ้อน (ด้านล่าง) |
| รายชื่อ | Label (ย่อ/ขยายด้วยปุ่ม) `ThisItem.staff_text` |

แถบเฟส — Gallery แนวนอนในการ์ด:
```powerapps
Table(
    {ph: "SUP",      have: ThisItem.as_sup,  need: ThisItem.req_sup},
    {ph: "Check-in", have: ThisItem.as_ci,   need: ThisItem.req_ci},
    {ph: "Gate",     have: ThisItem.as_gate, need: ThisItem.req_gate},
    {ph: "Arrival",  have: ThisItem.as_arr,  need: ThisItem.req_arr},
    {ph: "รวม",      have: ThisItem.as_total, need: ThisItem.req_total})
```
ช่องละ: Label `ThisItem.ph` · Label `ThisItem.have & "/" & ThisItem.need` · สีพื้น `If(ThisItem.need = 0, ColorValue("#F1F3F6"), ThisItem.have >= ThisItem.need, ColorValue("#E8F5E9"), ColorValue("#FDECEC"))`
(ช่อง `need = 0` = ไม่ต้องการเฟสนั้น เช่น ขาเข้าอย่างเดียวไม่ต้องการ Check-in)

## 4) Dashboard — การ์ด 🚨 ไฟลท์ต้องเสริมด่วน (แทนกรอบรอใน `POWERAPPS-dashboard.md` ข้อ 3)
```powerapps
// Items (เรียงตามเวลา STD/STA ก่อน — เหมือนเดิม)
SortByColumns(varSlaShort, "std_min", SortOrder.Ascending, "sta_min", SortOrder.Ascending)
```
แถว: `ThisItem.flight` · `Coalesce(ThisItem.std, ThisItem.sta)` · `ThisItem.team_list` · `ThisItem.short_text`
หัวการ์ด: `"🚨 ไฟลท์ต้องเสริมด่วน " & CountRows(varSlaShort)` · ว่าง → `"✅ ทุกไฟลท์ครบ SLA"`
**Hero → ไฟลท์ขาดคน:** แทน `"—"` ด้วย `CountRows(varSlaShort)` · ใต้: `"จาก " & CountRows(Filter(colSla, !no_time)) & " ไฟลท์ · ต่ำกว่า SLA"` · สีตัวเลข `If(CountRows(varSlaShort) > 0, ColorValue("#ffd0cb"), ColorValue("#bff0da"))`

## 5) แก้กฎกำลังคน (แทนชีต STANDARD MANNING)
เปิด List **`PAS_SLARules`** → แก้ `ci` / `arr` / `gate` / `total` ของสายที่ต้องการ · เพิ่มสายใหม่ = New item (Title = รหัส IATA 2 ตัว)
→ มีผลกับไฟล์เวรที่นำเข้า **หลังจากนั้น** (วันที่นำเข้าไปแล้ว → ตั้ง `PAS_ImportLog` เป็น Pending หรือกด Flow C)
> ลำดับใช้กฎ: ชนิดเครื่อง (ในโค้ด) → `PAS_SLARules` → ค่าตั้งต้น · ถ้าอยากให้ `PAS_SLARules` ชนะชนิดเครื่องด้วย แจ้งได้

## ตรวจกับ PAS เดิม
เลือกวันเดียวกัน → เทียบ "N ไฟลท์ · ครบ M" บนหัว + ไฟลท์ขาด 5 ไฟลท์แรก
- ต่างที่ **ต้องการ** → A/C TYPE ไม่ตรง (ตรวจตารางบิน/ช่องในแท็บ) หรือกฎใน `PAS_SLARules`
- ต่างที่ **มีจริง** → รหัสงานที่จัดเฟสต่างกัน (ส่งตัวอย่างรหัสงานมา) หรือคอลัมน์ไฟลท์ในแท็บทีมนั้นไม่ได้อยู่ตำแหน่งมาตรฐาน (T เป็นต้นไป ทีละ 4 คอลัมน์)
