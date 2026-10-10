# หน้า 🗓️ ไฟลท์สัปดาห์ (Power Apps) — แทนหน้าเดิมของ PAS

**แหล่งข้อมูล: ไฟล์ Assignment (เวรรายวัน)** — ไฟลท์ของแต่ละวัน = ไฟลท์ที่จัดคนไว้ในไฟล์เวรวันนั้น
(อ่านจาก `PAS_FlightSLA` ที่ `import-roster` คำนวณตอนนำเข้าไฟล์เวร · **ไม่นับ** ไฟลท์ที่มีแค่ในตารางบินแต่ยังไม่ได้จัดคน)
วันในอนาคตแสดงได้ทันทีที่ไฟล์เวรของวันนั้นถูกวางในโฟลเดอร์เดือน (Flow A/B นำเข้าเอง)

ตรงกับ `rbWeekFlightsHtml` + `wfWeekSummary_` (`WeeklyFlight.gs`):
| คอลัมน์ | กติกา (เหมือนเดิม) |
|---|---|
| วันที่ | จันทร์–อาทิตย์ ของวันที่เลือก · ไม่มีไฟล์เวร → "— ไม่มีไฟล์เวร —" |
| ไฟลท์ | จำนวนไฟลท์ (ไม่นับที่ยกเลิก) + "ยก n" ถ้าตารางบินระบุยกเลิก |
| SUP · Check-in · Gate · Arrival | ผลรวม **คนที่ต้องการตาม SLA** ต่อเฟส (ตามสาย/ชนิดเครื่อง · ตัดเฟสตามขาที่มีจริง · AK ferry = SUP) |
| คน~ | ผลรวม `SUP + max(Check-in, Gate) + Arrival` ต่อไฟลท์ (เกทใช้คนเช็คอินต่อ) — ใช้เทียบภาระแต่ละวัน |
| พีคออก | ชั่วโมงที่มีไฟลท์มากสุด (ตาม STD ถ้าไม่มีใช้ STA) เช่น `09:00·6` |
| **เพิ่ม:** จัดแล้ว / ขาด | คนที่จัดจริงรวม · จำนวนไฟลท์ที่ต่ำกว่า SLA (มาจากไฟล์เวรเดียวกัน) |

ด้านล่าง: **รายไฟลท์ต่อวัน** (กดวันเพื่อกาง) — Flight · สาย · STA/STD · เครื่อง (ไม่มี = `?` สีแดง) · SUP · CI · Gate · Arr · คน~ · ไฟลท์ยกเลิกขีดฆ่า

> ข้อมูลที่ต้องมี: `PAS_FlightSLA` (มาพร้อม Flights & SLA — ไม่ต้องตั้งค่าเพิ่ม)

---

## 1) ปุ่มเมนู + โหลด
ปุ่มเมนู: `Set(varTab, "wflt"); Select(btnLoadWf)` · container `Visible = varTab = "wflt"` · ต่อท้าย `dpDay.OnChange`: `If(varTab = "wflt", Select(btnLoadWf))`

