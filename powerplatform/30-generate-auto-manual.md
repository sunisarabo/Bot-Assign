# 30 · ปุ่ม Generate อัตโนมัติ + แก้ manual ได้ (Roster & Assignment)

เป้า: มีปุ่ม **"จัดอัตโนมัติ"** สร้าง roster/assignment ให้ แล้ว **แก้มือทับได้** · รีเจนรอบใหม่ **ไม่ลบของที่แก้มือ**

## หลักการเดียวกันทั้งสองหน้า: ธงแหล่งที่มา
เพิ่มคอลัมน์ทั้ง **PAS_Duty** และ **PAS_Assignment**:
- **`pas_source`** (Choice: `AUTO` / `MANUAL`, default AUTO)
- **`pas_locked`** (Yes/No, default No) — ล็อกแถวไม่ให้ auto ทับ (ออปชัน · ใช้ `pas_source=MANUAL` อย่างเดียวก็พอ)

> กติกา: **auto เขียน/ทับเฉพาะแถว `pas_source=AUTO`** · ทุกการแก้มือ (แลกเวร/ลา/เปลี่ยนกะ/ลงตำแหน่ง) ให้เซ็ต `pas_source: {Value:"MANUAL"}` → รอบ generate ถัดไปข้ามแถวนั้น

ในปุ่มแก้มือเดิม เติมคีย์นี้ตอน Patch เช่น:
```powerapps
// scrRoster btnRShSave / btnRSwGo / btnRLvSave → เพิ่มใน record ที่ Patch(PAS_Duty,...)
..., pas_source: {Value: "MANUAL"}
// scrAssign ปุ่มลงตำแหน่ง → เพิ่มใน Patch(PAS_Assignment,...)
..., pas_source: {Value: "MANUAL"}
```

---

## A · Roster — ปุ่ม "จัดอัตโนมัติ"

ตัวจัดจริง (4-หยุด-2 + หมุนกะไปข้างหน้า + OT ladder) อยู่ที่ generator Python (`build_roster.py`) ซึ่งคลาวด์ flow รันเองไม่ได้ → 2 ทาง:

### A1 (แนะนำ) ปุ่ม = สั่งรันไปป์ไลน์ที่โฮสต์ไว้
1. เพิ่มตาราง **`pas_gen_request`** (RequestId · Month `yyyy-mm` · Team · Status `QUEUED/DONE` · RequestedBy · RequestedAt)
2. ปุ่มใน scrRoster:
```powerapps
btnRGen.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnRGen.OnSelect =
  =Patch(pas_gen_request, Defaults(pas_gen_request),
     { Month: varRM, Team: varRT, Status: {Value:"QUEUED"}, RequestedBy: User().Email, RequestedAt: Now() });
   Notify("สั่งจัดตารางเดือน " & varRM & " ทีม " & varRT & " แล้ว — ระบบจะอัปเดตใน ~ไม่กี่นาที", NotificationType.Success)
```
3. เครื่อง/เซิร์ฟเวอร์ (Task Scheduler ที่รัน `run_month.sh` อยู่แล้ว — ดู `21-auto-run.md`) โพลล์ `pas_gen_request` ที่ `QUEUED` → รัน `build_roster.py --dataverse` (เดือน/ทีมที่ขอ) → CSV → Dataflow upsert → เซ็ต request `DONE`
   > หรือถ้ามี Azure Function หุ้ม generator: flow `HTTP` เรียกตรงแล้วไม่ต้องมีตาราง request

### A2 (ทางเลือก) auto เบา ๆ ในคลาวด์ล้วน
ถ้าไม่อยากมีเครื่อง on-prem: reimplement 4-หยุด-2 + หมุนกะใน **Office Script / cloud flow** เขียน PAS_Duty ตรง ๆ
(ทำได้แต่หนัก — ต้องย้ายตรรกะ `roster_team`/`_assign_shifts` มาเป็น JS · แนะนำ A1 ก่อน)

### ทั้งสองทาง: อย่าให้ทับของแก้มือ (ตรงกับ `23` B)
- **Dataflow upsert**: ก่อน Load เพิ่ม step กรองออก — ไม่ import แถวที่ Dataverse มี `pas_source = MANUAL` (หรือ `pas_locked = true`)
- หรือ importer เขียน `pas_source: AUTO` เสมอ แต่ Dataflow ใช้ **"Do not replace"** กับแถว MANUAL
- ผล: รีเจนรอบใหม่ = เขียนทับเฉพาะ AUTO · แลกเวร/ลา/เปลี่ยนกะที่แก้มือไว้ **คงอยู่**

---

## B · Assignment — ปุ่ม "⚡ จัดอัตโนมัติ" (ทำในแอปได้เต็ม)

