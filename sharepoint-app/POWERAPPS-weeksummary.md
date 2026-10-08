# หน้า 📊 สรุปสัปดาห์ (Power Apps) — แทนหน้าเดิมของ PAS

ตรงกับ `rbWeekSummaryHtml` + `rbWeekAgg_` / `rbWkAcc_` (`RosterBot.gs`):
| | กติกา (เหมือนเดิม) |
|---|---|
| ช่วง | **จันทร์–อาทิตย์** ของวันที่เลือก (ข้ามเดือนได้) · ป้าย `5-11 OCT` หรือ `27JUL-2AUG` |
| ต่อวัน | **มาทำงาน** (WORKING/OT_OFF) · **ลาป่วย** · **ลาแวค** (VAC/AL/VL/พักร้อน) · **ลากิจ** (BL/ML/PL/กิจ/คลอด) · **OT (คน)** · **OT (ชม.)** |
| 1 คน/วัน | นับครั้งเดียวต่อทีม · ไม่นับแถวซัพพอร์ต "ชื่อ (ทีม)" · อบรมไม่นับเป็นมาทำงาน |
| วันอนาคต | "— ยังไม่ถึง —" · วันที่ไม่มีข้อมูล: "— ไม่มีไฟล์เวร —" |
| แถวสุดท้าย | **รวมสัปดาห์** (person-days) |

ข้อมูล: ตัวนับรายทีม/วันใน `PAS_Manpower` (`cnt_work`, `cnt_sick`, `cnt_vac`, `cnt_personal`, `ot_people`, `ot_hours`) ที่ `import-roster` คำนวณตอนนำเข้า
→ หน้านี้อ่านแค่ ~140 แถว/สัปดาห์ เร็ว ไม่ติดเพดาน
> ข้อมูลที่นำเข้าก่อนอัปเดตนี้ยังไม่มีตัวนับ → รัน `provision-lists.js` ล่าสุด + วาง `import-roster.ts` ใหม่ + กด **Flow C** โฟลเดอร์ปีซ้ำ 1 ครั้ง
> (LL ยังไม่รวม — จะเพิ่มเมื่อมีตัวนำเข้าไฟล์ LL)

---

## 1) ปุ่มเมนู + โหลด
ปุ่มเมนู: `Set(varTab, "wsum"); Select(btnLoadWs)` · container `Visible = varTab = "wsum"` · ต่อท้าย `dpDay.OnChange`: `If(varTab = "wsum", Select(btnLoadWs))`

**`btnLoadWs.OnSelect`**
```powerapps
With({d0: Date(Value(Left(varDay, 4)), Value(Mid(varDay, 6, 2)), Value(Right(varDay, 2)))},
    Set(varWsMon, DateAdd(d0, -(Weekday(d0, StartOfWeek.Monday) - 1), TimeUnit.Days)));
With({e: DateAdd(varWsMon, 6, TimeUnit.Days)},
    Set(varWsLabel, If(Month(varWsMon) = Month(e),
        Day(varWsMon) & "-" & Day(e) & " " & Upper(Text(varWsMon, "mmm", "en-US")),
        Day(varWsMon) & Upper(Text(varWsMon, "mmm", "en-US")) & "-" & Day(e) & Upper(Text(e, "mmm", "en-US")))));

Clear(colWsRaw);
ForAll(Sequence(7, 0) As i,
    With({dt: DateAdd(varWsMon, i.Value, TimeUnit.Days)},
        If(dt <= DateAdd(Now(), 12, TimeUnit.Hours),
            Collect(colWsRaw,
                ShowColumns(Filter(PAS_Manpower, day_key = Text(dt, "yyyy-mm-dd")),
                    day_key, cnt_work, cnt_sick, cnt_vac, cnt_personal, ot_people, ot_hours)))));

ClearCollect(colWs,
    ForAll(Sequence(7, 0) As i,
        With({dt: DateAdd(varWsMon, i.Value, TimeUnit.Days)},
            With({k: Text(dt, "yyyy-mm-dd"), rs: Filter(colWsRaw, day_key = Text(dt, "yyyy-mm-dd"))},
                { k: k, lbl: Day(dt) & " " & Upper(Text(dt, "mmm", "en-US")),
                  future: dt > DateAdd(Now(), 12, TimeUnit.Hours),
                  nofile: IsEmpty(rs),
                  work: Sum(rs, cnt_work), sick: Sum(rs, cnt_sick), vac: Sum(rs, cnt_vac), personal: Sum(rs, cnt_personal),
                  otP: Sum(rs, ot_people), otH: Round(Sum(rs, ot_hours), 1) }))));
Set(varWsTot, {
    work: Sum(colWs, work), sick: Sum(colWs, sick), vac: Sum(colWs, vac), personal: Sum(colWs, personal),
    otP: Sum(colWs, otP), otH: Round(Sum(colWs, otH), 1) })
```

