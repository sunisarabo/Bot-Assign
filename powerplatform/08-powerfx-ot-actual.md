# 08 · ตรวจ OT ขอจริง — อ่านจาก "ไฟล์ OT รวม" (Power Apps / Power Fx)

ให้หน้า **"ตรวจ OT ขอจริง"** ดึง OT จริงจาก **ไฟล์ OT รวม** (`OT_Passenger_Service.xlsx` · ชีต `ข้อมูลคำนวณ`)
แทนการรอไฟล์รายวันในโฟลเดอร์ `00.HumanSoft-OT` → ขอจริงกับแดชบอร์ดจะตรงกันเสมอ

> ⚠️ **ทำไมต้องผ่าน Power Automate (ห้าม Filter Excel ตรง ๆ):**
> ชีต `ข้อมูลคำนวณ` มี **103,159 แถว** แต่ Excel connector ของ Power Apps **ไม่ delegable** จะอ่านได้แค่ 2,000 แถวแรก → `Filter()` ในแอปจะได้ข้อมูล **ไม่ครบ/ผิด** เงียบ ๆ
> วิธีถูก = ให้ **Power Automate กรองวันในฝั่งไฟล์ แล้วส่งเฉพาะวันนั้นกลับ** (~100-150 แถว/วัน)

---

## ขั้น 1 — เตรียมไฟล์ OT รวม (ครั้งเดียว)

1. เปิด `OT_Passenger_Service.xlsx` → เลือกช่วง `ข้อมูลคำนวณ` → **Insert ▸ Table** (มี header) → ตั้งชื่อ Table = **`OTData`**
2. เพิ่มคอลัมน์ **`DateKey`** (ข้อความ `yyyy-mm-dd`) ไว้กรองเร็ว ๆ (eq ได้ตรง):
   - ใส่สูตรในเซลล์แรกของคอลัมน์ใหม่ใน Table:
     ```excel
     =TEXT([@[วันที่]],"yyyy-mm-dd")
     ```
   - หรือถ้า generate ด้วย Office Script อยู่แล้ว ให้เพิ่มคอลัมน์นี้ตอนสร้าง
3. (แนะนำ) Sort/ใส่ไว้บน SharePoint document library เดียวกับที่ Power App ต่ออยู่

---

## ขั้น 2 — Power Automate flow `GetActualOT`

**สร้าง:** Power Apps ▸ แท็บ Power Automate ▸ **+ Create new flow** (instant)

1. **Trigger:** PowerApps (V2) → เพิ่ม input ชนิด **Text** ชื่อ `DateKey`
2. **Excel Online (Business) – List rows present in a table**
   - Location/Library/File: ไฟล์ OT รวม · Table: **`OTData`**
   - **Advanced ▸ Filter Query:** `DateKey eq '@{triggerBody()?['text']}'`  *(ใส่ชื่อ input ให้ตรง)*
   - **Top Count:** `5000` · เปิด **Pagination** (Settings) เผื่อวันที่มีเกิน
3. **Select** (แปลงให้เหลือเฉพาะคอลัมน์ที่ใช้ — เบาลงมาก)
   - From: `value` (จาก List rows)
   - Map (สลับเป็นโหมด text):
     ```json
     {
       "code": "@{item()?['รหัสพนักงาน']}",
       "name": "@{item()?['ชื่อ-สกุล']}",
       "dept": "@{item()?['แผนก']}",
       "team": "@{item()?['ทีม/ตำแหน่ง']}",
       "type": "@{item()?['ประเภท OT']}",
       "otcode": "@{item()?['Code']}",
       "hrs": "@{item()?['ชั่วโมง']}"
     }
     ```
4. **Respond to a PowerApp or flow** → output **Text** ชื่อ `rows` =
   `@{string(body('Select'))}`   *(ส่ง JSON ทั้งก้อนกลับเป็นสตริง)*
5. **Save** → ตั้งชื่อ **`GetActualOT`**

---

## ขั้น 3 — Power Fx บนหน้า "ตรวจ OT ขอจริง"

