# หน้า ▦ Dashboard (Power Apps) — ให้ครบเท่า PAS เดิม

แทน `rbBuildDashboardHtml_` (หน้าแรกของ PAS) · เรียงส่วนตามหน้าเดิม:

| # | ส่วน (เดิม) | ใหม่ | แหล่งข้อมูล |
|---|---|---|---|
| 0 | 🎌 แถบวันหยุดประเพณี | ✅ | `PAS_Manpower.is_holiday` + `PAS_Holidays` |
| 1 | Hero: % มาปฏิบัติงาน · ทำงาน/ทั้งหมด · OFF/OT OFF/Sick/Vac · OT คน/ชม. · ไฟลท์ขาดคน | ✅ (ไฟลท์ขาดคน: `POWERAPPS-flights.md` ข้อ 4) | `PAS_Manpower` (ตัวนับรายทีม) |
| 2 | 👷 กำลังพลแยกกลุ่ม HKT / BKK / Globex × ตำแหน่ง | ✅ | `PAS_Duty` × `PAS_Employees` |
| 3 | 🚨 ไฟลท์ต้องเสริมด่วน | ✅ ดู `POWERAPPS-flights.md` ข้อ 4 | `PAS_FlightSLA` |
| 4 | 🧳 เคส Porter วันนี้ | ✅ | `PAS_Porter` |
| 5 | 📊 Working/Total ต่อทีม · 🧭 ภาพรวมสถานะ | ✅ | `PAS_Manpower` |
| 6 | ⏱️ OT แยกประเภท (คน / ชม.) | ✅ ปรับ: **ในวันทำงาน · วันหยุด (OT OFF) · นักขัต X1** | `PAS_Manpower` |
| 7 | ⚠️ เตือน OT (สัปดาห์ 36 / เดือน 144) | ✅ | `PAS_OT_Person` |
| 8 | 🧮 เทียบ MANPOWER (ชีต) กับเวรจริง | ✅ | `PAS_Manpower` (ค่าชีต vs ตัวนับ) |
| 9 | 🧑‍💼 ในเวรแต่ไม่มีในรายชื่อ | ✅ | `PAS_Duty` × `PAS_Employees` |
| 10 | 📌 Manpower by Team (PSA) | ✅ | `PAS_Manpower` |
| 11 | 👥 PSA by Position | ✅ | `PAS_Duty` × `PAS_Employees` |
| — | 🟡 LL by Section / Position | ❌ ยังไม่มี (รอตัวนำเข้าไฟล์ LL) | — |

> **OT ก่อนกะ / หลังกะ:** ตัวนำเข้าอ่านเวลา OT แล้ว (คอลัมน์ K–L / N–O) → แยกก่อน/หลังกะได้เหมือนเดิม — ใช้สูตรใน `POWERAPPS-assigncheck.md` ข้อ 4 แทนข้อ 6 ด้านล่าง

**ต้องนำเข้าใหม่ 1 ครั้ง** (ตัวนับใหม่ `cnt_staff`, `cnt_off`, `cnt_ot_off`, `mp_ot_hours`): รัน `provision-lists.js` ล่าสุด → วาง `import-roster.ts` ใหม่ → กด Flow C โฟลเดอร์ปี

---