## 2) แถบหัว (พื้นฟ้า `#eef6ff` ขอบซ้าย `#1f4e79` — เหมือนเดิม)
```powerapps
"📊 สรุปสัปดาห์ " & varWsLabel & " — มาทำงาน · ลาป่วย · ลาแวค · ลากิจ · OT   (รอบ จ.–อา. · แวค = VL/VAC/AL · กิจ = BL/ML/PL)"
```

## 3) ตาราง — Gallery `galWs` · `Items = colWs` · TemplateHeight 36
หัวคอลัมน์ (Label แถวบน): วันที่ · มาทำงาน · ลาป่วย · ลาแวค · ลากิจ · OT (คน) · OT (ชม.)

| ช่อง | Text |
|---|---|
| วันที่ | `ThisItem.lbl` (ตัวหนา) |
| มาทำงาน | `If(ThisItem.future, "— ยังไม่ถึง —", ThisItem.nofile, "— ไม่มีไฟล์เวร —", Text(ThisItem.work))` |
| ลาป่วย · ลาแวค · ลากิจ · OT (คน) | `If(ThisItem.future \|\| ThisItem.nofile, "", Text(ThisItem.sick))` (เปลี่ยน `sick` → `vac` / `personal` / `otP`) |
| OT (ชม.) | `If(ThisItem.future \|\| ThisItem.nofile, "", Text(ThisItem.otH, "0.0"))` (ตัวหนา) |

สีตัวอักษรแถว: `If(ThisItem.future || ThisItem.nofile, Color.Gray, Color.Black)`
(ช่อง "มาทำงาน" ของวันที่ยังไม่ถึง/ไม่มีไฟล์ ขยายกว้างคลุมทั้งแถว: `Width = If(ThisItem.future || ThisItem.nofile, Parent.TemplateWidth - 120, 90)`)

**แถวรวมสัปดาห์** (Container ใต้ gallery · พื้น `#eef6ff` · ตัวหนา):
`"รวมสัปดาห์"` · `varWsTot.work` · `varWsTot.sick` · `varWsTot.vac` · `varWsTot.personal` · `varWsTot.otP` · `Text(varWsTot.otH, "0.0")`

## 4) ปุ่มเสริม
- ◀ สัปดาห์ก่อน / ▶ สัปดาห์ถัดไป: `Set(varDay, Text(DateAdd(varWsMon, -7, TimeUnit.Days), "yyyy-mm-dd")); Select(btnLoadWs)` (▶ ใช้ `+7`)
- คัดลอกข้อความ (แบบ log เดิม):
```powerapps
Copy("📊 สรุปสัปดาห์ " & varWsLabel & Char(10) &
    Concat(colWs, "  " & lbl & " → " & If(future, "(ยังไม่ถึง)", nofile, "(ไม่มีไฟล์)",
        "มาทำงาน " & work & " · ป่วย " & sick & " · แวค " & vac & " · กิจ " & personal & " · OT " & otP & " คน (" & otH & " ชม.)"), Char(10)) & Char(10) &
    "  ── รวม → มาทำงาน " & varWsTot.work & " · ป่วย " & varWsTot.sick & " · แวค " & varWsTot.vac & " · กิจ " & varWsTot.personal & " · OT รวม " & varWsTot.otH & " ชม.")
```

## ตรวจว่าตรงกับ PAS เดิม
เลือกสัปดาห์เดียวกันทั้ง 2 ระบบ → เทียบทีละวัน 6 ช่อง
- **มาทำงาน** ต่าง → มักมาจากแถวที่ STATUS/REMARK สะกดต่าง (ส่งตัวอย่างข้อความมา จะเพิ่มคำใน `bucketOf`)
- **แวค/กิจ** สลับกัน → ส่งข้อความในช่อง REMARK ของคนนั้นมา
