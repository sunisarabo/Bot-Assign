# WC/Porter · 05 · Flow หลังบ้าน `wc-ack` / `wc-start` / `wc-end` (Power Automate · ละเอียด)

หน้า Power Pages (`wc-04`) เป็น anonymous → **เขียน Dataverse ตรงไม่ได้** · ทุกการเปลี่ยนสถานะยิงเข้า **flow 3 ตัว**
flow ทำงานด้วย **service connection** (สิทธิ์เต็ม) แล้ว **บังคับกติกา + ตรวจตัวตนเอง** → client ปลอมค่าไม่ผ่าน

> 3 flow = instant cloud flow (**When an HTTP request is received**) · ตอบกลับ JSON · ใช้ Dataverse connector (List/Get/Add/Update rows)
> โหลด logical name จริงของตารางคุณมาก่อน (Settings → Tables → ดู **Logical name** เช่น `pas_wc_case`, `pas_wheelchair`) — ด้านล่างใช้ชื่อตามเอกสาร wc-01..04 ถ้าของจริงต่างให้แทนที่

---

## 0) กันความปลอดภัย (ทำก่อน — สำคัญ)
HTTP trigger ได้ URL ที่มี SAS token ในตัว → ถือเป็น **กึ่งลับ** ฝังในหน้าเพจได้ แต่เพิ่ม 2 ชั้น:
1. **Shared secret header**: ทุก flow เช็ก header `x-wc-key` = ค่าลับ (เก็บใน **Environment Variable** `wc_api_key`) ไม่ตรง → 401
2. **PIN ต่อพอตเตอร์**: ตรวจ `pin` เทียบ `pas_wc_staffs.pas_pin` ของ `staffId` → กันสวมรอยกันเอง
> อย่าใส่สิทธิ์ write ให้ anonymous table permission เด็ดขาด — ให้ flow เป็นทางเดียวที่เขียน

สร้าง Environment Variable: Solutions → เปิด solution → New → Environment variable → `wc_api_key` (Text) → ใส่ค่าลับ

---

## 1) `wc-ack` — รับทราบ (เคส LP จ่าย = เริ่มงานเลย)

### Trigger: When an HTTP request is received  (method **POST**)
**Request Body JSON Schema** (Generate from sample ด้วยก้อนนี้):
```json
{ "caseId": "GUID-ของ-pas_wc_cases", "staffId": "P076", "pin": "1234", "apiKey": "xxxx" }
```
> หรือส่ง `apiKey` เป็น header `x-wc-key` ก็ได้ (ปลอดภัยกว่า) → อ่านด้วย `triggerOutputs()?['headers']?['x-wc-key']`

### Steps
1. **Condition — ตรวจ API key**
   `triggerBody()?['apiKey']` (หรือ header) **is equal to** `@{parameters('wc_api_key (…)')}`
   - **If no →** Response **401** `{ "ok": false, "error": "unauthorized" }` → **Terminate** (Cancelled)

2. **Get a row by ID — Staff** (ตาราง `pas_wc_staffs`, Row ID = `triggerBody()?['staffId']`)
   > ถ้า StaffId ไม่ใช่ primary key ให้ใช้ **List rows** `$filter=pas_staffid eq '...'` + top 1 แทน

3. **Condition — ตรวจ PIN + active**
   `outputs('Get_Staff')?['body/pas_pin']` is equal to `triggerBody()?['pin']`  **AND**  `.../pas_isactive` = true
   - **If no →** Response **403** `{ "ok": false, "error": "bad_pin" }` → Terminate

4. **Get a row by ID — Case** (ตาราง `pas_wc_cases`, Row ID = `caseId`)
   เลือก **Expand Query**: `pas_assigned_wc($select=pas_controlno,pas_shortno)` เพื่อได้รถเข็นที่ LP จองไว้

5. **Condition — ตรวจcaseporter เป็นของคนนี้จริง** (กันรับแทนคนอื่น)
   **List rows** `pas_wc_caseporters` · `$filter=_pas_case_value eq @{triggerBody()?['caseId']} and _pas_staff_value eq @{outputs('Get_Staff')?['body/pas_wc_staffid']}` · Top 1
   - length = 0 → Response **403** `{ "ok": false, "error": "not_your_case" }` → Terminate

6. **Condition — สถานะยังรับได้** (ไม่ถอยหลัง + ยังไม่ ack)
   `pas_status` **is not** `COMPLETED`/`CANCELLED`  **AND**  `pas_acknowledged` **≠** true
   - If no → Response **409** `{ "ok": false, "error": "already_done_or_ack" }` → Terminate

7. **Update a row — Case: บันทึกรับทราบ** (`pas_wc_cases`, id = caseId)
   - `pas_acknowledged` = **true**
   - `pas_ack_at` = `@{utcNow()}`
   - `pas_ack_by` = `@{triggerBody()?['staffId']}`

