# หน้า 🔮 OT ล่วงหน้า + 🔍 ตรวจ OT (Power Apps) — แทน 2 หน้าเดิมของ PAS

| หน้า | ของเดิม | ของใหม่ (ข้อมูล) |
|---|---|---|
| 🔮 **OT ล่วงหน้า** | `rbOTAheadData_` (RosterBot.gs) — อ่านไฟล์เวรวันนี้ + 3 วันถัดไป + ledger OT | `PAS_Manpower` · `PAS_OT_Person` · `PAS_Duty` (มีอยู่แล้ว **ไม่ต้องตั้ง flow เพิ่ม**) |
| 🔍 **ตรวจ OT** (ขอจริง vs แผน) | `OTCompare.gs` — ฝังหน้าเว็บ Apps Script อีกตัว (iframe) อ่าน Google Sheet และแก้วันที่ในโค้ด | `PAS_OT_Request` (Flow H · `FLOW-hsot.md`) เทียบกับ `PAS_OT_Person` — **เลือกวันไหนก็ได้** |

OT ล่วงหน้าแสดงวันอนาคตได้ทันทีที่วางไฟล์เวรวันนั้นในโฟลเดอร์เดือน (Flow A/B นำเข้าเอง)
เกณฑ์ (เหมือนเดิม): รายคน **สัปดาห์ > 36 ชม. หรือ เดือน > 144 ชม. = 🔴** · ≥ 30 / ≥ 130 = 🟠 · รายวัน คน OT ≥ 30% ของคนทำงาน = แดง · ≥ 20% = ส้ม · รายทีม ≥ 40% แดง · ≥ 25% ส้ม

---

# A) 🔮 OT ล่วงหน้า

## 1) ปุ่มเมนู + โหลด
ปุ่มเมนู `Set(varTab, "otah"); Select(btnLoadOtah)` · container `Visible = varTab = "otah"`

**`btnLoadOtah.OnSelect`** (วันเริ่ม = วันที่เลือก `varDay` · 4 วัน = วันนี้ + 3 วัน เหมือนเดิม)
```powerapps
With({d0: Date(Value(Left(varDay, 4)), Value(Mid(varDay, 6, 2)), Value(Right(varDay, 2)))},
    Set(varOaDays, ForAll(Sequence(4, 0) As i, {k: Text(DateAdd(d0, i.Value, TimeUnit.Days), "yyyy-mm-dd"), dt: DateAdd(d0, i.Value, TimeUnit.Days), n: i.Value}));
    Set(varOaMon, DateAdd(d0, -(Weekday(d0, StartOfWeek.Monday) - 1), TimeUnit.Days)));
Set(varOaWS, Text(varOaMon, "yyyy-mm-dd")); Set(varOaWE, Text(DateAdd(varOaMon, 6, TimeUnit.Days), "yyyy-mm-dd"));
Set(varOaMK, Left(varDay, 7));
// ทีมต่อวัน (Manpower) + คนทำ OT ต่อวัน (ledger) + duty ของคนที่ OT (ชม.งาน/ไฟลท์)
Clear(colOaMp); Clear(colOaOt); Clear(colOaDuty);
ForAll(varOaDays As d,
    Collect(colOaMp, Filter(PAS_Manpower, day_key = d.k));
    Collect(colOaOt, Filter(PAS_OT_Person, day_key = d.k));
    Collect(colOaDuty, Filter(PAS_Duty, day_key = d.k && ot_hours > 0)));
// OT สะสมทั้งเดือน (คิดสัปดาห์/เดือน) — ledger เดือนนี้ + เดือนก่อนถ้าสัปดาห์คร่อมเดือน
ClearCollect(colOaLed, Filter(PAS_OT_Person, month_key = varOaMK));
If(Left(varOaWS, 7) <> varOaMK, Collect(colOaLed, Filter(PAS_OT_Person, month_key = Left(varOaWS, 7) && day_key >= varOaWS)));
If(Left(varOaWE, 7) <> varOaMK, Collect(colOaLed, Filter(PAS_OT_Person, month_key = Left(varOaWE, 7) && day_key <= varOaWE)))
```
> `PAS_OT_Person` ของ 1 เดือน ≈ 2,000–4,000 แถว → ตั้ง **Settings → Data row limit = 2000** แล้วถ้าเกินให้แบ่งโหลดเป็นรายสัปดาห์ (`ForAll(Sequence(5)…)` ด้วย `week_key`) แบบเดียวกับ `POWERAPPS-ot.md`

