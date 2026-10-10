# หน้า 🧭 ตรวจ Assign (Power Apps) — แทนหน้าเดิมของ PAS

ตรวจ **รายคน** ว่าการจัดงานเหมาะสมไหม: ไฟลท์อยู่ในเวลากะ? อยู่ในช่วง OT? ตกนอกกะ? มีช่วงว่างยาว? OT จำเป็นไหม?
คำนวณ **ตอนนำเข้าไฟล์เวร** (`import-roster.ts` → `acAnalyzeRec` พอร์ตจาก `AssignCheck.gs` `acAnalyze_`) เก็บในแถว `PAS_Duty` ของแต่ละคน
> **ตรวจแล้วว่าตรงของเดิม:** `test/assign-parity.test.js` รัน `AssignCheck.gs` ตัวจริงคู่กับตัวใหม่ 15 กรณี (OT หลังกะ/ก่อนกะ/วันหยุด, OT เกินจำเป็น, ไฟลท์นอกกะ, กะข้ามเที่ยงคืน, Crew sign/Flight release, เทรน, ซัพพอร์ตข้ามทีม, Manifest/Debrief, SOD คุมหลายไฟลท์, ไม่มีเวลากะ) → **ตรงทุกคอลัมน์ทุกคน**

## กติกา (เหมือนเดิม)
| | |
|---|---|
| เวลางาน | กะ (คอลัมน์ E–F) + ช่วง OT ที่กรอก (K–L / N–O) · OT OFF = เวลางานคือช่วง OT + ไฟลท์ที่ได้รับ |
| ช่วงไฟลท์ | ตามงาน: เช็คอิน = เปิดเคาน์เตอร์−บรีฟ → ปิดเคาน์เตอร์/STD+post · เกท/ขาเข้า = รอบ STD/STA · Crew sign = เปิดเคาน์เตอร์+2ชม. · Flight release = เปิดเคาน์เตอร์→STD · Manifest/Debrief = รอบเส้นตาย · EY = เปิดเคาน์เตอร์−บรีฟ → STD+45 |
| ครอบคลุม | ช่วงไฟลท์อยู่ในเวลางาน (ผ่อน 60 นาที) · คาบบางส่วน = ส่งต่อกะ (นับครอบคลุม) · ไม่คาบเลย = **🔴 ไฟลท์นอกเวลางาน** |
| OT | มีไฟลท์นอกกะ → "OT ไม่พอ" / "ควรให้ OT/Re-Sked" · มี OT แต่ไฟลท์อยู่ในกะทั้งหมด → **🟡 OT อาจเกินจำเป็น** · OT OFF → "เข้าช่วยวันหยุด" |
| ช่วงว่าง | ว่างระหว่างไฟลท์ ≥ 3 ชม. · ว่างต้น/ท้ายกะ ≥ 4 ชม. → 🟡 |
| งาน | แต่ละงานติดป้าย 🟩 ในกะ · 🟧 OT ก่อน/หลังกะ · 🟥 นอกกะ · "ซัพพอร์ต" = สายที่ทีมอื่นเป็นเจ้าของ |
| ไม่ตรวจ | คนอบรม (TRAINING) · คนไม่มีเวลากะ (⚪ แสดงไว้ให้รู้) |

**ได้เพิ่มจากงานนี้ (ตัวนำเข้าอ่านเวลา OT แล้ว):** แยก **OT ก่อนกะ / หลังกะ** ได้เหมือนเดิม → ใช้ใน Dashboard (ดูข้อ 4)
`PAS_Duty` มีคอลัมน์ใหม่ `ot_type` (PRE/POST/OFF), `ot_time`, `shift_end` · `PAS_Manpower` มี `ot_pre_people/hours`, `ot_post_people/hours`

## เปิดใช้
1. รัน `provision-lists.js` ล่าสุด (เพิ่มคอลัมน์ `ac_*`, `ot_type`, `ot_time`, `shift_end` ใน `PAS_Duty`)
2. วาง `import-roster.ts` ใหม่ → กด **Flow C** โฟลเดอร์ปีซ้ำ (คำนวณย้อนหลัง)