**`btnLoadWf.OnSelect`**
```powerapps
With({d0: Date(Value(Left(varDay, 4)), Value(Mid(varDay, 6, 2)), Value(Right(varDay, 2)))},
    Set(varWfMon, DateAdd(d0, -(Weekday(d0, StartOfWeek.Monday) - 1), TimeUnit.Days)));

// ไฟลท์จากไฟล์เวรของ 7 วัน (≤ ~200 แถว/วัน) · ตัดเศษขา และไฟลท์ที่ยังไม่ได้จัดคน (มีแค่ในตารางบิน)
Clear(colWfRaw);
ForAll(Sequence(7, 0) As i,
    Collect(colWfRaw,
        AddColumns(
            Filter(PAS_FlightSLA, day_key = Text(DateAdd(varWfMon, i.Value, TimeUnit.Days), "yyyy-mm-dd") && !unassigned && !(no_time && fragment)),
            bodies, req_sup + Max(req_ci, req_gate) + req_arr,
            hr, Left(Coalesce(std, sta), 2))));

ClearCollect(colWf,
    ForAll(Sequence(7, 0) As i,
        With({dt: DateAdd(varWfMon, i.Value, TimeUnit.Days)},
            With({k: Text(dt, "yyyy-mm-dd"), rs: Filter(colWfRaw, day_key = Text(dt, "yyyy-mm-dd"))},
                With({live: Filter(rs, !sched_cancelled),
                      pk: First(Sort(AddColumns(GroupBy(Filter(rs, !sched_cancelled && !IsBlank(hr)), hr, g), n, CountRows(g)), n, SortOrder.Descending))},
                    { k: k, lbl: Text(dt, "dd") & Upper(Text(dt, "mmm", "en-US")) & " (" & Index(["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"], Weekday(dt, StartOfWeek.Monday)).Value & ")",
                      found: !IsEmpty(rs),
                      nFlt: CountRows(live), nCancel: CountRows(rs) - CountRows(live),
                      sup: Sum(live, req_sup), ci: Sum(live, req_ci), gate: Sum(live, req_gate), arr: Sum(live, req_arr),
                      bodies: Sum(live, bodies),
                      peak: If(IsBlank(pk), "-", pk.hr & ":00·" & pk.n),
                      have: Sum(live, as_total), nShort: CountRows(Filter(live, !ok && !no_time)) })))));
Set(varWfTot, {
    nFlt: Sum(colWf, nFlt), sup: Sum(colWf, sup), ci: Sum(colWf, ci), gate: Sum(colWf, gate), arr: Sum(colWf, arr),
    bodies: Sum(colWf, bodies), have: Sum(colWf, have), nShort: Sum(colWf, nShort) })
```
> Power Apps รุ่นเก่า: `GroupBy(…, "hr", "g")` และ `AddColumns(…, "n", …)` ใส่เครื่องหมายคำพูด

## 2) ตารางภาพรวมสัปดาห์ — Gallery `galWf` · `Items = colWf`
หัว: `"📆 ภาพรวมกำลังคนรายสัปดาห์ (ตาม SLA จากไฟล์ Assignment) · " & Text(varWfMon, "d mmm") & " – " & Text(DateAdd(varWfMon, 6, TimeUnit.Days), "d mmm")`
| ช่อง | Text |
|---|---|
| วันที่ | `ThisItem.lbl` (ตัวหนา) |
| ไฟลท์ | `If(!ThisItem.found, "— ไม่มีไฟล์เวร —", ThisItem.nFlt & If(ThisItem.nCancel > 0, "  ยก" & ThisItem.nCancel, ""))` |
| SUP · Check-in · Gate · Arrival | `If(ThisItem.found, Text(ThisItem.sup), "")` (เปลี่ยน `sup` → `ci` / `gate` / `arr`) |
| คน~ | `If(ThisItem.found, Text(ThisItem.bodies), "")` · พื้น `#eef6ff` ตัวหนา |
| พีคออก | `If(ThisItem.found, ThisItem.peak, "")` |
| จัดแล้ว | `If(ThisItem.found, Text(ThisItem.have), "")` |
| ขาด SLA | `If(ThisItem.found && ThisItem.nShort > 0, ThisItem.nShort & " ไฟลท์", If(ThisItem.found, "✅", ""))` · สี `If(ThisItem.nShort > 0, Color.Red, ColorValue("#2E7D32"))` |

