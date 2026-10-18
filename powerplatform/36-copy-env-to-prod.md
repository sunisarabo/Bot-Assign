# 36 · วงจร ทดสอบ → ขึ้น Production (Copy env / สำเนา SharePoint)

> ⚠️ สำคัญ: แอปใช้ **SharePoint list** เป็นที่เก็บข้อมูล → **"Copy environment" โคลนแค่แอป+flow ไม่โคลนข้อมูล SharePoint** · แอปที่โคลนยังชี้ลิสต์เดิม (= เขียนของจริง!) · การแยกต้องทำที่ **SharePoint** ด้วย
> ฉะนั้นใช้ **เส้นทาง A (SharePoint)** เป็นหลัก · เส้นทาง B (Dataverse solution) ไว้ใช้ถ้าวันหน้าย้ายข้อมูลเข้า Dataverse

---

## A · แอปบน SharePoint list (ของจริงตอนนี้)

### A1. เตรียม "ที่เก็บทดสอบ" = ไซต์ทดสอบ (ลิสต์ชื่อเดิม)
สร้าง **SharePoint site ใหม่** เช่น `PAS-TEST` แล้วทำลิสต์ **ชื่อเหมือน prod เป๊ะ**: `PAS_Porter` · `PAS_Assignment` · `PAS_Duty` · `PAS_Users` · `PAS_Flights` · `PAS_Pins` ฯลฯ
- โครงคอลัมน์เหมือนกัน (export/import หรือ Save list as template จาก prod → สร้างในไซต์ทดสอบ)
- ใส่ **ข้อมูลตัวอย่างบางส่วน** (ไม่กี่วัน/ไม่กี่คน · ใช้ชื่อ-รหัสทดสอบ ไม่ปนคนจริง — PDPA)
> ชื่อลิสต์เหมือนเดิม + คนละไซต์ = ตอนสลับ connection สูตรในแอปไม่ต้องแก้ (อ้างด้วยชื่อลิสต์)

### A2. สำเนาแอป
Power Apps → แอป → **Save As** → `PAS (TEST)` (หรือ **Export .msapp** แล้ว import เป็นแอปใหม่)

### A3. ชี้ connection ของ PAS (TEST) ไปไซต์ทดสอบ
ใน PAS (TEST): แท็บ **Data** → แต่ละ SharePoint data source → **remove** ตัวที่ชี้ไซต์ prod → **Add data** เลือก **ไซต์ `PAS-TEST`** → ลิสต์ชื่อเดียวกัน
- เพราะชื่อลิสต์ตรง สูตรไม่พัง · ตรวจหน้า Data ว่าทุก source ชี้ `PAS-TEST` แล้ว

### A4. สำเนา flow สำหรับทดสอบ
flow ที่ **เขียนข้อมูล** (WC rules, build-cases, import, แจ้งเตือน) → **Save As** เป็นเวอร์ชันทดสอบ → แก้ step SharePoint ให้ชี้ไซต์ `PAS-TEST`
- **ปิดการแจ้งเตือนจริง** (LINE/เมล) ในเวอร์ชันทดสอบ หรือส่งเข้ากลุ่มทดสอบ
- flow เดิมของ prod **ปล่อยไว้** (ยังยิงของจริง) — อย่าให้ flow ทดสอบกับ prod ชนไซต์เดียวกัน

### A5. ทดสอบ
แชร์ `PAS (TEST)` + บัญชีทดสอบ (Kiosk ทดสอบ, พนักงาน/พอตเตอร์ `TEST`) → ลองทุก flow งาน (จ่ายงาน→รับทราบ→เริ่ม→จบ, roster, assign, OT) บนมือถือจริง
- เขียนอะไรก็ลง `PAS-TEST` เท่านั้น → **ของจริงไม่กระทบ**

