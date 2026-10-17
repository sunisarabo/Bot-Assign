# WC/Porter · 09 · Flow `WC Build Cases` (Pre-WC → cases) step-by-step

สร้างเคส `pas_wc_case` รายเคสจาก `pas_wc_prebooking` ของวันที่เลือก · **idempotent** (รันซ้ำไม่เกิดซ้ำ ด้วย alt key `CaseNo`) · **ไม่ทับงานที่จ่าย/จบแล้ว**
ปุ่ม `btnLPBuild` ใน scrLP เรียก flow นี้ (`'WC Build Cases'.Run(...)`) · หรือตั้ง schedule เช้า

> ก่อนเริ่ม: `pas_wc_case` ต้องมี **Alternate Key = `CaseNo`** (Text) และคอลัมน์ `pas_prebook_ref` (ดู `wc-08` ข้อ 1)

---

## 0) แม็ปคอลัมน์บริการใน `pas_wc_prebooking` (★ ปรับให้ตรงของจริง)
ต่อ 1 ไฟลท์มีจำนวนแยกตามบริการ × ทิศ — ลิสต์ชุดที่จะแตกเป็นเคส:
| ฟิลด์ prebooking (ตัวอย่าง) | svc | dir |
|---|---|---|
| `arr_wchr` | WCHR | ARR |
| `arr_wchs` | WCHS | ARR |
| `arr_wchc` | WCHC | ARR |
| `arr_maas` | MAAS | ARR |
| `dep_wchr` | WCHR | DEP |
| `dep_wchs` | WCHS | DEP |
| `dep_wchc` | WCHC | DEP |
| `dep_maas` | MAAS | DEP |

---

## 1) Trigger — PowerApps (V2)
make.powerautomate.com → **+ Create → Instant cloud flow → PowerApps (V2)**
- เพิ่ม input **Text** ชื่อ `dateText` (ค่าที่ scrLP ส่งมา = `yyyy-mm-dd`)

## 2) Initialize variables
- **`vDate`** (String) = `@{if(empty(triggerBody()?['text']), utcNow('yyyy-MM-dd'), triggerBody()?['text'])}`
- **`vCreated`** (Integer) = 0 · **`vUpdated`** (Integer) = 0

## 3) List rows — prebooking ของวันนั้น
**Dataverse → List rows** · Table `pas_wc_prebooking`
- Filter rows: `BookingDate eq @{variables('vDate')}`  *(ถ้า BookingDate เป็น DateTime ใช้ `Microsoft.Dynamics.CRM.On(PropertyName='bookingdate',PropertyValue='@{variables('vDate')}')`)*
- Select columns: FlightNo · Airline · Sta · Std · Gate + ฟิลด์บริการทั้ง 8 + (id)

## 4) Apply to each — prebooking row  (ตั้งชื่อ `FOR_booking`)
ข้างในวนบริการ 8 ชุด — ทำ **Compose `svcSet`** เป็น array ของ {svc,dir,qty,field}:
```
[
 {"svc":"WCHR","dir":"ARR","qty": @{coalesce(items('FOR_booking')?['arr_wchr'],0)} },
 {"svc":"WCHS","dir":"ARR","qty": @{coalesce(items('FOR_booking')?['arr_wchs'],0)} },
 {"svc":"WCHC","dir":"ARR","qty": @{coalesce(items('FOR_booking')?['arr_wchc'],0)} },
 {"svc":"MAAS","dir":"ARR","qty": @{coalesce(items('FOR_booking')?['arr_maas'],0)} },
 {"svc":"WCHR","dir":"DEP","qty": @{coalesce(items('FOR_booking')?['dep_wchr'],0)} },
 {"svc":"WCHS","dir":"DEP","qty": @{coalesce(items('FOR_booking')?['dep_wchs'],0)} },
 {"svc":"WCHC","dir":"DEP","qty": @{coalesce(items('FOR_booking')?['dep_wchc'],0)} },
 {"svc":"MAAS","dir":"DEP","qty": @{coalesce(items('FOR_booking')?['dep_maas'],0)} }
]
```