## A) โหลดข้อมูล — เพิ่มต่อท้าย `btnLoad.OnSelect`
(`colMp`, `colDuty`, `colAsg`, `colPorter` โหลดอยู่แล้วตาม `POWERAPPS-app.md` · `colEmp` โหลดใน App.OnStart)
```powerapps
// เวรวันนี้ × รายชื่อ (กลุ่ม/ตำแหน่ง) — คำนวณครั้งเดียวใช้หลายการ์ด
ClearCollect(colDE,
    ForAll(Filter(colDuty, !is_support) As d,
        With({e: LookUp(colEmp, Title = d.emp_code)},
            { team: d.team, emp_code: d.emp_code, emp_name: d.emp_name, b: d.bucket.Value,
              work: d.bucket.Value in ["WORKING", "OT_OFF"],
              ot: Coalesce(d.ot_hours, 0), hol: Coalesce(d.ot_hol_hours, 0),
              pg: Coalesce(e.pos_group, "PSA"),
              src: If(IsBlank(e), "HKT", e.source.Value = "BKK", "BKK", e.source.Value = "GLOBEX" || e.pos_group = "Globlex", "Globex", "HKT"),
              inMaster: !IsBlank(e) })));
Set(varHolName, If(First(colMp).is_holiday, LookUp(PAS_Holidays, day_key = varDay).Title, ""));
Set(varK, {
    staff: Sum(colMp, cnt_staff), work: Sum(colMp, cnt_work), otoff: Sum(colMp, cnt_ot_off), off: Sum(colMp, cnt_off),
    sick: Sum(colMp, cnt_sick), vac: Sum(colMp, cnt_vac) + Sum(colMp, cnt_personal), train: Sum(colMp, cnt_training),
    otP: Sum(colMp, ot_people), otH: Round(Sum(colMp, ot_hours), 1), otOffH: Round(Sum(colMp, ot_off_hours), 1),
    holP: CountRows(Filter(colDE, hol > 0)), holH: Round(Sum(colMp, ot_hol_hours), 1),
    flights: CountRows(Filter(PAS_Flights, day_key = varDay && !cancelled)) });
Select(btnLoadOTAlert)
```
**ปุ่ม `btnLoadOTAlert` (ซ่อน) — เตือน OT ของสัปดาห์/เดือนของวันที่เลือก** (ใช้ร่วมกับแท็บเตือนใน `POWERAPPS-ot.md` ได้)
```powerapps
With({d0: Date(Value(Left(varDay, 4)), Value(Mid(varDay, 6, 2)), Value(Right(varDay, 2)))},
    Set(varOTWeekKey, Text(DateAdd(d0, -(Weekday(d0, StartOfWeek.Monday) - 1), TimeUnit.Days), "yyyy-mm-dd"));
    Set(varOTMonthKey, Text(d0, "yyyy-mm")));
Clear(colOTP); Clear(colOTW);
ForAll(Distinct(colMp, team) As t,
    Collect(colOTP, Filter(PAS_OT_Person, month_key = varOTMonthKey && team = t.Value));
    Collect(colOTW, Filter(PAS_OT_Person, week_key = varOTWeekKey && team = t.Value)));
ClearCollect(colOTAlert,
    ForAll(Distinct(Ungroup(Table({x: ShowColumns(colOTP, emp_code)}, {x: ShowColumns(colOTW, emp_code)}), x), emp_code) As e,
        With({p: LookUp(colOTP, emp_code = e.Value), w: LookUp(colOTW, emp_code = e.Value)},
            { emp_code: e.Value, name: Coalesce(p.emp_name, w.emp_name), team: Coalesce(p.team, w.team),
              month: Sum(Filter(colOTP, emp_code = e.Value), ot_hours), week: Sum(Filter(colOTW, emp_code = e.Value), ot_hours) })))
```

## 0) แถบวันหยุดประเพณี
Label · `Visible = !IsBlank(varHolName)` · พื้น `#fff1f2` · `Text = "🎌 วันนี้วันหยุดประเพณี: " & varHolName & " — มาทำงาน = OT นักขัต X1 (เท่าชั่วโมงกะ)"`

## 1) Hero (พื้นไล่สี AOT `#1D428A → #0f2a5c` · ตัวอักษรขาว)
| องค์ประกอบ | สูตร |
|---|---|
| วงแหวน % (Image) | ดูด้านล่าง · `pct = If(varK.staff > 0, Round((varK.work - varK.otoff) / varK.staff * 100, 0), 0)` |
| หัว | `"มาปฏิบัติงานวันนี้ · Active " & CountRows(colEmp)` |
| ตัวเลขใหญ่ | `(varK.work - varK.otoff) & " / " & varK.staff` |
| ชิป | `"OFF " & varK.off` · `"OT OFF " & varK.otoff` · `"Sick " & varK.sick` · `If(varK.vac > 0, "Vac " & varK.vac, "")` |
| OT · People | `varK.otP` · ใต้: `"คนทำ OT วันนี้"` |
| OT · Hours | `varK.otH & "h"` · ใต้: `"เฉลี่ย " & If(varK.otP > 0, Round(varK.otH / varK.otP, 1), 0) & "h / คน"` |
| ไฟลท์ขาดคน | `"—"` · ใต้: `"ไฟลท์วันนี้ " & varK.flights & " · เช็ค SLA (เร็ว ๆ นี้)"` |

วงแหวน (Image control 120×120):
```powerapps
With({p: If(varK.staff > 0, (varK.work - varK.otoff) / varK.staff, 0), r: 46, c: 2 * Pi() * 46},
  "data:image/svg+xml;utf8," & EncodeUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>" &
    "<circle cx='60' cy='60' r='46' fill='none' stroke='rgba(255,255,255,.18)' stroke-width='14'/>" &
    "<circle cx='60' cy='60' r='46' fill='none' stroke='#7cc4ff' stroke-width='14' stroke-linecap='round' transform='rotate(-90 60 60)' stroke-dasharray='" & c * p & " " & c & "'/>" &
    "<text x='60' y='60' text-anchor='middle' font-family='Segoe UI' font-size='24' font-weight='700' fill='white'>" & Round(p * 100, 0) & "%</text>" &
    "<text x='60' y='80' text-anchor='middle' font-family='Segoe UI' font-size='11' fill='rgba(255,255,255,.8)'>Attendance</text></svg>"))
```