จับคนที่ **ขึ้นงานวันนั้น** (PAS_Duty bucket WORKING/OT_OFF) ลง **ตำแหน่งของไฟลท์** (PAS_TeamPosition ต่อ phase + PAS_FlightExtraPos) แบบวนคน → ลง PAS_Assignment · ข้ามไฟลท์/ตำแหน่งที่ลงมือแล้ว (MANUAL)

วางปุ่มบน scrAssign (ใช้ collection เดิม `colADuty`/`colAFlt`/`colAPos`/`colAXtra` ที่ btnALoad โหลดไว้):
```powerapps
btnAAuto.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
btnAAuto.Text = ="⚡ จัดอัตโนมัติ"
btnAAuto.OnSelect = |-
  =If(IsBlank(varAT) || CountRows(colADuty)=0, Notify("โหลดทีม+วันก่อน", NotificationType.Warning),
    // คนว่างวันนั้น (ยังไม่เต็มโควตางาน) — วนแบบ round-robin ด้วย index
    With({ staff: ForAll(Sequence(CountRows(Filter(colADuty, bucket.Value in ["WORKING","OT_OFF"]))) As n,
                    { r: Index(Filter(colADuty, bucket.Value in ["WORKING","OT_OFF"]), n.Value) }) },
      Set(varAi, 0);
      ForAll(SortByColumns(colAFlt, "sta") As f,
        // ตำแหน่งที่ไฟลท์นี้ต้องการ: PAS_TeamPosition (ตาม phase) + extra ของไฟลท์
        ForAll(
          Ungroup(
            Table(
              { p: ForAll(colAPos As pp, { position: pp.position, req: pp.req_count }) },
              { p: ForAll(Filter(colAXtra, flight_no = f.flight_no) As xx, { position: xx.position, req: xx.req_count }) }
            ), "p") As pos,
          ForAll(Sequence(pos.req) As k,
            // ข้ามถ้าตำแหน่งนี้ของไฟลท์นี้มีคนลงแล้ว (MANUAL หรือ AUTO รอบก่อน)
            If(IsBlank(LookUp(PAS_Assignment, day_key=varAKey && team=varAT && Title=f.flight_no && pos.position in Split(task,"/").Value)),
              With({ w: Index(staff, Mod(varAi, CountRows(staff)) + 1).r },
                Collect(colAAsg,
                  Patch(PAS_Assignment, Defaults(PAS_Assignment),
                    { Title: f.flight_no, day_key: varAKey, work_date: varADate, team: varAT,
                      emp_code: w.emp_code, emp_name: w.emp_name, task: pos.position,
                      sta: f.sta, std: f.std, is_flight: true, pas_source: {Value:"AUTO"} }));
                Set(varAi, varAi + 1))
            )
          )
        )
      );
      Notify("จัดอัตโนมัติเสร็จ — ตรวจ/แก้รายตำแหน่งได้", NotificationType.Success); Select(btnALoad)))
```
> หมายเหตุ: Power Fx ไม่มี nested-ForAll state ที่ลื่นนัก — ถ้า dataset ใหญ่/ช้า แนะนำย้าย logic นี้ไป **Power Automate flow** (วนเหมือนกัน เขียน PAS_Assignment) แล้วปุ่มแค่ trigger flow

### ปุ่ม "ล้างเฉพาะ AUTO" (ก่อนจัดใหม่)
```powerapps
btnAClearAuto.OnSelect =
  =ForAll(Filter(PAS_Assignment, day_key=varAKey, team=varAT, pas_source.Value="AUTO") As a, Remove(PAS_Assignment, a));
   Notify("ล้างงานที่จัดอัตโนมัติแล้ว (คงที่ลงมือไว้)", NotificationType.Information); Select(btnALoad)
```
> จัดใหม่ = ล้าง AUTO → กด ⚡ อีกครั้ง · งาน MANUAL ไม่ถูกแตะ

### แก้ manual
ป๊อปอัปลงตำแหน่งเดิม (galAStaff/galAFvStaff) ทำงานตามเดิม — แค่เพิ่ม `pas_source:{Value:"MANUAL"}` ใน Patch → แถวนั้นกลายเป็น MANUAL ทันที (auto/ล้าง AUTO ไม่แตะ)

---

## สรุปพฤติกรรม
| การกระทำ | ผล |
|---|---|
| กด "จัดอัตโนมัติ" | เติมเฉพาะช่องที่ยังว่าง · เขียน `pas_source=AUTO` |
| แก้มือ (ลงตำแหน่ง/แลกเวร/ลา/เปลี่ยนกะ) | `pas_source=MANUAL` → auto ไม่ทับ |
| รีเจน/จัดใหม่ | ล้าง/ทับเฉพาะ AUTO · MANUAL คงอยู่ |
| "ล้างเฉพาะ AUTO" | ลบเฉพาะที่จัดอัตโนมัติ เริ่มจัดใหม่ได้ |