แถวที่ไม่มีไฟล์: สีเทา `If(ThisItem.found, Color.Black, Color.Gray)` · ช่อง "ไฟลท์" ขยายกว้าง
**แถวรวมสัปดาห์** (เส้นบนหนา `#1f4e79`): `varWfTot.nFlt` · `varWfTot.sup` · `varWfTot.ci` · `varWfTot.gate` · `varWfTot.arr` · `varWfTot.bodies` (พื้น `#dceafe`) · — · `varWfTot.have` · `varWfTot.nShort`
หมายเหตุใต้ตาราง (ตัวเล็ก): `"คน~ = ผลรวมคน·ไฟลท์ (เกทใช้คนเช็คอินต่อ) ใช้เทียบภาระแต่ละวัน — คนจริงน้อยกว่านี้ (1 คนทำหลายไฟลท์) · พีคออก = ชั่วโมงที่มีไฟลท์มากสุด"`

## 3) รายไฟลท์ต่อวัน (กดวันเพื่อกาง)
- Gallery `galWfDay` · `Items = Filter(colWf, found)` · แต่ละแถวเป็นปุ่มหัว: `ThisItem.lbl & " — " & ThisItem.nFlt & " ไฟลท์ · คน~ " & ThisItem.bodies & If(ThisItem.nCancel > 0, " · ยกเลิก " & ThisItem.nCancel, "")`
  · `OnSelect = Set(varWfOpen, If(varWfOpen = ThisItem.k, "", ThisItem.k))`
- Gallery ซ้อน `galWfFlt` · `Visible = varWfOpen = ThisItem.k` · `Items = SortByColumns(Filter(colWfRaw, day_key = ThisItem.k), "std_min", SortOrder.Ascending, "sta_min", SortOrder.Ascending)`
  | ช่อง | Text |
  |---|---|
  | Flight | `ThisItem.flight` |
  | สาย | `ThisItem.airline` |
  | STA/STD | `Coalesce(ThisItem.sta, "–") & "/" & Coalesce(ThisItem.std, "–")` |
  | เครื่อง | `Coalesce(ThisItem.ac, "?")` · สี `If(IsBlank(ThisItem.ac), Color.Red, Color.Black)` |
  | SUP · CI · Gate · Arr | `req_sup` · `req_ci` · `req_gate` · `req_arr` |
  | คน~ | `ThisItem.bodies` (ตัวหนา) |
  | จัดแล้ว | `ThisItem.as_total & If(!ThisItem.ok && !ThisItem.no_time, "  🔴", "")` |
  ไฟลท์ยกเลิก: `FontStrikethrough = ThisItem.sched_cancelled` · สีจาง

## 4) ปุ่มเสริม
- ◀ สัปดาห์ก่อน / ▶ สัปดาห์ถัดไป: `Set(varDay, Text(DateAdd(varWfMon, -7, TimeUnit.Days), "yyyy-mm-dd")); Select(btnLoadWf)` (▶ ใช้ `+7`)
- กดชื่อไฟลท์ → ไปหน้า Flights & SLA วันนั้น: `Set(varDay, ThisItem.day_key); Select(btnLoad); Set(varTab, "flt")`

## ตรวจกับ PAS เดิม
เลือกสัปดาห์เดียวกัน → เทียบ "ไฟลท์" และ "คน~" รายวัน
- ต่างที่จำนวนไฟลท์ → PAS เดิมใช้ **ตารางบินก่อน** (ถ้ามีแท็บวันนั้น) แล้วค่อยใช้ไฟล์ Assignment · หน้าใหม่ใช้ **ไฟล์ Assignment อย่างเดียว** ตามที่กำหนด
  (ไฟลท์ที่อยู่ในตารางบินแต่ไม่ได้จัดคน ดูได้ที่หน้า Flights & SLA ตัวกรอง "ยังไม่จัดคน")
- ต่างที่ "คน~" ของไฟลท์เดียวกัน → A/C TYPE ไม่ตรง (เติมจากตารางบินอัตโนมัติ ถ้าแท็บเวรว่าง)

---