## 2) ภาพรวม OT ต่อวัน — Gallery `galOaDay` · `Items = varOaDays`
```powerapps
// ในแต่ละแถว: ตัวแปรช่วย (Label ซ่อน หรือใช้ With ในทุกช่อง)
With({m: Filter(colOaMp, day_key = ThisItem.k)},
    With({work: Sum(m, cnt_work), ppl: Sum(m, ot_people)},
        { ok: !IsEmpty(m), work: work, otoff: Sum(m, cnt_ot_off), otoffH: Round(Sum(m, ot_off_hours), 1),
          pre: Sum(m, ot_pre_people), preH: Round(Sum(m, ot_pre_hours), 1), post: Sum(m, ot_post_people), postH: Round(Sum(m, ot_post_hours), 1),
          ppl: ppl, hrs: Round(Sum(m, ot_hours), 1), ratio: If(work > 0, ppl / work, 0) }))
```
| ช่อง | Text |
|---|---|
| วันที่ | `Text(ThisItem.dt, "d mmm") & If(ThisItem.n = 0, " (วันนี้)", "")` |
| 🟢 Working · 🟡 OT OFF · ⏰ ก่อนกะ · ⏰ หลังกะ | `s.work` · `s.otoff & " (" & s.otoffH & "h)"` · `s.pre & " (" & s.preH & "h)"` · `s.post & " (" & s.postH & "h)"` |
| รวม OT (คน / ชม.) · % OT | `s.ppl` · `s.hrs & "h"` · `Round(s.ratio * 100, 0) & "%"` |
ไม่มีไฟล์เวร: `"⚠️ ไม่มีไฟล์ assignment ของวันนี้"` เมื่อ `!s.ok`
พื้นแถว: `If(s.ratio >= 0.30, ColorValue("#fdecec"), s.ratio >= 0.20, ColorValue("#fff3e0"), Color.White)`

## 3) OT รายทีม (ตารางทีม × วัน)
`galOaTeam.Items = Sort(Distinct(Filter(colOaMp, ot_people > 0), team), Value)`
ช่องวันที่ i (ทำ 4 ช่อง i = 0..3 — หรือ Gallery แนวนอนซ้อน `Items = varOaDays`):
```powerapps
With({r: LookUp(colOaMp, team = ThisItem.Value && day_key = Index(varOaDays, 1).k)},     // เปลี่ยน 1 → 2/3/4
    With({ppl: r.cnt_ot_off + r.ot_pre_people + r.ot_post_people, work: r.cnt_work},
        If(IsBlank(r), "-", Text(ppl))))
```
สีพื้น: ratio = `ppl / work` → `≥ 0.40` แดง `#fdecec` · `≥ 0.25` ส้ม `#fff3e0`

## 4) OT รายคน (เตือน 3 ระดับ) — `colOaPerson`
ต่อท้าย `btnLoadOtah.OnSelect`:
```powerapps
ClearCollect(colOaPerson,
    ForAll(Distinct(colOaOt, emp_code) As e,
        With({mine: Filter(colOaLed, emp_code = e.Value), win: Filter(colOaOt, emp_code = e.Value), dut: Filter(colOaDuty, emp_code = e.Value)},
            With({week: Round(Sum(Filter(mine, day_key >= varOaWS && day_key <= varOaWE), ot_hours), 1),
                  month: Round(Sum(Filter(mine, month_key = varOaMK), ot_hours), 1)},
                { emp_code: e.Value, name: First(win).emp_name, team: First(win).team,
                  d0: LookUp(win, day_key = Index(varOaDays, 1).k).ot_hours, d1: LookUp(win, day_key = Index(varOaDays, 2).k).ot_hours,
                  d2: LookUp(win, day_key = Index(varOaDays, 3).k).ot_hours, d3: LookUp(win, day_key = Index(varOaDays, 4).k).ot_hours,
                  w0: LookUp(dut, day_key = Index(varOaDays, 1).k).duty_min / 60, w1: LookUp(dut, day_key = Index(varOaDays, 2).k).duty_min / 60,
                  w2: LookUp(dut, day_key = Index(varOaDays, 3).k).duty_min / 60, w3: LookUp(dut, day_key = Index(varOaDays, 4).k).duty_min / 60,
                  workWin: Round(Sum(dut, duty_min) / 60, 1), otWin: Round(Sum(win, ot_hours), 1),
                  nOt: Sum(dut, Value(Coalesce(Index(Split(ac_zones, "/"), 2).Value, "0"))),
                  nSh: Sum(dut, Value(Coalesce(Index(Split(ac_zones, "/"), 1).Value, "0"))),
                  chips: Concat(dut, Text(DateValue(day_key), "d mmm") & ": " & ac_flights, Char(10)),
                  week: week, month: month,
                  flag: If(week > 36 || month > 144, "over", week >= 30 || month >= 130, "near", "") }))))
```
Gallery `galOaPerson` · `Items = SortByColumns(AddColumns(colOaPerson, o, Switch(flag, "over", 0, "near", 1, 2)), "o", SortOrder.Ascending, "week", SortOrder.Descending)`

