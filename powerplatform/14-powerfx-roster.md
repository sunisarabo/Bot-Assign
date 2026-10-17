# 14 · หน้า Roster (ตารางเวร) บน Power Apps — Power Fx

หน้าให้ **ซุป** ดู/แก้ตารางเวรทีม เป็นกริด **คน × วัน** ของเดือน (อ่านจาก `pas_duties` ที่ import จาก roster)
ต่อยอดจากข้อ `13` (นำเข้า) · ใช้ร่วมกับ `09` (งานของฉัน ฝั่งพนักงาน)

> data: `pas_duties` — `pas_work_date` · `pas_employee` (lookup, `.pas_name`=รหัส, `.pas_name_th`=ชื่อ)
> · `pas_team` (lookup, `.pas_name`) · `pas_shift_code` (M/A/N) · `pas_bucket.Value` (WORKING/OT_OFF/OFF/…)
> · `pas_ot_hours`

## 1) ตัวเลือกบน (Header)
```powerapps
// Dropdown ทีม
ddTeam.Items = Sort(pas_teams, pas_name)           // แสดง pas_name
// เดือน
dpMonth.DefaultDate = Date(2026,11,1)
// ปุ่มโหลด / OnVisible
Set(varTeam, ddTeam.Selected);
Set(varM1, Date(Year(dpMonth.SelectedDate), Month(dpMonth.SelectedDate), 1));
Set(varM2, DateAdd(DateAdd(varM1,1,Months),-1,Days));     // สิ้นเดือน
// วันของเดือน (คอลัมน์)
ClearCollect(colDays, ForAll(Sequence(Day(varM2)), { d: DateAdd(varM1, Value-1, Days) }));
// เวรของทีมทั้งเดือน (delegable: filter ด้วย team lookup + ช่วงวันที่)
ClearCollect(colDuty,
    Filter(pas_duties,
        pas_team.pas_name = varTeam.pas_name,
        pas_work_date >= varM1, pas_work_date <= varM2));
// รายชื่อคนในทีม (distinct)
ClearCollect(colStaff,
    Distinct(colDuty, pas_employee.pas_name));    // .Value = รหัส
```

## 2) กริด คน × วัน
**galStaff** (แนวตั้ง · Items = `colStaff`) — แต่ละแถว = 1 คน
ในแถวมี Label ชื่อ + **galRow** (แนวนอน · Items = `colDays`) = ช่องกะรายวัน:
```powerapps
// ช่องกะ (btnCell) ใน galRow — หาเวรของ (คนแถวนี้, วันคอลัมน์นี้)
With({ r: LookUp(colDuty,
            pas_employee.pas_name = galStaff.Selected.Value && pas_work_date = ThisItem.d) },
  // Text
  Coalesce(r.pas_shift_code, If(r.pas_bucket.Value="OFF","OFF", "")) &
    If(Coalesce(r.pas_ot_hours,0)>0, "*", "")
)
// สี (Fill) ตามกะ
With({ r: LookUp(colDuty, pas_employee.pas_name=galStaff.Selected.Value && pas_work_date=ThisItem.d) },
  Switch(Coalesce(r.pas_shift_code, If(r.pas_bucket.Value="OFF","OFF","")),
    "M",   RGBA(255,243,191,1),
    "A",   RGBA(208,235,255,1),
    "N",   RGBA(229,219,255,1),
    "OFF", RGBA(241,243,245,1), White))
```
> หมายเหตุ: ใน galRow ให้ parent context ใช้ `ThisItem` ของคน (ผ่าน `galStaff` template)
> ถ้า galRow ซ้อนใน galStaff ใช้ `galStaff.AllItems` ไม่ได้ → ให้เก็บ `rowCode` ไว้ใน context ของ galStaff
> ด้วย `galStaff.OnSelect`/`ThisItem` แล้วอ้างใน galRow ด้วยตัวแปร context ของแถวนั้น

