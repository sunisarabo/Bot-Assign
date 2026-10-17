# 33 · Copilot agent ช่วยงาน (Copilot Studio + Copilot ในแอป)

ผู้ช่วย AI ตอบคำถาม/ช่วยงานบนข้อมูล `pas_*` จริง — 2 ชั้น เลือกทำอย่างใดอย่างหนึ่งหรือทั้งคู่:
- **A · Copilot ในแอป (canvas)** — กล่องแชตในแอป ถาม-ตอบจากตาราง Dataverse ที่แอปใช้ (เร็วสุด เปิดใช้ได้เลย)
- **B · Copilot Studio agent** — เอเจนต์เต็ม วางใน Teams/เว็บ/แอป ground ด้วย Dataverse + เอกสารวิธีใช้ มี topic สั่งงานได้

> ⚠️ ผมสร้างในเทแนนต์ให้ไม่ได้ (ต้องคลิกใน copilotstudio.microsoft.com / make.powerapps.com) — นี่คือพิมพ์เขียว + prompt พร้อมวาง
> 🔒 Copilot เคารพ **Dataverse security + role** ของผู้ใช้ → USER ถามได้เฉพาะที่ตัวเองมีสิทธิ์เห็น (สอดคล้อง `31`/`32`)

---

## A · Copilot ในแอป (เปิดใช้เร็ว)
1. make.powerapps.com → เปิดแอป → **Settings → Upcoming/Features → Copilot component** (เปิด)
2. ลาก **Copilot control** วางบนหน้า (เช่น scrHome มุมขวา) → ตั้ง **Data source** = ตารางที่ให้ถาม: `PAS_Duty` · `PAS_Assignment` · `PAS_Flights` · `pas_wc_case` · `PAS_LeaveLog`
3. ผู้ใช้พิมพ์ถามเป็นภาษาไทยได้เลย เช่น
   - "วันนี้ทีม QR ใครเข้ากะดึกบ้าง" · "ไฟลท์ EK378 ใครลงงาน" · "เคสวีลแชร์ที่ยังไม่รับทราบมีกี่เคส" · "เดือนนี้ใครลาป่วยเกิน 3 วัน"
> เหมาะ "ถาม-อ่านข้อมูล" · สั่งแก้ (จ่ายงาน/อนุมัติ) ใช้ชั้น B หรือปุ่มในแอป

---

## B · Copilot Studio agent (เต็ม)

### 1) สร้าง agent
copilotstudio.microsoft.com → **+ New agent** → ชื่อ **"PAS Assistant"** · ภาษา **ไทย**

### 2) Instructions (วางเป็น system prompt — ปรับได้)
```
คุณคือผู้ช่วยระบบจัดกำลังพล PAS (PSA-HKT) ของ AOTGA ที่สนามบินภูเก็ต
ตอบเป็นภาษาไทย กระชับ ตรงประเด็น อ้างข้อมูลจาก Dataverse เท่านั้น (อย่าเดา)
บทบาทผู้ใช้: ADMIN/EDITOR เห็นทุกทีม · USER เห็นเฉพาะงานตัวเอง — เคารพสิทธิ์เสมอ
ถ้าไม่พบข้อมูลให้บอกว่าไม่พบ อย่าแต่งตัวเลข
หน่วยเวลา/กะ: M=เช้า A=บ่าย N=ดึก · OT คิดเป็นชั่วโมง · เพดาน OT ≤36 ชม./สัปดาห์, ทำงาน ≤48 ชม./สัปดาห์
เรื่องลา/OT: บอกยอดคงเหลือ/เพดานตามกฎ HR ได้ แต่การอนุมัติทำในแอปเท่านั้น
```

### 3) Knowledge (ground)
- **Dataverse tables:** `pas_duty` · `pas_assignment` · `pas_flight` · `pas_wc_case` · `pas_leavelog` · `pas_manpower` · `pas_employee`
- **เอกสารวิธีใช้ (ไฟล์/เว็บ):** อัปโหลด `hr-rules.md` · `README.md` (index) → ให้ตอบ "ทำยังไง/กฎคืออะไร" ได้

### 4) Topics ตัวอย่าง (trigger → action)
| Topic | ผู้ใช้พูด | ทำ |
|---|---|---|
| งานของฉันวันนี้ | "งานฉันวันนี้", "ฉันเข้ากะอะไร" | query `pas_duty`/`pas_assignment` ด้วย emp_code ของผู้ใช้ → สรุป |
| ตรวจกำลังพล | "วันนี้ทีม … ขาดไหม", "coverage QR" | query `pas_manpower`/`pas_duty` ต่อทีม/วัน |
| OT คงเหลือ | "OT ฉันสัปดาห์นี้", "ใคร OT เกิน" | รวม `pas_duty.ot_hours` เทียบเพดาน 36 |
| เคสวีลแชร์ | "เคสค้าง", "เคสของฉัน" | query `pas_wc_case` (STANDBY/ON_PROCESS) |
| วิธีใช้ | "ขอลายังไง", "แลกเวรกี่ครั้ง" | ตอบจาก knowledge (`hr-rules`) |

### 5) Actions สั่งงาน (ออปชัน — เฉพาะ EDITOR/ADMIN)
ผูก **Power Automate flow** เป็น action ให้ agent เรียก (ยืนยันก่อนทำเสมอ):
- "จ่ายเคสวีลแชร์ QR842 ให้ สมชาย" → flow มอบหมาย (เหมือน scrLP · ตั้ง ASSIGNED) — **ตรวจ role ใน flow** ว่าเป็น EDITOR/ADMIN
- "สร้างเคสจาก Pre-WC วันนี้" → flow `WC Build Cases` (ดู `wc-08`)
> action ที่ "เปลี่ยนข้อมูล" ต้องมีขั้น **ยืนยัน** + ตรวจสิทธิ์ใน flow (อย่าเชื่อ role จากข้อความผู้ใช้)

### 6) วางให้ใช้งาน
- **ในแอป:** ฝัง agent เป็น Copilot control / เปิดจากปุ่มบน scrHome
- **Teams:** publish → เพิ่มใน Teams ให้หัวหน้าทีมถาม-สั่งได้จากมือถือ
- **เว็บ:** ฝังในพอร์ทัล/Power Pages (พอตเตอร์ถาม "เคสฉัน" ได้)

## หมายเหตุ
- Copilot Studio / Copilot ในแอป ต้องเปิดสิทธิ์/ไลเซนส์ในเทแนนต์ (เช็กกับ IT) · มีการนับ message ต่อเดือน
- เริ่มที่ **A (ในแอป)** พิสูจน์ว่าช่วยงานจริงก่อน แล้วค่อยขยายเป็น **B** พร้อม actions
- ทุก action ที่เขียนข้อมูล = ให้กติกาอยู่หลังบ้าน (flow/plug-in `wc-07`) เหมือนเดิม agent เป็นแค่ "หน้าสั่ง"