| ช่อง | Text |
|---|---|
| สถานะ | `Switch(ThisItem.flag, "over", "🔴 เกิน", "near", "🟠 ใกล้", "")` |
| ชื่อ · ทีม | `ThisItem.name` · `ThisItem.team` |
| วันที่ 1–4 (แยกงานปกติ/OT) | `If(IsBlank(ThisItem.d0) && IsBlank(ThisItem.w0), "·", "งาน " & Round(Coalesce(ThisItem.w0, 0) - Coalesce(ThisItem.d0, 0), 1) & "h" & If(ThisItem.d0 > 0, Char(10) & "OT " & ThisItem.d0 & "h · " & Round(ThisItem.d0 / ThisItem.w0 * 100, 0) & "%", ""))` (ใช้ d1/w1 … สำหรับวันถัดไป) |
| งาน/OT ช่วงนี้ | `"งานรวม " & ThisItem.workWin & "h" & Char(10) & "🟩 ปกติ " & (ThisItem.workWin - ThisItem.otWin) & "h · ✈" & ThisItem.nSh & Char(10) & "🟧 OT " & ThisItem.otWin & "h · ✈" & ThisItem.nOt` |
| OT สัปดาห์ · OT เดือน | `ThisItem.week & "h"` (แดง > 36 · ส้ม ≥ 30) · `ThisItem.month & "h"` (แดง > 144 · ส้ม ≥ 130) |
| งานที่ทำ | `ThisItem.chips` (ตัวเล็ก) |
พื้นแถว: `Switch(ThisItem.flag, "over", ColorValue("#fdecec"), "near", ColorValue("#fff8e1"), Color.White)`
หัว: `"🔮 OT ล่วงหน้า 4 วัน (จาก " & varDay & ") · 🔴 เกินเกณฑ์ " & CountRows(Filter(colOaPerson, flag = "over")) & " คน · 🟠 ใกล้ " & CountRows(Filter(colOaPerson, flag = "near")) & " คน"`

---

# B) 🔍 ตรวจ OT — ขอจริง (HumanSoft) เทียบ แผน (ไฟล์เวร)

## 1) ปุ่มเมนู + โหลด
ปุ่มเมนู `Set(varTab, "otc"); Select(btnLoadOtc)` · ใช้ `varDay` (เลือกวันได้ทุกวัน)
```powerapps
ClearCollect(colOtcPlan, Filter(PAS_OT_Person, day_key = varDay));
ClearCollect(colOtcReq,
    AddColumns(Filter(PAS_OT_Request, day_key = varDay) As q,
        inPlan, !IsBlank(LookUp(colOtcPlan, emp_code = q.emp_code)),
        planH, Sum(Filter(colOtcPlan, emp_code = q.emp_code), ot_hours)));
// ต่อคน: ขอจริงรวม vs แผน → หลุดแผน (ไม่มีในแผน) / เกินแผน (ขอมากกว่าแผน)
ClearCollect(colOtcPerson,
    ForAll(Distinct(colOtcReq, emp_code) As e,
        With({r: Filter(colOtcReq, emp_code = e.Value)},
            { emp_code: e.Value, name: First(r).emp_name, pos: First(r).position, team: First(r).team,
              req: Sum(r, hours), plan: First(r).planH, inPlan: First(r).inPlan,
              times: Concat(r, time_start & "-" & time_end, ", "), reason: Concat(r, reason, " / ") })))
```