---

## 1) ปุ่มเมนู
`Set(varTab, "ac")` · container `Visible = varTab = "ac"` (ใช้ `colDuty` ที่โหลดใน `btnLoad` อยู่แล้ว — ไม่ต้องโหลดเพิ่ม)

## 2) แถบสรุป (เหมือนเดิม)
```powerapps
With({w: Filter(colDuty, bucket.Value in ["WORKING", "OT_OFF"] && !IsBlank(ac_status))},
    "ตรวจ " & CountRows(Filter(w, ac_status.Value <> "nowin")) & "/" & CountRows(w) & " คนที่มาทำงาน · " &
    "🔴 ไฟลท์นอกเวลา/ขาด OT " & CountRows(Filter(w, ac_status.Value = "bad")) &
    " · 🟡 ควรตรวจ " & CountRows(Filter(w, ac_status.Value = "warn")) &
    " · ✅ ครบ " & CountRows(Filter(w, ac_status.Value = "ok")) &
    " · OT อาจเกิน " & CountRows(Filter(w, "เกินจำเป็น" in ac_ot_verdict)) &
    " · มีช่วงว่าง " & CountRows(Filter(w, !IsBlank(ac_gaps))) &
    " · ไม่มีไฟลท์ " & CountRows(Filter(w, ac_flights = "ไม่มี")) & " (bench/standby)" &
    If(CountRows(Filter(w, ac_status.Value = "nowin")) > 0, " · ไม่มีเวลากะ " & CountRows(Filter(w, ac_status.Value = "nowin")), ""))
```
บรรทัดล่าง (ตัวเล็ก): `"📌 งานในคอลัมน์ไฟลท์ที่ทำ: 🟩 ในกะ · 🟧 OT ก่อน/หลังกะ · 🟥 นอกกะ (ต้องใช้ OT) | รวมทั้งวัน: 🟧 งานใน OT " & Sum(colDuty, Value(Coalesce(Index(Split(ac_zones, "/"), 2).Value, "0"))) & " · 🟥 งานนอกกะ " & Sum(colDuty, Value(Coalesce(Index(Split(ac_zones, "/"), 3).Value, "0")))`

## 3) ตัวกรอง + ตาราง
- `ddAcTeam`: `Items = Table({Value: "ALL"}, Sort(Distinct(colDuty, team), Value))`
- `tglAcShowOk` "แสดงคนที่ครบ (✅) ด้วย" — ค่าเริ่มต้นปิด (เหมือนเดิม: แสดงเฉพาะที่ต้องแก้ · เลือกทีมแล้วเห็นทั้งทีม)
- `ddAcGap` (กรองช่วงว่าง): `["ทั้งหมด", "ว่าง ≥ 3 ชม.", "ว่าง ≥ 5 ชม."]`