## 5) จัดหน้าให้สมดุล (แก้จากภาพหน้าจอจริง 10 ต.ค.)
อาการที่เห็น → สาเหตุ → วิธีแก้

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| มีแถบเลื่อนแนวนอนล่างสุด · เมนูซ้ายโดนตัด ("ol Tower") | หน้าจอกว้างกว่าหน้าต่าง | Settings → Display: **Scale to fit = Off · Lock aspect ratio = Off** · `App.MinScreenWidth = 1024` · ทุก Screen `Width = Max(App.Width, App.MinScreenWidth)` · `conApp.Width = Parent.Width` |
| ปุ่ม "สัปดาห์ของวันที่เลือก" ล้นขวา | หัวข้อ + 3 ปุ่มวางด้วย X ตายตัว | ใส่ใน **Horizontal container `conWfHead`** (Width = Parent.Width · Wrap On · Gap 8 · Align ตรงกลางแนวตั้ง) · Label หัวข้อ Flexible width On · ปุ่ม Width 120 ข้อความสั้น `"◀ ก่อน"` `"ถัดไป ▶"` `"📅 วันที่เลือก"` |
| ตารางสัปดาห์ไม่เต็มกว้าง ขวามีช่องว่าง · คอลัมน์ห่างไม่เท่ากัน | Gallery/Label กว้างเป็น px | `galWf.Width = Parent.Width` และวางคอลัมน์ตามสัดส่วนด้วย `WfCol` (ด้านล่าง) ทั้งแถวหัว แถวข้อมูล และแถวรวม |
| ตารางรายไฟลท์แคบกว่าตารางบน และสูงแค่ ~2 แถว | Gallery สูง/กว้างตายตัว | `galWfFlt` อยู่ใน Vertical container ของหน้า → **Flexible height On (Fill portions 1) · Minimum height 320** · Width = Parent.Width · ใช้ `WfFltCol` แบบเดียวกัน |
| แถวสูงเกิน หน้ายาว | TemplateSize ใหญ่ | `galWf.TemplateSize = 38` · `galWf.Height = 8 * 38 + 4` (7 วัน + เผื่อ) · ตัวหนังสือในแถว Size 11 · หัวคอลัมน์ Size 11 ตัวหนา · หัวข้อหน้า Size 16 |

**สัดส่วนคอลัมน์ — วางใน `App.Formulas` ครั้งเดียว**
```powerapps
// จุดเริ่มคอลัมน์ (0–1) · ตารางสัปดาห์ 10 ช่อง: วันที่ ไฟลท์ SUP CI Gate Arr คน~ พีคออก จัดแล้ว ขาดSLA
WfCol = [0, .14, .23, .31, .40, .48, .57, .66, .77, .86, 1];
// รายไฟลท์ 10 ช่อง: Flight สาย STA/STD เครื่อง SUP CI Gate Arr คน~ จัดแล้ว
WfFltCol = [0, .16, .23, .37, .47, .54, .61, .68, .75, .84, 1];
```
ทุก Label ในแถว (ตัวอย่างช่องที่ n — วันที่ n=1, ไฟลท์ n=2, …):
```powerapps
X     = Parent.TemplateWidth * Index(WfCol, n).Value + 8
Width = Parent.TemplateWidth * (Index(WfCol, n + 1).Value - Index(WfCol, n).Value) - 8
```
แถวหัวคอลัมน์ (อยู่นอก Gallery) ใช้ `galWf.Width` แทน `Parent.TemplateWidth` → หัวกับข้อมูลตรงกันทุกขนาดจอ
พื้นฟ้าคอลัมน์ "คน~" = Rectangle `X/Width` ตามช่อง n=7 · Height = Parent.TemplateHeight

**ลำดับในหน้า (Vertical container `conWflt`, Gap 10, Padding 16):**
`conWfHead` (สูงอัตโนมัติ) → แถวหัว `conWfCols` (36) → `galWf` (8×38) → แถวรวม (40) → หมายเหตุ (Auto height) → หัวรายวัน → แถวหัว `conWfFltCols` (32) → `galWfFlt` (**Flexible height**)