### ทำกริดให้แก้ง่าย (ทางที่เสถียรกว่าใน canvas)
ใช้ **collection แบน** 1 แถว/คน/วัน แล้ววาง galStaff × galRow:
```powerapps
ClearCollect(colGrid,
  ForAll(colStaff As s,
    { code: s.Value,
      name: LookUp(colDuty, pas_employee.pas_name=s.Value).pas_employee.pas_name_th,
      cells: ForAll(colDays As c,
        With({ r: LookUp(colDuty, pas_employee.pas_name=s.Value && pas_work_date=c.d) },
          { d: c.d,
            shift: Coalesce(r.pas_shift_code, If(r.pas_bucket.Value="OFF","OFF","")),
            ot: Coalesce(r.pas_ot_hours,0),
            id: r.pas_duty }))   // เก็บ key ไว้ Patch
    }));
// galStaff.Items = colGrid · Label = ThisItem.name
// galRow.Items   = ThisItem.cells · btnCell.Text = shift & If(ot>0,"*","")
```

## 3) แก้กะ (ซุปเท่านั้น) — แตะช่อง → ป๊อปอัป → Patch
```powerapps
// btnCell.OnSelect
Set(varEditId, ThisItem.id); Set(varEditCode, galStaff.Selected.code);
Set(varEditDate, ThisItem.d); Set(varEditShift, ThisItem.shift);
Set(varShowEdit, varPriv)         // varPriv = ซุป/ดิวตี้/mgr/admin (จาก 07-access-roles)

// ในป๊อปอัป: Dropdown ddShift.Items = ["M","A","N","OFF"]
// ปุ่มบันทึก
Patch(pas_duties,
  If(IsBlank(varEditId), Defaults(pas_duties),
     LookUp(pas_duties, pas_duty = varEditId)),
  { pas_work_date: varEditDate,
    pas_employee: LookUp(pas_employees, pas_name = varEditCode),
    pas_team: varTeam,
    pas_shift_code: If(ddShift.Selected.Value="OFF","", ddShift.Selected.Value),
    pas_bucket: { Value: If(ddShift.Selected.Value="OFF","OFF","WORKING") } });
// รีเฟรช colDuty/colGrid ตามข้อ 1-2
```
> ปุ่มแก้โชว์เฉพาะ `varPriv` (พนักงานเห็นอ่านอย่างเดียว ตามโมเดลสิทธิ์)

## 4) แถบสรุป/คัฟเวอเรจต่อวัน (ใต้กริด)
```powerapps
// จำนวนขึ้นงานต่อกะของทั้งทีมในวันที่เลือก varDay
Set(varDay, varM1);
"M " & CountRows(Filter(colDuty, pas_work_date=varDay, pas_shift_code="M")) &
" · A " & CountRows(Filter(colDuty, pas_work_date=varDay, pas_shift_code="A")) &
" · N " & CountRows(Filter(colDuty, pas_work_date=varDay, pas_shift_code="N")) &
" · OFF " & CountRows(Filter(colDuty, pas_work_date=varDay, pas_bucket.Value="OFF")) &
" · OT " & CountRows(Filter(colDuty, pas_work_date=varDay, pas_ot_hours>0))
// เทียบ target (ถ้า import ตาราง ShiftReq ไว้ด้วย) → โชว์ "ขาด" แดง
```

## หมายเหตุ
- `*` ท้ายรหัสกะ = วันนั้นมี OT (`pas_ot_hours>0`) ตามที่กลบวันขาด
- กริดจริงใน canvas = **galStaff (แนวตั้ง) ซ้อน galRow (แนวนอน)** · ถ้าคนเยอะใช้ `colGrid` แบบ pre-compute (ข้อ 2) ลื่นกว่า
- แก้ได้เฉพาะ `varPriv` · พนักงานใช้หน้า `09` (งานของฉัน) อ่านอย่างเดียว
- วันลา: ตอนนี้ roster ใช้ OFF อย่างเดียว · ภายหลังเพิ่ม `pas_bucket` = SICK/VACATION/LEAVE ได้เมื่อมีข้อมูลจริง
