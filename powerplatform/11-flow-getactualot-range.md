# 11 · Power Automate Flow `GetActualOTRange` — OT จริงหลายวัน (ช่วงวันที่)

เวอร์ชันช่วงวันของ `GetActualOT` (ข้อ 10) — ส่ง **เริ่ม–ถึง** แล้วได้ OT จริงทุกวันในช่วงกลับมา
ใช้กับหน้าสรุปหลายวัน / รายสัปดาห์ / เทียบช่วง

> อิงของเดิมในข้อ 10 (Table `OTData` + คอลัมน์ `DateKey` เป็นข้อความ `yyyy-mm-dd`)

---

## แตกต่างจาก `GetActualOT` แค่ 3 จุด
1. Trigger เพิ่ม input ที่ 2
2. Filter Query ใช้ `ge … and le …`
3. Select เพิ่มคอลัมน์ `date` (ไว้ group รายวัน)

---

### ▸ Action 1 — Trigger **PowerApps (V2)**
เพิ่ม input **Text** 2 ตัว:
- `DateKey`     → วันเริ่ม (yyyy-mm-dd)
- `DateKeyEnd`  → วันสุดท้าย (yyyy-mm-dd)

### ▸ Action 2 — **Excel → List rows present in a table**
- File / Table = `OTData` (เหมือนเดิม)
- **Filter Query:**
  ```
  DateKey ge '<DateKey>' and DateKey le '<DateKeyEnd>'
  ```
  (พิมพ์ `DateKey ge '` → ชิป **DateKey** → `' and DateKey le '` → ชิป **DateKeyEnd** → `'`)
  > expression ล้วน: `DateKey ge '@{triggerBody()?['text']}' and DateKey le '@{triggerBody()?['text_1']}'`
  > เทียบสตริง `yyyy-mm-dd` เรียงตามวันจริง → `ge/le` ใช้ได้ถูกต้อง
- **Top Count:** `100000` · **Pagination: On** · Threshold `100000`  (ช่วงยาว = แถวเยอะ)

### ▸ Action 3 — **Data Operation → Select**
From = `value` · Text mode:
```json
{
  "date":   "@{item()?['DateKey']}",
  "code":   "@{item()?['รหัสพนักงาน']}",
  "name":   "@{item()?['ชื่อ-สกุล']}",
  "dept":   "@{item()?['แผนก']}",
  "team":   "@{item()?['ทีม/ตำแหน่ง']}",
  "type":   "@{item()?['ประเภท OT']}",
  "otcode": "@{item()?['Code']}",
  "hrs":    "@{item()?['ชั่วโมง']}"
}
```

### ▸ Action 4 — **Respond to a PowerApp or flow**
output **Text** ชื่อ `rows` = `string(body('Select'))` → **Save** ตั้งชื่อ **`GetActualOTRange`**

---

## ⚠️ ขนาด payload (สำคัญสำหรับช่วงยาว)
"Respond to a PowerApp" ส่งข้อความกลับได้จำกัด — แถวเยอะเกินจะช้า/ตัด:

| ช่วง | แถวโดยประมาณ | คำแนะนำ |
|---|---|---|
| 1–7 วัน | ~1,000 | ส่ง raw ได้สบาย |
| ~2 สัปดาห์ | ~2,000 | ยังไหว |
| ทั้งเดือน | ~4,000 (ก.ย.=3,998) | **เริ่มเสี่ยง** — ควร "สรุปในฝั่ง flow" (ดูด้านล่าง) |

**ถ้าต้องการทั้งเดือน/หลายเดือน** → ให้ flow สรุปก่อนส่ง (payload เล็กลงมาก):
- หลัง List rows ใส่ **Select** แปลงเป็น `{dateteam: "date|team", hrs}` แล้วใช้ **ข้อมูลรวมรายวัน** ด้วย
  Office Script/Power BI แทน — หรือดึงจากชีต `แดชบอร์ด`/`OT รายวัน` ที่สรุปไว้แล้ว (เบากว่าดึง raw)

---

## เรียกจาก Power Apps + สรุป

### โหลดช่วง
```powerapps
Set(varFrom, dpFrom.SelectedDate);
Set(varTo,   dpTo.SelectedDate);
Set(varResp, GetActualOTRange.Run(Text(varFrom,"yyyy-mm-dd"), Text(varTo,"yyyy-mm-dd")));
ClearCollect(
    colRange,
    ForAll(
        Table(ParseJSON(varResp.rows)),
        {
            date:   Text(ThisRecord.date),
            code:   Trim(Text(ThisRecord.code)),
            name:   Text(ThisRecord.name),
            teamX:  Text(ThisRecord.team),
            otcode: Text(ThisRecord.otcode),
            hrs:    Value(ThisRecord.hrs)
        }
    )
)
```

### สรุปรายวัน (Gallery/กราฟ)
```powerapps
ClearCollect(
    colByDay,
    AddColumns(
        GroupBy(colRange, "date", "g"),
        "cases",  CountRows(g),
        "people", CountRows(Distinct(g, code)),
        "hrsSum", Sum(g, hrs)
    )
);
// galDay.Items = SortByColumns(colByDay, "date", Ascending)
// กราฟแท่ง: X=date · Y=hrsSum
```

### สรุปรายคนทั้งช่วง (เช่น หา Top OT)
```powerapps
ClearCollect(
    colByEmp,
    AddColumns(
        GroupBy(colRange, "code", "g"),
        "name",   First(g).name,
        "days",   CountRows(Distinct(g, date)),
        "hrsSum", Sum(g, hrs)
    )
);
// galTop.Items = FirstN(SortByColumns(colByEmp, "hrsSum", Descending), 20)
```

### เทียบแผนทั้งช่วง (ขอจริง vs แผน)
```powerapps
// แผน OT ในช่วง (Dataverse · ge/le วันที่ delegable)
ClearCollect(
    colPlanRange,
    AddColumns(
        Filter(pas_duties, pas_work_date >= varFrom, pas_work_date <= varTo, pas_ot_hours > 0),
        "codeKey", Trim(pas_employee.pas_name),
        "planHrs", pas_ot_hours
    )
);
// รวมภาพ
With({ a: Sum(colRange, hrs), p: Sum(colPlanRange, planHrs) },
     "ขอจริง " & Text(a,"0.#") & " ชม. · แผน " & Text(p,"0.#") & " ชม. · ต่าง " & Text(a-p,"0.#"))
```

---

## หมายเหตุ
- `date` ที่ map มาเป็น `DateKey` (`yyyy-mm-dd`) → เรียง/จัดกลุ่มรายวันได้ตรง
- ฝั่งแผน Dataverse `>=`/`<=` บน `pas_work_date` **delegable** → ดึงช่วงตรง ๆ ได้
- ถ้าเจอ error ParseJSON หรือข้อมูลขาด แสดงว่า payload ใหญ่เกิน → ลดช่วง หรือสลับไปใช้ "สรุปในฝั่ง flow"
- อยากได้ทั้งเดือนบ่อย ๆ แนะนำทำ **ตารางสรุปรายวัน** (1 แถว/วัน/ทีม) ไว้ในไฟล์ OT รวม แล้วดึงอันนั้นแทน raw