Gallery `galAc` · `Items`:
```powerapps
SortByColumns(
    AddColumns(
        Filter(colDuty, bucket.Value in ["WORKING", "OT_OFF"] && !IsBlank(ac_status)
            && (ddAcTeam.Selected.Value = "ALL" || team = ddAcTeam.Selected.Value)
            && (tglAcShowOk.Value || ddAcTeam.Selected.Value <> "ALL" || ac_status.Value in ["bad", "warn"])
            && (ddAcGap.Selected.Value = "ทั้งหมด" || !IsBlank(ac_gaps_raw))),
        ord, Switch(ac_status.Value, "bad", 0, "warn", 1, "ok", 2, 3)),
    "ord", SortOrder.Ascending, "team", SortOrder.Ascending)
```
| คอลัมน์ | Text |
|---|---|
| สถานะ | `Switch(ThisItem.ac_status.Value, "bad", "🔴", "warn", "🟡", "ok", "✅", "⚪")` |
| ทีม · รหัส · ชื่อ | `team` · `emp_code` · `emp_name` (ตัวหนา) |
| ตำแหน่ง | `LookUp(colEmp, Title = ThisItem.emp_code).pos_group` |
| กะ (เข้า-ออก) | `If(ThisItem.bucket.Value = "OT_OFF", "OFF", ThisItem.shift_start & "–" & ThisItem.shift_end)` |
| OT | `If(ThisItem.ot_hours > 0, ThisItem.ot_hours & "h " & Switch(ThisItem.ot_type.Value, "OFF", "OFF", "PRE", "ก่อนกะ", "หลังกะ") & " " & ThisItem.ot_time, "—")` |
| Util | `If(ThisItem.pu_duty_min > 0, ThisItem.util_pct & "%", "—")` · สี `If(ThisItem.util_pct >= 75, ColorValue("#c0392b"), ThisItem.util_pct >= 50, ColorValue("#1c7a4f"), ThisItem.util_pct >= 30, ColorValue("#b26a10"), ColorValue("#8a4f06"))` |
| ไฟลท์ | `ThisItem.ac_flights` |
| 🟩 ในกะ · 🟧 OT · 🟥 นอกกะ | `Index(Split(ThisItem.ac_zones, "/"), 1).Value` (2 = OT · 3 = นอกกะ · ช่องนอกกะ > 0 สีแดง) |
| ไฟลท์ที่ทำ | `ThisItem.ac_job` (ตัวเล็ก ตัดบรรทัด) |
| ไฟลท์นอกเวลา | `Coalesce(ThisItem.ac_uncovered, "—")` (สีแดง) |
| ช่วงว่าง | `Coalesce(ThisItem.ac_gaps, "—")` |
| OT เหมาะสม? | `Coalesce(ThisItem.ac_ot_verdict, "—")` |
| ปัญหา/คำแนะนำ | `ThisItem.ac_issue` |
พื้นแถว: `If(ThisItem.ac_status.Value = "bad", ColorValue("#fdecec"), Color.White)`
ว่าง: `"✅ ไม่พบการ Assign ที่ผิดปกติ — ทุกคนเวลากะครอบคลุมไฟลท์และ OT เหมาะสม"` · `Visible = IsEmpty(galAc.AllItems)`

**คัดลอกแจ้งหัวหน้าทีม:**
`Copy("🧭 ตรวจ Assign " & varDay & Char(10) & Concat(Filter(galAc.AllItems, ac_status.Value = "bad"), "🔴 [" & team & "] " & emp_name & " — " & ac_issue, Char(10)))`

## 4) Dashboard — OT แยกประเภทกลับมาเป็นแบบเดิม (ก่อนกะ / หลังกะ / OFF / นักขัต)
ใน `POWERAPPS-dashboard.md` ข้อ 6 เปลี่ยน `Items` เป็น:
```powerapps
Table({k: "OT ก่อนกะ", n: Sum(colMp, ot_pre_people),  h: Round(Sum(colMp, ot_pre_hours), 1)},
      {k: "OT หลังกะ", n: Sum(colMp, ot_post_people), h: Round(Sum(colMp, ot_post_hours), 1)},
      {k: "OT OFF (วันหยุด)", n: varK.otoff, h: varK.otOffH},
      {k: "นักขัต X1", n: varK.holP, h: varK.holH})
```
และตาราง Manpower by Team ข้อ 10: คอลัมน์ "OT ก่อน" `ot_pre_people & " (" & ot_pre_hours & "h)"` · "OT หลัง" `ot_post_people & " (" & ot_post_hours & "h)"` (แทน "OT ในวันทำงาน")

## ตรวจกับ PAS เดิม
เลือกวันเดียวกัน → เทียบแถบสรุป (🔴 / 🟡 / ✅ / ช่วงว่าง) + สุ่ม 5 คนที่เป็น 🔴
- ต่างที่ **เวลากะ** → คอลัมน์ E/F ของทีมนั้นไม่ใช่ เข้า/ออก (ส่งชื่อทีมมา)
- ต่างที่ **OT** → คอลัมน์ OT ของทีมนั้นไม่อยู่ที่ K–M / N–P (เช่น ทีมที่เพิ่มคอลัมน์) — ส่งชื่อทีมมา จะปรับให้อ่านตามหัวคอลัมน์