8. **Condition — มีรถเข็นที่ LP จองไว้ไหม** (`_pas_assigned_wc_value` is not blank)

   **➤ If YES (เคส LP จ่าย → เริ่มงานเลย):**
   - **8a. List rows — เช็กรถเข็นว่าง**: `pas_wc_trips` · `$filter=_pas_wheelchair_value eq @{outputs('Get_Case')?['body/_pas_assigned_wc_value']} and pas_endtime eq null` · Top 1
     - ถ้า length > 0 **และ** `DateDiff(StartTime, now) < 12h` → Response **409** `{ "ok": false, "error": "wc_in_use" }` → Terminate
     > เช็ก 12 ชม.: `sub(ticks(utcNow()), ticks(item()?['pas_starttime']))` < `ticks 12h` — หรือกรองใน $filter ด้วย `pas_starttime gt <now-12h>`
   - **8b. Get rows — เลขรันนิ่ง trip วันนี้**: List rows `pas_wc_trips` `$filter=pas_tripdate eq '@{utcNow('yyyy-MM-dd')}'` → `length(body/value)`
   - **8c. Add a row — pas_wc_trips** (เริ่ม trip):
     ```
     pas_tripid       = TRP-@{utcNow('yyyyMMdd')}-@{formatNumber(add(length(...8b...),1),'000')}
     pas_tripdate     = @{utcNow('yyyy-MM-dd')}
     Wheelchair (lookup) = /pas_wheelchairs(@{...assigned_wc_value})
     Staff (lookup)   = /pas_wc_staffs(@{outputs('Get_Staff')?['body/pas_wc_staffid']})
     pas_flightcode   = @{outputs('Get_Case')?['body/pas_flightno']}
     pas_starttime    = @{utcNow()}
     pas_tripstatus   = 'กำลังบริการ' (เลือกค่า choice)
     Case (lookup)    = /pas_wc_cases(@{triggerBody()?['caseId']})
     ```
   - **8d. Update a row — Case → ON_PROCESS**:
     `pas_status` = `ON_PROCESS` · `pas_pickuptime` = `@{coalesce(outputs('Get_Case')?['body/pas_pickuptime'], utcNow('HH:mm'))}`
   - **8e. Update a row — Queue**: List rows `pas_wc_queues` `$filter=_pas_staff_value eq ...` → Update แถวนั้น
     `pas_state` = `กำลังบริการ` · `pas_tripstoday` = `@{add(coalesce(item()?['pas_tripstoday'],0),1)}` · `pas_updatedat` = `@{utcNow()}`
   - **8f. Response 200**: `{ "ok": true, "mode": "started", "trip": "TRP-...", "wc": "<ShortNo>" }`

   **➤ If NO (เคสหยิบเอง → แค่รับทราบ):**
   - **Response 200**: `{ "ok": true, "mode": "ack_only", "msg": "รับทราบแล้ว กดเริ่มงาน + เลือกรถเข็น" }`

> วาง **Response** action ให้ status/ body ตรงทุกสาขา · เปิด trigger setting ให้ flow ตอบ sync (Response ภายใน ~2 นาที)

---

## 2) `wc-start` — เริ่มงาน (เฉพาะเคสหยิบเอง · พอตเตอร์เลือกรถเข็น)

### Request
```json
{ "caseId": "GUID", "staffId": "P076", "pin": "1234", "wheelchairControlNo": "WC-012", "apiKey": "xxxx" }
```
### Steps (ต่างจาก wc-ack ที่ wheelchair มาจาก request + ต้อง ack แล้ว)
1-3. ตรวจ API key · Get Staff · ตรวจ PIN+active  *(เหมือน wc-ack 1-3)*
4. **Get a row — Case** (id = caseId)
5. **Condition — ต้องรับทราบแล้ว**: `pas_acknowledged` = true · ไม่งั้น **409** `{ "error": "not_acknowledged" }`
6. **Condition — ยังไม่มี trip เปิดของเคสนี้**: List rows `pas_wc_trips` `$filter=_pas_case_value eq @{caseId} and pas_endtime eq null` → length = 0 (ไม่งั้น `409 already_started`)
7. **Get a row — Wheelchair**: List rows `pas_wheelchairs` `$filter=pas_controlno eq '@{triggerBody()?['wheelchairControlNo']}' and pas_isactive eq true` Top 1 (ไม่พบ → `400 bad_wc`)
8. **Condition — รถเข็นว่าง** (เหมือน 8a ของ wc-ack) · ใช้อยู่ → `409 wc_in_use`
9. **Add row pas_wc_trips** (เหมือน 8b/8c — Wheelchair = ตัวที่เลือก)
10. **Update Case** → `ON_PROCESS` + `pas_pickuptime` coalesce
11. **Update Queue** → `กำลังบริการ`, `pas_tripstoday`+1, `pas_updatedat`
12. **Response 200** `{ "ok": true, "trip": "TRP-...", "wc": "<ShortNo>" }`

---

## 3) `wc-end` — จบงาน