## 2) การ์ด KPI (เหมือนเดิม)
| การ์ด | Text |
|---|---|
| 🔴 ชั่วโมง OT นอกแผน (เกิน PLAN) | `Round(Sum(Filter(colOtcReq, !inPlan), hours), 2) & " ชม."` |
| 🟠 รายการหลุด Assign | `CountRows(Filter(colOtcReq, !inPlan)) & " รายการ"` |
| 🔵 ขอจริงแต่ไม่ได้ลง Plan | `CountRows(Filter(colOtcPerson, !inPlan)) & " คน"` |
| **เพิ่ม:** 🟣 ขอเกินแผน | `CountRows(Filter(colOtcPerson, inPlan && req > plan + 0.25)) & " คน · +" & Round(Sum(Filter(colOtcPerson, inPlan && req > plan + 0.25), req - plan), 1) & " ชม."` |

## 3) สรุปเปรียบเทียบภาพรวม (3 แถว × ขอจริง / แผน / ส่วนต่าง)
```powerapps
Table(
  {k: "• จำนวนทีมที่ขอ OT", hs: CountRows(Distinct(colOtcReq, team)), pl: CountRows(Distinct(colOtcPlan, team))},
  {k: "• จำนวนคน (Headcount)", hs: CountRows(colOtcPerson), pl: CountRows(Distinct(colOtcPlan, emp_code))},
  {k: "• จำนวนรายการ OT", hs: CountRows(colOtcReq), pl: CountRows(colOtcPlan)})
```
ช่องส่วนต่าง `ThisItem.hs - ThisItem.pl` (แดงถ้าไม่ใช่ 0)
> ทีมฝั่งแผนมาจากชื่อแท็บในไฟล์เวร ส่วนฝั่งขอจริงมาจากทีมใน `PAS_Employees` → ถ้าชื่อทีมสองฝั่งเขียนต่างกัน จำนวนทีมจะเพี้ยน (จำนวนคนและรายการไม่กระทบ)

## 4) สรุปรายทีม
`galOtcTeam.Items`:
```powerapps
ForAll(Distinct(Ungroup(Table({t: Distinct(colOtcReq, team)}, {t: Distinct(colOtcPlan, team)}), t), Value) As tm,
    With({r: Filter(colOtcPerson, team = tm.Value), p: Filter(colOtcPlan, team = tm.Value)},
        { team: tm.Value, hsP: CountRows(r), hsH: Sum(r, req), plP: CountRows(Distinct(p, emp_code)), plH: Sum(p, ot_hours),
          unP: CountRows(Filter(r, !inPlan)), unH: Sum(Filter(r, !inPlan), req) }))
```
คอลัมน์: ทีม · ขอจริง (คน) · ขอจริง (ชม.) · PLAN (คน) · PLAN (ชม.) · **เกิน PLAN / หลุดแผน** `If(ThisItem.unP > 0, ThisItem.unP & " คน (+" & Round(ThisItem.unH, 2) & " ชม.)", "-")` (พื้นแดงอ่อนเมื่อ > 0)
แถวรวมล่าง: `Sum(galOtcTeam.AllItems, hsP)` ฯลฯ

## 5) 🚩 รายชื่อคนขอจริงแต่ไม่ได้ลง Assign
`Items = SortByColumns(Filter(colOtcReq, !inPlan), "team", SortOrder.Ascending)`
คอลัมน์: `emp_code` · `emp_name` · `position` · `team` · `time_start & " - " & time_end` · `hours` (แดง) · `reason`
ว่าง: `"✅ ไม่พบรายการที่หลุด Assign ในวันนี้"`
**เพิ่ม:** แท็บย่อย "ขอเกินแผน" → `Filter(colOtcPerson, inPlan && req > plan + 0.25)` แสดง `name · team · ขอ req ชม. · แผน plan ชม. · +ส่วนต่าง`

ปุ่ม 📋 คัดลอกแจ้งหัวหน้าทีม:
`Copy("🔍 OT ขอจริงแต่ไม่อยู่ในแผน " & varDay & Concat(Filter(colOtcReq, !inPlan), Char(10) & "• [" & team & "] " & emp_name & " " & time_start & "-" & time_end & " (" & hours & " ชม.) " & reason))`

## ตรวจกับ PAS เดิม
เลือกวันที่ 7/9/2026 (วันที่หน้าเดิมเปิดไว้) → เทียบการ์ด 3 ใบ + จำนวนแถว 🚩
- ต่างที่ "หลุดแผน" → ของเดิมใช้ชีตแผน "วันที่ N" ที่ทำมือ ส่วนของใหม่ใช้ OT ในไฟล์เวรจริง (คนที่มี OT > 0 ในแท็บทีม) — ถ้าต่าง แปลว่าชีตแผนกับไฟล์เวรไม่ตรงกัน
