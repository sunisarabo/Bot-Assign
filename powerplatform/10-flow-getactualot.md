# 10 · Power Automate Flow `GetActualOT` — ทีละ action (ละเอียด)

Flow นี้ให้ Power App ส่ง "วันที่" ไป แล้วได้ **OT จริงของวันนั้น** (จากไฟล์ OT รวม) กลับมาเป็น JSON
— กรองที่ฝั่ง flow เพื่อเลี่ยงเพดาน 2,000 แถวของ Excel connector ในแอป

**ผลลัพธ์:** เรียกในแอปด้วย `GetActualOT.Run(varKey)` → ได้ `.rows` (ข้อความ JSON) ไป `ParseJSON`

---

## สิ่งที่ต้องมีก่อน (จาก `08-powerfx-ot-actual.md` ขั้น 1)
- ไฟล์ `OT_Passenger_Service.xlsx` อยู่บน **SharePoint/OneDrive**
- ชีต `ข้อมูลคำนวณ` ทำเป็น **Table ชื่อ `OTData`** แล้ว
- มีคอลัมน์ **`DateKey`** เป็น **ข้อความ** รูปแบบ `yyyy-mm-dd` (เช่น `2026-09-26`)
  - สูตร: `=TEXT([@[วันที่]],"yyyy-mm-dd")`
  - ⚠️ ต้องเป็น **Text** จริง ๆ (ไม่ใช่วันที่/ตัวเลข) ไม่งั้น `eq` ในฟิลเตอร์จะไม่แมตช์

---

## สร้าง Flow
Power Apps Studio ▸ เมนูซ้าย **Power Automate** ▸ **+ Create new flow** ▸ **Create from blank**
(หรือ make.powerautomate.com ▸ Create ▸ Instant cloud flow ▸ PowerApps)

ตั้งชื่อ (บนซ้าย) = **`GetActualOT`**

---

### ▸ Action 1 — Trigger: **PowerApps (V2)**
1. ทริกเกอร์แรกเลือก **"PowerApps (V2)"** (ไม่ใช่ V1)
2. กด **+ Add an input** ▸ เลือก **Text**
3. ตั้งชื่อ input = **`DateKey`**  (คำอธิบาย: "วันที่ yyyy-mm-dd")

> ภายหลังในแอป `GetActualOT.Run( "2026-09-26" )` — ค่าที่ส่งไปจะเข้ามาที่ `DateKey`

---

### ▸ Action 2 — **Excel Online (Business) → List rows present in a table**
กด **+ New step** ▸ ค้น **Excel Online (Business)** ▸ **List rows present in a table**

| ช่อง | ค่า |
|---|---|
| **Location** | ไซต์ SharePoint ที่เก็บไฟล์ (หรือ OneDrive) |
| **Document Library** | Document library ของไซต์นั้น |
| **File** | เลือก `…/OT_Passenger_Service.xlsx` |
| **Table** | **`OTData`** |

จากนั้นกด **Show advanced options**:

| ช่อง | ค่า |
|---|---|
| **Filter Query** | `DateKey eq '` → แทรก dynamic content **DateKey** → `'`  → ได้เป็น `DateKey eq '<DateKey>'` |
| **Top Count** | `5000` |

> **Filter Query สำคัญสุด** — พิมพ์เอง: `DateKey eq '` แล้วกดชิป **DateKey** (จากทริกเกอร์) แล้วปิดด้วย `'`
> ผลที่ได้ควรอ่านว่า:  `DateKey eq '` **[DateKey]** `'`
> ถ้าพิมพ์ expression ตรง ๆ: `DateKey eq '@{triggerBody()?['text']}'`  (ชื่อภายในของ input แรกมักเป็น `text`)

**เปิด Pagination** (เผื่อวันมีแถวเยอะ):
- ที่ action นี้ ▸ จุดสามจุด **…** ▸ **Settings** ▸ **Pagination = On** ▸ Threshold `100000` ▸ Done

> เพราะใส่ Filter Query แล้ว จริง ๆ จะได้แค่ ~100-150 แถว/วัน — Top 5000 + pagination แค่กันเหนียว

---

### ▸ Action 3 — **Data Operation → Select** (ย่อเหลือเฉพาะคอลัมน์ที่ใช้)
กด **+ New step** ▸ ค้น **Select** (Data Operation)

- **From:**  แทรก dynamic content **value** (เอาต์พุตของ List rows)
- กดสลับเป็นโหมด **Text mode** (ปุ่มสลับขวาบนของช่อง Map ไอคอน `⤢`/`{}`) แล้ววางทั้งก้อนนี้:

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

