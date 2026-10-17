# WC/Porter · 04 · หน้าพอตเตอร์บนมือถือส่วนตัว (Power Pages · ไม่ล็อกอิน) + กติกาหลังบ้าน

พอตเตอร์ ~76 คน **ไม่มีบัญชี M365 + เปิดบนมือถือตัวเอง** → canvas app ใช้ไม่ได้ (บังคับ login Entra + license ต่อคน)
ทางที่ "รวมอยู่ใน PAS" ได้จริง = **Power Pages** (เว็บ anonymous) ที่อ่าน/เขียน **Dataverse `pas_wc_*` ชุดเดียวกับ PAS**

> สรุป: **ข้อมูลระบบเดียว** (Dataverse เดียว, ตาราง `pas_wc_*` เดียว) · ต่างแค่ "หน้าจอพอตเตอร์" เป็นเว็บลิงก์ ไม่ใช่สกรีนในแคนวาส
> LP/ซุปยังใช้ PAS canvas (`wc-02`) · พอตเตอร์เปิดลิงก์ Power Pages (`wc-04`) · เห็นเคส/รับทราบ/เริ่ม/จบ ตารางเดียวกัน realtime

## ทำไมต้อง Power Pages (ไม่ใช่สกรีนในแคนวาส)
| | Canvas app (PAS) | Power Pages |
|---|---|---|
| เปิดโดยไม่ล็อกอิน | ❌ ต้อง Entra login ทุกครั้ง | ✅ หน้า anonymous เปิดด้วยลิงก์ |
| License ต่อผู้ใช้ | ต้อง Power Apps per-user/คน | นับ **anonymous page view** (capacity) ไม่ผูกคน |
| มือถือส่วนตัว ~76 คน | ไม่คุ้ม/ตั้งบัญชีไม่ไหว | ✅ เหมาะ |
| ข้อมูล Dataverse `pas_wc_*` | เดียวกัน | **เดียวกัน** |

> ⚠️ Power Pages ต้องเปิดสิทธิ์ใช้งาน (capacity/licensing) ใน tenant — เช็กกับ IT/ตัวแทน Microsoft เรื่อง anonymous page-view capacity ก่อน

---

## 1) สร้างไซต์ + ตารางสิทธิ์ (Table Permissions)
1. make.powerpages.microsoft.com → **+ New site** (template เปล่า) ใน environment เดียวกับ PAS
2. **Web role: "Porter (anonymous)"** ผูกกับ **Anonymous Users**
3. **Table Permissions** (แคบที่สุด — anonymous เขียน Dataverse ตรง ๆ อันตราย ให้เปิดเฉพาะที่จำเป็น):

| ตาราง | สิทธิ์ | Scope | หมายเหตุ |
|---|---|---|---|
| `pas_wc_staffs` | **Read** | Global | ให้เลือกชื่อตัวตน (เปิดเฉพาะคอลัมน์ NickTh/StaffId/IsActive) |
| `pas_wc_cases` | **Read** | Global | เห็นเคสวันนี้ (กรองฝั่งเพจ) |
| `pas_wc_caseporters` | **Read** | Global | หาเคสของตัวเอง |
| `pas_wheelchairs` | **Read** | Global | รายการรถเข็นว่าง |
| `pas_wc_trips` | **Read** | Global | เช็กรถเข็น/งานตัวเอง |
| **การเขียนทุกอย่าง** (รับทราบ/เริ่ม/จบ) | **ไม่ให้เขียนตรง** | — | ส่งผ่าน **Power Automate** แทน (ข้อ 3) |

> หลักการ: anonymous = **อ่านได้ เขียนไม่ได้โดยตรง** → ทุกการเปลี่ยนสถานะยิงเข้า **flow** ที่บังคับกติกา/ตรวจสิทธิ์เอง (กัน client ปลอมค่า)

## 2) เลือกตัวตน (ไม่ล็อกอิน) + หน้าเคสของฉัน
- หน้าแรก: dropdown/ค้นชื่อจาก `pas_wc_staffs` (Read) → เก็บ `StaffId` ไว้ใน `localStorage` (จำเครื่อง)
- (ถ้าต้องการกันสวมรอย) เพิ่ม **PIN 4 หลัก/คน** ในคอลัมน์ `pas_pin` → ตรวจตอนเลือกชื่อ
- หน้า "เคสของฉัน": เรียก Dataverse **Web API** (อ่าน) กรอง caseporter ของ StaffId + วันนี้ + สถานะเปิด

```javascript
// Power Pages: อ่านเคสของฉัน (anonymous, read-only)
const sid = localStorage.getItem("porterStaffId");
const today = new Date().toISOString().slice(0,10);
const r = await fetch(
  `/_api/pas_wc_caseporters?$filter=_pas_staff_value eq ${sid} and Microsoft.Dynamics.CRM.On(PropertyName='pas_assignedat',PropertyValue='${today}')`
  + `&$expand=pas_case($select=pas_flightno,pas_gate,statuscode,pas_acknowledged,_pas_assigned_wc_value)`,
  { headers: { "Accept": "application/json" } }
).then(x => x.json());
// render การ์ดเคส + ปุ่ม รับทราบ/เริ่ม/จบ · แบนเนอร์ "ยังไม่รับทราบ" เมื่อ pas_acknowledged != true
```
> โพลซ้ำทุก 15 วิ (setInterval) ให้เหมือน Timer ใน wc-03 · เคสใหม่ที่ยังไม่รับทราบ → แจ้งเตือนในหน้า + เสียง

