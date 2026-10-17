# WC/Porter · 06 · Dataverse Custom API (ไม่ต้องมี SAS/secret ในหน้าเว็บ)

ทางที่ปลอดภัย/สะอาดกว่า HTTP flow (`wc-05`) = ทำ **Custom API 3 ตัว** (unbound action) ที่ logic อยู่ใน **plug-in** (`wc-07`)
Power Pages / canvas / flow เรียกได้หมด · **ไม่มี key ลับในหน้าเว็บ** · สิทธิ์คุมด้วย web role + Execute Privilege

| HTTP flow (`wc-05`) | Custom API (`wc-06` + `wc-07`) |
|---|---|
| ต้องฝัง SAS URL/secret ในเพจ | ✅ เรียกผ่าน Web API ของ portal (auth ในตัว) |
| logic ใน flow (มี race เล็กน้อย) | ✅ logic ใน plug-in (ทรานแซกชันเดียว กัน race ได้) |
| กันกติกาเฉพาะทางที่เรียก flow | ✅ + guard plug-in บน Update กันทุกทางเขียน (`wc-07` ตอนที่ 2) |
| สร้างเร็ว ไม่ต้องเขียนโค้ด | ต้อง build/register plug-in (.NET) |

> เลือกทางเดียวพอ: ทีมไม่เขียนโค้ด → `wc-05` · ทีมมี dev/อยากแน่น → `wc-06`+`wc-07` (แนะนำ)

---

## 1) สร้าง Custom API 3 ตัว
make.powerapps.com → ใน **solution** เดียวกับ `pas_wc_*` → **New → More → Other → Custom API**
(หรือสร้างแถวในตาราง **Custom API / Custom API Request Parameter / Custom API Response Property** ตรง ๆ)

ตั้งค่าร่วมทั้ง 3 ตัว:
- **Binding Type** = `Global` (unbound)
- **Is Function** = No (เป็น action / POST)
- **Allowed Custom Processing Step Type** = `Async and Sync`
- **Enabled for Workflow** = No
- **Execute Privilege Name** = (ออปชัน) สร้าง privilege เฉพาะ แล้วให้ web role พอตเตอร์ถือ — กันคนนอกเรียก
- **Plugin Type** = ผูกกับ plug-in ใน `wc-07` (ทำหลัง register assembly)

### 1.1 `pas_PorterAck` — รับทราบ (+ เริ่มถ้า LP จองรถเข็นไว้)
| Request params (Unique name) | Type | Required |
|---|---|---|
| `CaseId` | String | Yes |
| `StaffId` | String | Yes |
| `Pin` | String | Yes |

| Response properties | Type |
|---|---|
| `Ok` | Boolean |
| `Mode` | String (`started` / `ack_only`) |
| `TripId` | String |
| `Wc` | String |
| `Message` | String |

### 1.2 `pas_PorterStart` — เริ่มงาน (เคสหยิบเอง)
Request: `CaseId`(String), `StaffId`(String), `Pin`(String), `WheelchairControlNo`(String)
Response: `Ok`(Boolean), `TripId`(String), `Wc`(String), `Message`(String)

### 1.3 `pas_PorterEnd` — จบงาน
Request: `TripId`(String), `StaffId`(String), `Pin`(String)
Response: `Ok`(Boolean), `DurationMin`(Integer), `Message`(String)

> ชื่อ action ที่เรียกจริง = **Unique Name** (ใส่ publisher prefix เช่น `pas_PorterAck`)

---

## 2) สิทธิ์ให้พอตเตอร์ (anonymous) เรียกได้ แต่เขียนตรงไม่ได้
- **Table Permissions** (Power Pages) ของ web role "Porter": ให้ `pas_wc_*` = **Read** เท่านั้น (เหมือน `wc-04` ข้อ 1) — **ไม่ต้องให้ Create/Write**
- การเขียนทั้งหมดเกิด **ใน plug-in** ที่รันด้วย **SYSTEM user** (ดู `wc-07` — `CreateOrganizationService(null)`) → caller ไม่ต้องมีสิทธิ์เขียนเอง
- ถ้าตั้ง **Execute Privilege Name**: สร้าง privilege แล้วเพิ่มเข้า web role เพื่อให้ **เฉพาะ** โหลดจาก portal เรียก action นี้ได้
- **ตัวตน/กันสวมรอย** ยังทำใน plug-in: ตรวจ `StaffId`+`Pin` เทียบ `pas_wc_staffs.pas_pin` (portal anonymous ไม่มี identity จริง)