> ชื่อใน `item()?['…']` ต้องตรงกับ **หัวคอลัมน์ใน Table เป๊ะ** (รวมช่องว่าง/ขีด `-`)
> ถ้าหัวจริงต่าง (เช่น `ชื่อ-สกุล` vs `ชื่อ - สกุล`) ให้แก้ให้ตรง
> `hrs` ส่งเป็นข้อความก่อน แล้วค่อย `Value()` ในแอป

---

### ▸ Action 4 — **Respond to a PowerApp or flow**
กด **+ New step** ▸ ค้น **Respond to a PowerApp or flow** (Power Apps connector)

1. กด **+ Add an output** ▸ เลือก **Text**
2. ชื่อ output = **`rows`**
3. ค่า (Value) = แทรก expression:
   ```
   string(body('Select'))
   ```
   > ถ้า action Select ของคุณถูกเปลี่ยนชื่อ ให้แก้ `'Select'` เป็นชื่อจริง (เช่น `'Select_1'`)
   > `string(...)` แปลง array → ข้อความ JSON เช่น `[{"code":"2406024","name":"…","hrs":"3"}, …]`

**Save**

---

## ทดสอบ Flow (ก่อนต่อแอป)
1. บน flow กด **Test ▸ Manually ▸ Save & Test**
2. ใส่ `DateKey` = **`2026-09-26`** (วันที่มีข้อมูลจริง) ▸ Run
3. ดู output ของ **Respond** → `rows` ควรเป็น JSON มีหลายรายการ
   - 26 ก.ย. 69 ควรได้ ~**138 รายการ** (ตรงกับที่ตรวจไว้)
4. ลองวัน **ไม่มีข้อมูล** เช่น `2026-10-20` → `rows` = `[]` (ว่าง = ถูกต้อง เพราะไฟล์ยังไม่มี ต.ค.)

---

## เรียกจาก Power Apps (สรุปย่อ — รายละเอียดใน `08-powerfx-ot-actual.md`)
```powerapps
Set(varKey, Text(DatePicker1.SelectedDate, "yyyy-mm-dd"));
Set(varResp, GetActualOT.Run(varKey));
ClearCollect(
    colActual,
    ForAll(
        Table(ParseJSON(varResp.rows)),
        {
            code:   Trim(Text(ThisRecord.code)),
            name:   Text(ThisRecord.name),
            dept:   Text(ThisRecord.dept),
            teamX:  Text(ThisRecord.team),      // ทีม/ตำแหน่ง จากไฟล์ OT (จับทีมจริงใน 08 ขั้น 3.3)
            otcode: Text(ThisRecord.otcode),
            hrs:    Value(ThisRecord.hrs)
        }
    )
)
```

---

## แก้ปัญหา (Troubleshooting)
| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| `rows` ว่างทั้งที่วันมีข้อมูล | `DateKey` ไม่ใช่ Text / รูปแบบไม่ใช่ `yyyy-mm-dd` · ลองดู DateKey จริงในไฟล์ให้ตรงกับที่ส่ง |
| ค่าบางช่องว่าง (name/hrs = "") | ชื่อใน `item()?['…']` ไม่ตรงหัวคอลัมน์ · copy หัวจริงมาวาง |
| Flow ช้า/ดึงทั้งตาราง | ลืมใส่ **Filter Query** → มันดึง 103k แถว · ต้องมี `DateKey eq '…'` |
| ขึ้น "delegation/2000" ในแอป | อย่าใช้ `Filter(OTData,…)` ตรงในแอป — ให้ไปทาง flow นี้เท่านั้น |
| `ParseJSON` error ในแอป | ตรวจว่า output เป็น `string(body('Select'))` (เป็นข้อความ ไม่ใช่ array ดิบ) |
| ต้องการช่วงหลายวัน | input เพิ่ม `DateKeyEnd` · Filter Query = `DateKey ge '<DateKey>' and DateKey le '<DateKeyEnd>'` |

## ไดอะแกรมสรุป
```
Power App  ──GetActualOT.Run("2026-09-26")──▶  [PowerApps V2 trigger: DateKey]
                                                      │
                                   [Excel: List rows OTData · Filter DateKey eq '…']
                                                      │  (~138 แถวของวันนั้น)
                                            [Select → code,name,team,hrs,…]
                                                      │
                                   [Respond: rows = string(body('Select'))]
Power App  ◀──── rows (JSON) ────┘  →  ParseJSON → colActual → เทียบกับแผน
```