> ฝั่ง **แผน** ใช้ตาราง Dataverse จริงของโปรเจกต์ (ดู `tables.def.json` / `01` / `02`):
> **`pas_duties`** · วันที่ `pas_work_date` · OT ที่ลงแผน `pas_ot_hours`
> · รหัสพนักงาน = lookup `pas_employee.pas_name` (Emp Code) · ชื่อ `pas_emp_name`
> · ทีม = lookup `pas_team.pas_name` (Team Code) · bucket `pas_bucket.Value` (WORKING/OT_OFF/…)

### 3.1 ปุ่ม "แสดงผล/รีเฟรช" (หรือ `OnVisible` ของ Screen)
```powerapps
// วันที่เลือก + คีย์
Set(varDate, dpDate.SelectedDate);
Set(varKey, Text(varDate, "yyyy-mm-dd"));

// (1) OT จริงจากไฟล์ OT รวม — ผ่าน flow (กรองวันแล้ว เบา)
Set(varResp, GetActualOT.Run(varKey));
ClearCollect(
    colActual,
    ForAll(
        Table(ParseJSON(varResp.rows)),
        {
            code:   Trim(Text(ThisRecord.code)),
            name:   Text(ThisRecord.name),
            dept:   Text(ThisRecord.dept),
            teamX:  Text(ThisRecord.team),      // ทีม/ตำแหน่ง จากไฟล์ OT (airline group)
            otcode: Text(ThisRecord.otcode),
            hrs:    Value(ThisRecord.hrs)
        }
    )
);

// (2) แผน OT จากไฟล์เวร (Dataverse · วันเดียว = เล็ก, filter วันที่ delegable)
ClearCollect(
    colPlan,
    AddColumns(
        Filter(pas_duties, pas_work_date = varDate, pas_ot_hours > 0),
        "codeKey",  Trim(pas_employee.pas_name),
        "planHrs",  pas_ot_hours,
        "teamCode", pas_team.pas_name,
        "empName",  pas_emp_name
    )
);

// (3) สรุปรายคน: ขอจริง(ชม.) เทียบ แผน(ชม.) + หาทีมให้ตรงกับไฟล์เวร
ClearCollect(
    colActualByEmp,
    AddColumns(
        GroupBy(colActual, "code", "grp"),
        "name",    First(grp).name,
        "dept",    First(grp).dept,
        "actHrs",  Sum(grp, hrs),
        "items",   CountRows(grp),
        "planHrs", Sum(Filter(colPlan, codeKey = code), planHrs),
        // ทีม: ใช้ทีมจากไฟล์เวรก่อน → ถ้าไม่มี (คนหลุดแผน) ดึงจากทะเบียน → ท้ายสุด teamX จากไฟล์ OT
        "team",
            Coalesce(
                LookUp(colPlan, codeKey = code).teamCode,
                LookUp(pas_employees, pas_name = code).pas_team.pas_name,
                First(grp).teamX
            )
    )
);

// (4) ตีสถานะ: หลุดแผน(ไม่มีในแผน) / เกินแผน(ขอจริง>แผน)
ClearCollect(
    colCmp,
    AddColumns(
        colActualByEmp,
        "status",
            If(planHrs = 0, "หลุดแผน",
               If(actHrs > planHrs, "เกินแผน", "ตรงแผน")),
        "overHrs", Max(actHrs - planHrs, 0)
    )
);
```

### 3.2 KPI (Label.Text)
```powerapps
// ชั่วโมง OT นอกแผน (คนที่ไม่มีชื่อในแผน OT ของไฟล์เวร)
Sum(Filter(colCmp, status = "หลุดแผน"), actHrs) & " ชม."

// รายการหลุด Assign
Sum(Filter(colCmp, status = "หลุดแผน"), items) & " รายการ"

// ขอจริงแต่ไม่ได้ลงแผน (คน)
CountRows(Filter(colCmp, status = "หลุดแผน")) & " คน"

// ขอเกินแผน (คน + ชม.เกิน)
CountRows(Filter(colCmp, status = "เกินแผน")) & " คน (+" &
  Text(Sum(Filter(colCmp, status = "เกินแผน"), overHrs), "0.#") & " ชม.)"
```