## 2) 👷 กำลังพลแยกกลุ่ม (คนปฏิบัติงานวันนี้)
Gallery `galSrc` · `Items`:
```powerapps
ForAll(["PSS", "SNR", "PSA", "AdminD", "Crewsign", "Porter"] As p,
    With({rs: Filter(colDE, work && pg = p.Value)},
        { pos: p.Value,
          hkt: CountRows(Filter(rs, src = "HKT")), bkk: CountRows(Filter(rs, src = "BKK")),
          glo: CountRows(Filter(colDE, work && src = "Globex" && (pg = p.Value || (p.Value = "PSA" && pg = "Globlex")))),
          tot: CountRows(rs) }))
```
คอลัมน์: ตำแหน่ง · HKT · BKK · Globex · รวม · แถวรวม (Label ใต้): `CountRows(Filter(colDE, work && src = "HKT"))` ฯลฯ
แถว OT ต่อกลุ่ม: `Round(Sum(Filter(colDE, src = "BKK"), ot), 1) & " ชม."` (HKT/Globex เช่นเดียวกัน)

## 3) 🚨 ไฟลท์ต้องเสริมด่วน (กรอบรอ)
Container + Label: `"🚨 ไฟลท์ต้องเสริมด่วน — จะแสดงอัตโนมัติเมื่อเปิดใช้ Flights & SLA"` (สีเทา) · จะแทนด้วย gallery ในขั้น Flights & SLA

## 4) 🧳 เคส Porter วันนี้ (การ์ดย่อ — ปุ่ม "ดูทั้งหมด" ไปหน้า Porter)
`"เคส " & CountRows(colPorter) & " · ขาเข้า " & CountRows(Filter(colPorter, is_arrival)) & " · ขาออก " & CountRows(Filter(colPorter, is_departure)) & " · Completed " & CountRows(Filter(colPorter, status = "COMPLETED")) & " · Pre-WC จอง " & Sum(colPreWC, qty)`
· ว่าง: `If(IsEmpty(colPorter), "ยังไม่มีเคส Porter ของวันนี้")` · ปุ่ม: `Set(varTab, "porter")`

## 5) กราฟ
**📊 Working / Total ต่อทีม** — Insert → Charts → **Column chart** · `Items = Sort(colMp, cnt_work, SortOrder.Descending)` · Labels `team` · Series1 `cnt_work` · Series2 `cnt_staff`
(สี: ทำงาน `#1D428A` · ทั้งหมด `#C9D6EA`)

**🧭 ภาพรวมสถานะ** — **Pie chart** · `Items`:
```powerapps
Table({k: "ทำงาน", v: varK.work - varK.otoff}, {k: "OT OFF", v: varK.otoff}, {k: "OFF", v: varK.off},
      {k: "ป่วย", v: varK.sick}, {k: "ลา", v: varK.vac}, {k: "อบรม", v: varK.train})
```
Labels `k` · Series `v` · สี: `#1D428A`, `#FEC909`, `#8FA6C4`, `#E5484D`, `#5EA9E6`, `#A855F7`

## 6) ⏱️ OT แยกประเภท — 2 กราฟแท่งแนวนอน (คน / ชม.)
```powerapps
Table({k: "ในวันทำงาน", n: varK.otP - varK.otoff, h: Round(varK.otH - varK.otOffH, 1)},
      {k: "วันหยุด (OT OFF)", n: varK.otoff, h: varK.otOffH},
      {k: "นักขัต X1", n: varK.holP, h: varK.holH})
```
กราฟ "คน" Series = `n` · กราฟ "ชม." Series = `h`

## 7) ⚠️ เตือน OT (การ์ดย่อ)
```powerapps
"⚠️ เตือน OT · สัปดาห์เกิน 36h: " & CountRows(Filter(colOTAlert, week > 36)) & " (ใกล้ " & CountRows(Filter(colOTAlert, week >= 30 && week <= 36)) & ")" &
"  · เดือนเกิน 144h: " & CountRows(Filter(colOTAlert, month > 144)) & " (ใกล้ " & CountRows(Filter(colOTAlert, month >= 130 && month <= 144)) & ")"
```
`Visible = !IsEmpty(Filter(colOTAlert, week >= 30 || month >= 130))` · ปุ่ม "ดูรายชื่อ": `Set(varTab, "ot"); Set(varOTTab, "alert")`
รายชื่อย่อ 5 คนแรก: `FirstN(Sort(Filter(colOTAlert, week >= 30 || month >= 130), Max(week / 36, month / 144), SortOrder.Descending), 5)`

