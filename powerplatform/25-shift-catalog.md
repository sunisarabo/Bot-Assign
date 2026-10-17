# 25 · ตารางกะจริงต่อทีม (pas_shift_template) + ให้แอปเลือกกะ (ข)

นำกะจริงต่อทีม (จาก IP Template) เข้า Dataverse → หน้า Roster/Assignment เลือกกะจริง (แทน M/A/N)
กะชุดนี้ **ตรงกับที่ generator ลงให้** (code เดียวกัน เช่น QR `05-13`, CHN `15-01`)

## 1) สร้างตาราง `pas_shift_template`
Tables → **+ New table** → **PAS Shift Template**
- Primary → **Key** (Text) = `Team|Code`
- + columns: **Team**(Text) · **Code**(Text) · **StartMin**(Whole number) · **EndMin**(Whole number) · **People**(Whole number) · **Night**(Yes/No)

## 2) Import `pas_shift_template.csv` (51 กะ · 14 ทีม)
Import data from Excel → map ตามชื่อ → Key=primary
> รีเจน CSV ได้จาก `shift_templates.csv` (สคริปต์ `extract_staffing.py`) — อัปเดตเมื่อ IP template เปลี่ยน

## 3) ให้แอปเลือกกะจริง (แทน M/A/N)

### Roster (scrRoster) — เปลี่ยนกะของช่อง
```powerapps
// โหลดกะของทีมตอน btnRLoad
ClearCollect(colRShifts, SortByColumns(Filter(pas_shift_templates, Team = varRT), "StartMin"));
// ป๊อปอัปเลือกกะ (เปิดเมื่อแตะช่อง + ไม่อยู่โหมดแลก + varPriv) — galRShift.Items = colRShifts
// ปุ่มกะในป๊อปอัป:
btnRShift.Text = ThisItem.Code & " (" & ThisItem.People & ")"
btnRShift.OnSelect =
  Patch(PAS_Duty, LookUp(PAS_Duty, pas_duty = varRCell.id),
    { shift_code: ThisItem.Code, bucket: { Value: "WORKING" },
      shift_start: ThisItem.StartMin, shift_end: ThisItem.EndMin,
      shift_hours: (ThisItem.EndMin - ThisItem.StartMin)/60 });
  Set(varRShowPick, false); Select(btnRLoad)
// + ปุ่ม OFF/SL/VL/BL เหมือน 19 (bucket OFF/SICK/VACATION/LEAVE)
```

### แสดงเวลาในกริด (HtmlViewer เดิม)
```powerapps
// ช่อง s เดิม = shift_code (ตอนนี้เป็น "05-13" ฯลฯ อยู่แล้ว) → โชว์ได้เลย
// อยากโชว์เวลา HH:MM: lookup StartMin/EndMin จาก colRShifts หรือใช้ r.shift_start/shift_end ที่มีใน PAS_Duty
```

### Assignment (scrAssign) — กะคนในรายไฟลท์
`galAStaff`/`galAFvStaff` โชว์กะจาก `shift_code`/`shift_start/end` ของ PAS_Duty ได้ตรง ๆ (มาจาก template แล้ว)
> อยากแก้กะที่หน้า Assignment ด้วย → ใช้ป๊อปอัปเลือกกะชุดเดียวกัน (colShifts ของทีม)

## 4) ประโยชน์
- กะใน roster/assignment = **กะจริงที่ทีมใช้** (เวลาเริ่มตรง demand) ไม่ใช่ M/A/N หยาบ ๆ
- ซุปเลือก/เปลี่ยนกะจากชุดที่กำหนด → คุมให้อยู่ในแบบกะมาตรฐาน
- generator + แอป ใช้ **code ชุดเดียวกัน** → import/แก้มือ สอดคล้องกัน

## หมายเหตุ
- กะข้ามเที่ยงคืน: `EndMin > 1440` (เช่น CHN `15-01` = 900→1500) · แปลง HH:MM = `Mod(EndMin,1440)`
- อยากได้ code แบบเดิมของทีม (G12/R9/…) ต้องมี mapping code↔เวลา (ไฟล์ "CODE กะงาน") — เพิ่มคอลัมน์ AltCode ใน template ได้
- generator ลงกะตาม template แล้ว (ดู `24`) — ตาราง `pas_shift_template` นี้ให้ "แอปเลือก/โชว์" ตรงกัน
