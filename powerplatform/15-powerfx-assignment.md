# 15 · หน้า Assignment (ชิพตำแหน่งต่อไฟลท์) บน Power Apps — Power Fx

วางคนลง **ตำแหน่ง (ชิพ)** ของแต่ละไฟลท์ ตามสูตรจริงของทีม (FC/FR/GA/GC/SOD/J/WEB/Y/ARR/AC/CRW…)
ตามแบบ "แยกรายทีม" เดิม · ดู `assignment-real-method.md`

## Data sources
| ตาราง | ใช้ทำอะไร |
|---|---|
| **pas_flight** | ไฟลท์รายวัน (จาก `pas_flight_int.csv`) |
| **pas_team_position** (ใหม่) | ชิพตำแหน่งต่อทีม — import `pas_team_position.csv` (Team·Position·Count·Phase·Desc) |
| **pas_team_airline** | จับไฟลท์→ทีม จาก airline (จาก `team_airline_map.csv`) |
| **pas_duties** | คนขึ้นงานของทีมในวันนั้น (pool ให้เลือก) |
| **pas_assignments** | บันทึกผล: ใคร-ทำตำแหน่งอะไร-ไฟลท์ไหน |

> `pas_assignment` ใช้: `pas_duty` (lookup คน-วัน) · `pas_name`/`pas_flight_leg` (ไฟลท์) · **`pas_task` = รหัสตำแหน่ง** · `pas_is_flight`

## 1) เลือกวัน + ทีม → รายการไฟลท์
```powerapps
Set(varDate, dpDate.SelectedDate);
Set(varTeam, ddTeam.Selected.pas_name);
// ไฟลท์ของทีมในวันนั้น (join ทีมจาก airline)
ClearCollect(colFlt,
  Filter(pas_flights, pas_flight_date = varDate,
    LookUp(pas_team_airlines, Airline = pas_airline_iata).Team = varTeam));
// galFlt.Items = SortByColumns(colFlt, "pas_sta")  · แสดง pas_name/เวลา/route
```

## 2) เลือกไฟลท์ → ชิพตำแหน่งของทีม
```powerapps
// ชิพที่ทีมนี้ใช้ (เรียงตามเฟส CI→GATE→ARR)
ClearCollect(colChips,
  AddColumns(
    Filter(pas_team_positions, Team = varTeam),
    "slot", Value(Count)));     // ถ้า Count>1 = หลายช่องของตำแหน่งเดียว
// กาง Count เป็นช่องย่อย (เช่น GA 3 → GA#1 GA#2 GA#3)
ClearCollect(colSlots,
  Ungroup(
    ForAll(colChips As c,
      { items: ForAll(Sequence(c.slot) As s,
          { pos: c.Position, idx: s.Value, phase: c.Phase, desc: c.Desc }) }),
    "items"));
// galSlots.Items = colSlots
```

## 3) ต่อ 1 ชิพ: เลือกคน (จาก pool คนขึ้นงานทีมวันนั้น) → Patch
```powerapps
// pool: คนทีมนี้ที่ WORKING/OT_OFF วันนั้น
ClearCollect(colPool,
  Filter(pas_duties, pas_work_date = varDate, pas_team.pas_name = varTeam,
         pas_bucket.Value in ["WORKING","OT_OFF"]));
// ในแถว galSlots: Dropdown ddName.Items = colPool (แสดง pas_emp_name)
//   ค่าเดิม = คนที่เคยลงตำแหน่งนี้ของไฟลท์นี้
ddName.DefaultSelectedItems =
  LookUp(pas_assignments,
    pas_name = galFlt.Selected.pas_name && pas_task = ThisItem.pos & "#" & ThisItem.idx).pas_duty.pas_employee

// ปุ่ม/OnChange บันทึก (เฉพาะ varPriv)
Patch(pas_assignments,
  Coalesce(
    LookUp(pas_assignments, pas_name = galFlt.Selected.pas_name && pas_task = ThisItem.pos & "#" & ThisItem.idx),
    Defaults(pas_assignments)),
  { pas_name: galFlt.Selected.pas_name,
    pas_flight_leg: galFlt.Selected.pas_name,
    pas_airline_iata: galFlt.Selected.pas_airline_iata,
    pas_task: ThisItem.pos & "#" & ThisItem.idx,     // เช่น GA#2
    pas_is_flight: true,
    pas_duty: LookUp(pas_duties, pas_work_date=varDate,
                     pas_employee.pas_name = ddName.Selected.pas_employee.pas_name) })
```

## 4) ตัวช่วย / ภาพรวม
```powerapps
// จำนวนชิพที่ยังว่างของไฟลท์ที่เลือก (ยังขาดคน)
CountRows(colSlots) -
  CountRows(Filter(pas_assignments, pas_name = galFlt.Selected.pas_name, !IsBlank(pas_duty)))

// ไฮไลต์ไฟลท์ที่ยังจัดไม่ครบ (ใน galFlt)
If(CountRows(Filter(pas_assignments, pas_name=ThisItem.pas_name, !IsBlank(pas_duty)))
     < LookUp(... จำนวนชิพรวมของทีม ...), RGBA(254,242,242,1), White)

// เตือนคนซ้ำเวลา: คนเดียวถูกวาง 2 ไฟลท์ที่เวลาทับกัน → เช็คจาก pas_sta/pas_std
```

## 5) สิทธิ์ + โหมดอ่าน
- `ddName`/ปุ่มบันทึก `DisplayMode = If(varPriv, Edit, View)` (ซุปแก้ · พนักงานดู)
- พนักงานเปิดหน้า `09` (งานของฉัน) เห็นเฉพาะงานตัวเอง (join จาก `pas_assignments` ของ duty ตัวเอง)

## หมายเหตุ
- **ชิพ = สูตรจริงต่อทีม** (`pas_team_position` จาก `manning_positions.csv`) — เปลี่ยนสูตรที่ตารางนี้ได้เลย ไม่ต้องแก้แอป
- ตำแหน่งเก็บใน `pas_task` เป็น `POS#idx` (เช่น `GA#1`) เพื่อแยกช่องซ้ำตำแหน่ง
- ทีมสูตรบาง (CHN/SU/PG/PVTLP) ชิพน้อย — เติมใน `pas_team_position` ให้ครบตามจริงได้
- Auto-suggest: เติมปุ่ม "จัดอัตโนมัติ" ภายหลัง (วนคนใน pool ที่ว่างช่วงเวลานั้นลงชิพ) — เฟสถัดไป