---

## 3) เรียก Custom API จาก Power Pages (Web API — ไม่มี secret)
Power Pages Web API เรียก unbound action ได้ที่ `/_api/<UniqueName>` (ต้องเปิด **Site Setting** `Webapi/<table>/enabled`=true สำหรับตารางที่เกี่ยว + `Webapi/customapi` ตามเวอร์ชันไซต์)

```javascript
// ต้องแนบ __RequestVerificationToken ของ portal (อ่านจาก shell)
async function token(){
  return (await fetch("/_services/auth/token")).text().catch(()=>  // บางไซต์:
    document.querySelector('[name="__RequestVerificationToken"]')?.value);
}
async function callApi(name, payload){
  const r = await fetch(`/_api/${name}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Accept":"application/json",
              "__RequestVerificationToken": await token() },
    body: JSON.stringify(payload)
  });
  const j = r.status===204 ? {} : await r.json();
  if(!r.ok || j.Ok===false){ toast(ERR[j.Message]||j.Message||"error"); return null; }
  return j;   // { Ok:true, Mode:"started", TripId:"...", Wc:"...", Message:"" }
}
// ปุ่ม
await callApi("pas_PorterAck",   { CaseId, StaffId: me(), Pin: pin() });
await callApi("pas_PorterStart", { CaseId, StaffId: me(), Pin: pin(), WheelchairControlNo: wc() });
await callApi("pas_PorterEnd",   { TripId, StaffId: me(), Pin: pin() });
```
> ถ้าเวอร์ชัน Power Pages ของคุณยัง **เรียก Custom API ผ่าน Web API ไม่ได้** → ใช้ **flow บาง ๆ** 1 ตัวเป็น passthrough: HTTP trigger → **Perform an unbound action** (เรียก `pas_PorterAck`) → Response · logic ยังอยู่ใน plug-in (flow แค่ relay ไม่มีกติกา) · วิธีนี้ยังดีกว่า `wc-05` เพราะกติกาอยู่ชั้น DB

### เรียกจาก canvas (จอรวม `wc-03`) ก็ชุดเดียวกัน
```powerapps
// ติด connector Dataverse → Environment() → ใช้ "Perform an unbound action" ไม่ได้ตรง ๆ ใน Power Fx
// ใช้ผ่าน flow "Perform an unbound action" หรือเรียก plug-in ผ่าน Patch ที่ trigger guard (wc-07 ตอน 2)
```

---

## 4) การคืนค่า error (plug-in โยน `InvalidPluginExecutionException`)
plug-in โยน exception พร้อมข้อความโค้ด (เช่น `bad_pin`) → Web API ได้ **HTTP 4xx/5xx** + ข้อความใน body
หน้าเพจ map ด้วยตาราง `ERR` เดียวกับ `wc-05` §4/§5

| โค้ด (Message) | ความหมาย |
|---|---|
| `unauthorized` `bad_pin` | key/PIN/ตัวตนไม่ผ่าน |
| `not_your_case` `not_your_trip` | ไม่ใช่งานของคนนี้ |
| `already_done_or_ack` `already_started` `already_ended` | สถานะไม่ให้ทำซ้ำ |
| `wc_in_use` | รถเข็นถูกใช้ (<12 ชม.) |
| `not_acknowledged` | ยังไม่รับทราบ |
| `bad_wc` | ไม่พบรถเข็น |

> โค้ด C# ของทั้ง 3 action + guard plug-in (ครบทั้งไฟล์ เอาไป build/register ได้เลย) อยู่ที่ **`wc-07-porter-plugin.md`**