### A6. ขึ้น Production (เอาที่ทดสอบผ่านไปใช้จริง)
เพราะข้อมูลของจริงอยู่ที่ไซต์ prod อยู่แล้ว ต้องเอา **"ตัวแอป/flow"** ที่ปรับแล้วไปทับ prod:
1. **Backup ก่อน:** ใน prod แอป Power Apps เก็บ **version history** อยู่แล้ว (restore ได้) · export .msapp เก็บไว้ 1 ชุด
2. วิธีเอาขึ้น (เลือกทาง)
   - **(แนะนำ) แก้ซ้ำในแอป prod:** ดูการเปลี่ยนที่ทดสอบผ่าน แล้วทำ**ซ้ำทีละจุด**ในแอป prod (ชี้ไซต์ prod อยู่แล้ว) → Publish · ปลอดภัย คุมได้
   - **(เร็วกว่า แต่ระวัง) สลับ connection ของ PAS (TEST) กลับไซต์ prod:** Data → remove `PAS-TEST` → Add ไซต์ prod (ลิสต์ชื่อเดิม สูตรไม่พัง) → ตรวจทุก source → **Save/Publish ทับแอป prod** (หรือ Save As เป็น prod ใหม่แล้วแชร์แทนตัวเดิม)
     - ⚠️ ต้องแน่ใจว่า **ไม่เหลือ** source/flow ไหนชี้ `PAS-TEST` · ตรวจหน้า Data + flow ทุกตัวก่อน publish
3. **flow:** เอา logic ที่แก้ไปใส่ flow prod (ชี้ไซต์ prod) แล้วเปิดใช้ · เปิดแจ้งเตือนจริงกลับ
4. ทำ **นอกเวลาพีค** · เปิดให้ **บางทีมก่อน (pilot)** แล้วขยาย

### A7. เก็บกวาด
ปิด/ลบ `PAS (TEST)` + ไซต์ `PAS-TEST` + flow ทดสอบ เมื่อไม่ใช้ (กันเผลอเขียน/สับสน)

---

## B · ถ้าย้ายข้อมูลเข้า Dataverse แล้ว (ALM เต็ม — คลีนสุด)
1. **Copy environment:** admin center → Environments → **Copy** (Production → Sandbox `PAS-DEV`) = โคลนแอป+ตาราง+ข้อมูลครบ → ทดสอบอิสระ
2. จัดทุกอย่างใน **Solution เดียว** (แอป, flow, ตาราง, choice) · ใช้ **Environment variables** กับ **Connection references** (ไม่ hardcode)
3. ทดสอบใน `PAS-DEV`
4. **Export managed solution** จาก DEV → **Import** เข้า Production (ตั้งค่า env var/connection ตอน import) → Publish
5. ย้อนได้ด้วย env **Backup/Restore** (admin center) · solution เวอร์ชันเก่า import ทับได้

| | SharePoint (A) | Dataverse (B) |
|---|---|---|
| ข้อมูลทดสอบแยก | ไซต์ `PAS-TEST` (ทำเอง) | Copy environment (อัตโนมัติ) |
| เอาขึ้น prod | แก้ซ้ำ/สลับ connection + publish | Import managed solution |
| ย้อนกลับ | Version history / .msapp | Env backup / solution เก่า |
| ความคลีน | ปานกลาง (ดูแล connection) | สูง (ALM มาตรฐาน) |

---

## เช็กลิสต์ย่อ
- [ ] ลิสต์ทดสอบ **ชื่อเดียวกับ prod** แต่คนละไซต์ (สูตรไม่ต้องแก้)
- [ ] PAS (TEST) + flow ทดสอบ ชี้ `PAS-TEST` ครบทุก source (เปิดหน้า Data ตรวจ)
- [ ] ปิดแจ้งเตือนจริงในเวอร์ชันทดสอบ · ข้อมูลตัวอย่างไม่ปนคนจริง
- [ ] ก่อน publish prod: backup (version/.msapp) + ไม่มี source ค้างที่ `PAS-TEST`
- [ ] ขึ้น prod นอกพีค + pilot ทีละทีม