### 3.3 เทียบภาพรวม (ขอจริง vs แผน vs ต่าง)
```powerapps
// ชั่วโมง OT รวม
With({a: Sum(colActual, hrs), p: Sum(colPlan, planHrs)},
     "ขอจริง " & Text(a,"0.#") & " · แผน " & Text(p,"0.#") & " · ต่าง " & Text(a-p,"0.#"))

// จำนวนคน (Headcount)
With({a: CountRows(Distinct(colActual, code)), p: CountRows(Distinct(colPlan, codeKey))},
     "ขอจริง " & a.Value & " · แผน " & p.Value & " · ต่าง " & (a.Value - p.Value))

// จำนวนทีมที่มี OT
With({a: CountRows(Distinct(colCmp, team)), p: CountRows(Distinct(colPlan, teamCode))},
     "ขอจริง " & a.Value & " · แผน " & p.Value)
```

### 3.4 สรุปรายทีม (Gallery)
สร้าง collection ต่อทีม แล้วผูก Gallery:
```powerapps
ClearCollect(
    colTeam,
    AddColumns(
        GroupBy(colCmp, "team", "g"),
        "actPeople",  CountRows(g),
        "actHrsT",    Sum(g, actHrs),
        "planHrsT",   Sum(g, planHrs),
        "shortPeople",CountRows(Filter(g, status = "หลุดแผน"))
    )
);
// Gallery.Items = colTeam  · ช่องในแถว: team / actPeople / actHrsT / planHrsT / shortPeople
// เน้นแดงแถวที่ shortPeople > 0 :  Fill = If(ThisItem.shortPeople>0, RGBA(254,242,242,1), White)
```

### 3.5 รายชื่อ "ขอจริงแต่ไม่ได้ลง Assign" (Gallery)
```powerapps
// Gallery.Items =
Filter(colCmp, status = "หลุดแผน")
// ช่อง: code · name · team · actHrs ("ชม.") · (จะโชว์ otcode เพิ่มได้จาก colActual)
```

### 3.6 กรณีไม่มีข้อมูลวันนั้น (เช่น ต.ค. ที่ไฟล์ยังไม่อัปเดต)
```powerapps
// Label เตือน · Visible = CountRows(colActual) = 0
"ยังไม่มีข้อมูล OT จริงของวันที่ " & Text(varDate,"d mmm yyyy") &
" — ไฟล์ OT รวมมีข้อมูลถึง 27 ก.ย. 69 (อัปเดตไฟล์แล้วกดรีเฟรช)"
```

---

## หมายเหตุ / ข้อควรระวัง
- **ชื่อคอลัมน์ไทย** ใน Select ต้องตรงกับหัว Table เป๊ะ (รวมวรรค) — ถ้า map แล้วได้ค่าว่าง ให้เช็คชื่อหัว
- `GetActualOT` กรองที่ฝั่ง flow แล้ว → ส่งกลับแค่วันเดียว ไม่ชน delegation 2,000 แถว
- ถ้าต่อ **หลายวัน/ช่วง** ให้เพิ่ม input `DateKeyEnd` แล้วใช้ `DateKey ge 'x' and DateKey le 'y'` ใน Filter Query
- การจับคู่ทีม: ฝั่งขอจริงใช้ `ทีม/ตำแหน่ง` จากไฟล์ OT (เช่น `EK/UO/..`) อาจไม่ตรงชื่อทีมในไฟล์เวร — ถ้าต้องการจับคู่เป๊ะ ให้ map ด้วยรหัสพนักงาน → ทีมจากไฟล์เวร (เพิ่มคอลัมน์ team จาก `colPlan`/ทะเบียน)
- ประสิทธิภาพ: flow ต่อวันเร็ว (~1-3 วิ) · ถ้าช้า ให้แน่ใจว่าใส่ **Filter Query** (ไม่ใช่ดึงทั้งตารางมากรองในแอป)