### Request
```json
{ "tripId": "GUID-ของ-pas_wc_trips", "staffId": "P076", "pin": "1234", "apiKey": "xxxx" }
```
### Steps
1-3. ตรวจ API key · Get Staff · ตรวจ PIN+active
4. **Get a row — Trip** (id = tripId) · Expand `Case($select=pas_caseid)`
5. **Condition — เป็น trip ของคนนี้ + ยังไม่จบ**: `_pas_staff_value` = Staff ของ staffId **AND** `pas_endtime eq null` · ไม่งั้น `403 not_your_trip` / `409 already_ended`
6. **Update row — Trip จบงาน**:
   `pas_endtime` = `@{utcNow()}` · `pas_durationmin` = `@{div(sub(ticks(utcNow()),ticks(outputs('Get_Trip')?['body/pas_starttime'])),600000000)}` · `pas_tripstatus` = `เสร็จสิ้น`
7. **Update row — Case → COMPLETED**: (id = `Get_Trip ... _pas_case_value`)
   `pas_status` = `COMPLETED` · `pas_delivertime` = `@{utcNow('HH:mm')}`
8. **Update row — Queue → ว่าง**: List rows `pas_wc_queues` `$filter=_pas_staff_value eq ...` → `pas_state` = `ว่าง` · `pas_updatedat` = `@{utcNow()}`
   > รถเข็นปลดล็อกอัตโนมัติเพราะ `pas_endtime` มีค่าแล้ว (filter "เปิด" ใช้ endtime = null)
9. **Response 200** `{ "ok": true, "durationMin": <n> }`

---

## 4) หน้า Power Pages เรียก flow (fetch)
```javascript
const WC = {
  ack:   "https://prod-xx.logic.azure.com:443/workflows/.../triggers/manual/paths/invoke?...sig=...",
  start: "https://.../wc-start...",
  end:   "https://.../wc-end..."
};
const API_KEY = "ใส่ค่าลับเดียวกับ wc_api_key";   // หรือดีกว่า: ให้เพจ proxy ผ่าน Power Pages Web API/same-site

async function call(url, payload){
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-wc-key": API_KEY },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if(!j.ok){ toast(ERR[j.error] || j.error); return null; }
  return j;
}
// ปุ่มรับทราบ
await call(WC.ack,   { caseId, staffId: me(), pin: pin() });
// ปุ่มเริ่ม (หยิบเอง)
await call(WC.start, { caseId, staffId: me(), pin: pin(), wheelchairControlNo: wc() });
// ปุ่มจบ
await call(WC.end,   { tripId, staffId: me(), pin: pin() });

const ERR = { unauthorized:"สิทธิ์ไม่ถูกต้อง", bad_pin:"PIN ไม่ถูกต้อง",
  not_your_case:"ไม่ใช่เคสของคุณ", already_done_or_ack:"เคสนี้รับทราบ/จบแล้ว",
  wc_in_use:"รถเข็นกำลังใช้งาน", not_acknowledged:"ต้องกดรับทราบก่อน",
  already_started:"เริ่มงานแล้ว", bad_wc:"ไม่พบรถเข็น", not_your_trip:"ไม่ใช่งานของคุณ",
  already_ended:"งานนี้จบแล้ว" };
```
> ปลอดภัยสุด: อย่าฝัง API key ใน JS ตรง ๆ — ให้เรียกผ่าน **Power Pages Web API / page ของ same-site** หรือตั้ง flow ตรวจ `Referer`/Power Pages token เพิ่ม ตามที่ IT รับได้

---

## 5) ตารางสรุป error → HTTP
| error | HTTP | ความหมาย |
|---|---|---|
| `unauthorized` | 401 | API key ไม่ตรง |
| `bad_pin` | 403 | PIN ผิด/คนไม่ active |
| `not_your_case` / `not_your_trip` | 403 | ไม่ใช่งานของคนนี้ |
| `already_done_or_ack` / `already_started` / `already_ended` | 409 | สถานะไม่ให้ทำซ้ำ (กันถอยหลัง) |
| `wc_in_use` | 409 | รถเข็นถูกใช้ (<12 ชม.) |
| `not_acknowledged` | 409 | ยังไม่รับทราบ |
| `bad_wc` | 400 | ไม่พบรถเข็น/ปิดใช้งาน |

## 6) เสริมความแน่น (แนะนำ)
- **กติกาซ้ำที่ Dataverse**: ทำ **real-time plug-in** หรือ **business rule** บน `pas_wc_cases`/`pas_wc_trips` (message Update) ให้กติกา (สถานะไม่ถอยหลัง · รถเข็นเริ่มซ้ำ) บังคับ **ทุก** ทางเขียน ไม่ว่าจะมาจาก flow/canvas/คนแก้มือ — flow กันที่ชั้นแอป, plug-in กันที่ชั้น DB
- **Concurrency**: รถเข็นถูกเริ่มพร้อมกัน 2 คน — plug-in ชั้น DB กันได้แน่กว่า flow (flow มี race เล็กน้อย) → ถ้าเคสนี้ critical ใช้ plug-in + alternate key `_pas_wheelchair_value + pas_endtime=null`
- ทางเลือกแทน HTTP flow: ทำเป็น **Dataverse Custom API** (unbound action) เรียกจาก Power Pages Web API — ได้สิทธิ์/ตรวจ web role ในตัว ไม่ต้องจัดการ SAS/secret เอง (เหมาะถ้าทีมถนัด dev)