### 4.1 Apply to each — `@{outputs('Compose_svcSet')}`  (ชื่อ `FOR_svc`)
- **Condition** `item()?['qty']` **>** 0 → ถ้าใช่:
  - **Apply to each** `@{range(1, item('FOR_svc')?['qty'])}`  (ชื่อ `FOR_seq`) → สร้างทีละเคส:
    - **Compose `caseNo`** = `@{concat(items('FOR_booking')?['flightno'],'|',items('FOR_svc')?['svc'],'|',items('FOR_svc')?['dir'],'|',item())}`
    - **List rows** `pas_wc_case` · filter `CaseNo eq '@{outputs('Compose_caseNo')}'` · Top 1 → `existing`
    - **Condition** `length(body('existing')?['value'])` **= 0**
      - **YES (ยังไม่มี → สร้าง):** **Add a new row** `pas_wc_case`:
        ```
        CaseNo        = @{outputs('Compose_caseNo')}
        CaseDate      = @{variables('vDate')}
        Airline       = @{items('FOR_booking')?['airline']}
        FlightNo      = @{items('FOR_booking')?['flightno']}
        ServiceType   = (choice) @{items('FOR_svc')?['svc']}
        IsArrival     = @{equals(items('FOR_svc')?['dir'],'ARR')}
        IsDeparture   = @{equals(items('FOR_svc')?['dir'],'DEP')}
        Eta           = @{items('FOR_booking')?['sta']}
        Etd           = @{items('FOR_booking')?['std']}
        Gate          = @{items('FOR_booking')?['gate']}
        Status        = (choice) STANDBY
        NotifiedTime  = @{utcNow()}
        pas_prebook_ref (lookup/text) = @{items('FOR_booking')?['pas_wc_prebookingid']}
        ```
        แล้ว **Increment** `vCreated`
      - **NO (มีแล้ว → อัปเดตแบบไม่ทับสถานะที่จ่าย/จบ):**
        - **Condition** `body('existing')?['value'][0]?['statuscode']`... ง่ายกว่า: ใช้ formatted status
          - ถ้าสถานะเดิม **= STANDBY** → **Update a row** (row id จาก existing) อัปเดต Eta/Etd/Gate/Airline (เผื่อ prebooking แก้) · คง Status = STANDBY · **Increment** `vUpdated`
          - ถ้า **ON_PROCESS/COMPLETED/CANCELLED** → **ข้าม** (อย่าแตะ — งานเดินไปแล้ว)

## 5) (ออปชัน) ยกเลิกเคสที่ prebooking หายไป
หลังลูป: List `pas_wc_case` ของวันนั้นที่ Status=STANDBY แล้วไม่มี CaseNo ตรงกับชุดที่เพิ่งสร้าง → Update `Status=CANCELLED` (เฉพาะ STANDBY เท่านั้น)

## 6) Respond to PowerApps (V2)
- Output **Text** `result` = `@{concat('สร้าง ', variables('vCreated'), ' · อัปเดต ', variables('vUpdated'))}`
> scrLP `btnLPBuild` รับค่ากลับได้: `Set(varBuildMsg, 'WC Build Cases'.Run(Text(varWDate,"yyyy-mm-dd")).result)`

---

## ตั้งเป็น schedule เช้า (ควบคู่ปุ่ม)
ทำ flow แฝดอีกตัว **Recurrence** (ทุกวัน 05:00) → ขั้น 2-5 เหมือนกัน (ใช้ `vDate = utcNow('yyyy-MM-dd')`) → เคสของวันพร้อมก่อน LP เข้างาน
> หรือ flow เดียว trigger 2 ทาง: ใช้ **Child flow**/`WC Build Cases` core แล้วเรียกจากทั้งปุ่มและ schedule

## ทำไม idempotent
- key `CaseNo = Flight|Svc|Dir|seq` → รันซ้ำ = เจอแถวเดิม → อัปเดต/ข้าม ไม่ Add ใหม่
- แก้จำนวนใน prebooking (เช่น WCHR 2→3) → รันใหม่ seq 3 เพิ่ม 1 เคส · ลด 3→2 ให้ขั้น 5 ยกเลิก seq ที่เกิน (เฉพาะ STANDBY)
- เคสที่พอตเตอร์รับ/จบแล้ว = ไม่ถูกแตะ (กันทับงานจริง — ตรง `wc-08`)

## เชื่อม scrLP
ปุ่ม `btnLPBuild` (มีใน scrLP แล้ว) เรียก `'WC Build Cases'.Run(Text(varWDate,"yyyy-mm-dd"))` → หลังรันกด `btnLPLoad` รีโหลด `colCases` เห็นเคสใหม่ทันที
> ต้อง **Add flow เข้าแอป** (Power Apps → Flows → + Add flow → เลือก WC Build Cases) ก่อน ปุ่มถึงเลิกขึ้นแดง