## 3) รับทราบ / เริ่ม / จบ — ยิงผ่าน Power Automate (บังคับกติกาหลังบ้าน)
anonymous เขียน Dataverse ตรงไม่ได้ → แต่ละปุ่มเรียก **flow (HTTP trigger)** ที่ทำงานด้วยสิทธิ์ service แล้วบังคับกติกาเอง

```javascript
// ปุ่ม "รับทราบ" (เคส LP จ่าย = รับทราบแล้วเริ่มเลยด้วยรถเข็นที่ LP จองไว้)
async function ackCase(caseId){
  await fetch(FLOW_ACK_URL, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ caseId, staffId: localStorage.getItem("porterStaffId"), pin: getPin() })
  });
}
```

> 📄 **flow 3 ตัวแบบ step-by-step ละเอียด** (ทุก action, OData filter, expression, request/response, error→HTTP) อยู่ที่ **`wc-05-porter-flows.md`**

**Flow `wc-ack` (HTTP → Dataverse)** ทำ server-side ตาม `wc-03` §3 ทุกข้อ:
1. ตรวจ `staffId` + PIN ตรง · caseporter ของเคสนี้เป็นของ staffId จริง (กันรับแทนคนอื่น)
2. เคสยังไม่ `COMPLETED/CANCELLED` · ยังไม่ `pas_acknowledged`
3. set `pas_acknowledged=true, pas_ack_at=utcNow(), pas_ack_by=staffId`
4. ถ้ามี `pas_assigned_wc` (LP จ่าย): เช็กรถเข็นยังว่าง (ไม่มี trip เปิด <12 ชม.) → สร้าง `pas_wc_trips` (StartTime=now, กำลังบริการ) + เคส `ON_PROCESS` + คิว `กำลังบริการ`, TripsToday+1
5. ถ้าไม่มี `pas_assigned_wc` (หยิบเอง): แค่ ack → รอปุ่ม "เริ่มงาน" (flow `wc-start` รับ `wheelchairControlNo`)

**Flow `wc-start`** / **`wc-end`** = ย้าย logic ปุ่ม `btnStart`/`btnMyEnd` จาก `wc-03` มาเป็น server-side (ตรวจรถเข็นซ้ำ, Coalesce PickupTime, set EndTime/DurationMin/COMPLETED/DeliverTime)

> ✅ ปุ่มบนหน้าเว็บซ่อน/ปิดได้ แต่ **กติกาจริงอยู่ที่ flow** → client ปลอมค่าก็ไม่ผ่าน (ตรงข้อเตือน wc-03 §⚠️)

## 4) กติกาที่ต้องอยู่ "หลังบ้าน" (plug-in / flow / business rule)
เพราะพอตเตอร์เป็น surface แยกที่แตะตารางเดียวกับ LP — ซ่อนปุ่มในหน้าเว็บอย่างเดียวไม่พอ:

| กติกา | บังคับที่ |
|---|---|
| รับเคส/เริ่มได้เฉพาะเคสตัวเอง | flow ตรวจ caseporter.Staff = staffId |
| ต้องรับทราบก่อนเริ่ม | flow `wc-start` เช็ก `pas_acknowledged=true` |
| รถเข็นใช้อยู่ เริ่มซ้ำไม่ได้ | flow เช็ก trip เปิด <12 ชม. ของ ControlNo |
| สถานะไม่ถอยหลัง | flow เช็ก `statuscode` ก่อน patch |
| ไม่เขียนทับเวลาที่กรอก | flow `Coalesce(PickupTime,…)` |
| ปิดงานค้าง >12 ชม. เฉพาะ LP | พอตเตอร์ไม่มีปุ่มนี้ (อยู่ `wc-02`) |
| กันสวมรอยคนอื่น | PIN + ตรวจ staffId ใน flow |

> ทำเป็น **real-time plug-in** บน Dataverse (message Update ของ `pas_wc_cases`/`pas_wc_trips`) จะกันได้แน่นสุด ไม่ว่าจะมาจาก canvas/Power Pages/flow

## 5) แจ้งเตือน (ตามที่ขอ "ค ทั้งสอง")
- **In-page**: โพล 15 วิ (ข้อ 2) → เคสใหม่ยังไม่รับทราบ เด้งแจ้งเตือน + เสียง
- **LINE เข้ากลุ่มทีม** (เผื่อไม่ได้เปิดเว็บ): flow ส่ง LINE push เมื่อ `pas_wc_cases` ถูกมอบหมาย (Status=`ASSIGNED`) — ดู `18-notify-steps.md` ส่วนที่ 2

---

## เทียบ wc-03 ↔ wc-04 (เลือกตามอุปกรณ์)
| | `wc-03` (canvas) | `wc-04` (Power Pages) |
|---|---|---|
| อุปกรณ์ | จอรวม/คีออสก์ (บัญชีเดียวล็อกอิน) | มือถือส่วนตัวพอตเตอร์ (ไม่ล็อกอิน) |
| เขียนข้อมูล | Power Fx Patch ตรง | ผ่าน flow (anonymous เขียนตรงไม่ได้) |
| กติกา | ย้ำใน Patch + plug-in หลังบ้าน | **บังคับใน flow/plug-in เป็นหลัก** |
| ข้อมูล | `pas_wc_*` เดียวกับ PAS | `pas_wc_*` เดียวกับ PAS |

> เลือกทางเดียว หรือทำทั้งคู่ก็ได้ (คีออสก์หน้างาน + มือถือส่วนตัว) — Dataverse ชุดเดียว เห็นตรงกัน realtime