## 8) 🧮 เทียบ MANPOWER (ชีต) กับเวรจริง
แสดงเฉพาะทีมที่ตัวเลขไม่ตรง (MANPOWER พิมพ์มือ มักค้าง):
```powerapps
Filter(
    AddColumns(colMp, dW, cnt_work - working, dOt, Round(ot_hours - mp_ot_hours, 1)),
    dW <> 0 || Abs(dOt) >= 0.5)
```
คอลัมน์: ทีม · ทำงาน (ชีต) `working` · ทำงาน (เวร) `cnt_work` · ต่าง `dW` · OT ชม. (ชีต) `mp_ot_hours` · OT ชม. (เวร) `ot_hours` · ต่าง `dOt`
หัวการ์ด: `"🧮 MANPOWER ไม่ตรงเวร " & CountRows(Self.Items) & " ทีม — แก้ชีต MANPOWER หรือแท็บทีม"` · ไม่มี → `"✅ MANPOWER ตรงกับเวรทุกทีม"`

## 9) 🧑‍💼 ในเวรแต่ไม่มีในรายชื่อ
`Filter(colDE, !inMaster)` · คอลัมน์: ทีม · รหัส · ชื่อ · `Visible = !IsEmpty(Filter(colDE, !inMaster))`
คำแนะนำ: "เพิ่มในไฟล์ Manpower (Flow D sync เอง) หรือแก้รหัสในแท็บทีม"

## 10) 📌 Manpower by Team (PSA)
Gallery · `Items = Sort(colMp, cnt_work, SortOrder.Descending)` (เรียงตามคนทำงานมากก่อน — เหมือนเดิม)
| คอลัมน์ | Text |
|---|---|
| ทีม | `ThisItem.team` |
| Total | `ThisItem.cnt_staff` |
| Working | `ThisItem.cnt_work` (ตัวหนา) |
| เทรน | `If(ThisItem.cnt_training > 0, ThisItem.cnt_training, "—")` |
| OFF · Sick · Vac | `cnt_off` · `cnt_sick` · `cnt_vac + cnt_personal` |
| OT-Off | `If(ThisItem.cnt_ot_off > 0, ThisItem.cnt_ot_off & " (" & ThisItem.ot_off_hours & "h)", "—")` |
| OT ในวันทำงาน | `With({n: ThisItem.ot_people - ThisItem.cnt_ot_off, h: Round(ThisItem.ot_hours - ThisItem.ot_off_hours, 1)}, If(n > 0, n & " (" & h & "h)", "—"))` |
| %Working | แถบ: Rectangle `Width = 90 * ThisItem.cnt_work / Max(1, ThisItem.cnt_staff)` + Label `Round(ThisItem.cnt_work / Max(1, ThisItem.cnt_staff) * 100, 0) & "%"` |

แถวรวม (Label ใต้): `varK.staff` · `varK.work` · `varK.train` · `varK.off` · `varK.sick` · `varK.vac` · `varK.otoff` · …

## 11) 👥 PSA by Position
Gallery · `Items`:
```powerapps
Filter(
    ForAll(["PSS", "SNR", "PSA", "Globlex", "AdminD", "Porter", "Crewsign"] As p,
        With({rs: Filter(colDE, pg = p.Value)},
            { pos: p.Value, staff: CountRows(rs), work: CountRows(Filter(rs, work)),
              otoff: CountRows(Filter(rs, b = "OT_OFF")), off: CountRows(Filter(rs, b = "OFF")),
              sick: CountRows(Filter(rs, b = "SICK")), leave: CountRows(Filter(rs, b in ["VACATION", "LEAVE"])),
              otP: CountRows(Filter(rs, ot > 0)), otH: Round(Sum(rs, ot), 1) })),
    staff > 0)
```
คอลัมน์: ตำแหน่ง · Total · Working · OT-Off · OFF · Sick · Vac · OT (`otP & " (" & otH & "h)"`)

## เทียบกับ PAS เดิม (วันเดียวกัน)
- Hero: ทำงาน/ทั้งหมด · OFF · OT OFF · Sick · OT คน/ชม.
- Manpower by Team: Total/Working ทุกทีม
- ต่างกัน → ส่งชื่อทีม + ตัวเลข 2 ฝั่ง · ส่วนใหญ่มาจากคำในช่อง STATUS/REMARK ที่ตัวนำเข้ายังไม่รู้จัก (แก้ใน `bucketOf`)
