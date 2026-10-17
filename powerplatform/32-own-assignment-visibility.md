# 32 · USER เห็น assignment เฉพาะของตัวเอง + พอตเตอร์ "รับงาน" ที่งานของฉัน

2 กติกาตามที่ขอ:
1. **USER เห็น assignment เฉพาะของตัวเอง** · EDITOR/ADMIN เห็นหมด
2. **พอตเตอร์ "รับงาน" ย้ายมารวมที่ `scrMe` (งานของฉัน)** — กดรับทราบในนั้น · `scrLP` เหลือเฉพาะ LP จ่ายงาน

---

## 1 · เห็นเฉพาะของตัวเอง (scrAssign)

หลัก: ถ้า **ไม่ใช่สิทธิ์แก้** (`!varPriv` = USER) → กรองทุก collection ให้เหลือ `emp_code = varMyCode`
EDITOR/ADMIN (`varPriv`) → เห็นทั้งทีมเหมือนเดิม

แก้ที่ **btnALoad.OnSelect** ของ scrAssign — เติมเงื่อนไข `emp_code` ตาม `varPriv`:
```powerapps
// เดิม:  ClearCollect(colADuty, Filter(PAS_Duty, day_key = varAKey, team = varAT)),
//        ClearCollect(colAAsg,  Filter(PAS_Assignment, day_key = varAKey, team = varAT)),
// ใหม่ (USER เห็นเฉพาะตัวเอง):
ClearCollect(colADuty, Filter(PAS_Duty, day_key = varAKey, team = varAT, (varPriv || emp_code = varMyCode))),
ClearCollect(colAAsg,  Filter(PAS_Assignment, day_key = varAKey, team = varAT, (varPriv || emp_code = varMyCode))),
```
> galleries ที่อ่านจาก colADuty/colAAsg จะเหลือเฉพาะของ USER เอง · ปุ่มแก้ยังถูก gate ด้วย `varPriv` อยู่แล้ว (`27` A-3) → USER ดูได้ แก้ไม่ได้
> ใช้แพทเทิร์นเดียวกันกับหน้าอื่นที่อยากจำกัด (เช่น ถ้าต้องการให้ roster ก็เห็นเฉพาะแถวตัวเอง — แต่ roster เป็นภาพรวมทีม ปกติให้ดูทั้งทีม)

**เลือกทีม/วัน:** USER ปกติดูทีมตัวเอง → ตั้ง default `ddATeam` = `varMyTeam`:
```powerapps
ddATeam.Default = =Coalesce(varMyTeam, First(colAAir).team)
// ถ้าอยากล็อกไม่ให้ USER เปลี่ยนทีม:
ddATeam.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
```

> หน้า **scrMe** เห็นเฉพาะของตัวเองอยู่แล้ว (filter `emp_code = varMyCode`) → เป็นช่องทางหลักของ USER

---

## 2 · พอตเตอร์ "รับงาน" ที่ scrMe (ไม่ใช่หน้าแยก)

**เดิม:** พอตเตอร์รับเคสที่หน้า porter แยก (`wc-03`) · **ใหม่:** รวมที่ `scrMe` แท็บ **"งานวีลแชร์"**
- `scrMe` โหลด `colMeWC` = เคสวีลแชร์ที่มอบให้คนนี้ (จาก `pas_wc_caseporters` ของ `varMyCode`) วันนี้
- ปุ่ม **"รับเคส/รับทราบ"**: เซ็ต `pas_acknowledged` · ถ้าเป็นเคส LP จ่าย (มี `pas_assigned_wc`) → เริ่ม trip ด้วยรถเข็นที่ LP จองไว้ (ตรรกะเดียวกับ `wc-03` §3)
- `scrLP` = **LP จ่ายงานอย่างเดียว** (ตาม `wc-02`) — ส่วน "พอตเตอร์กดรับทราบ" อยู่ที่ scrMe

> ธง/คอลัมน์เหมือนเดิม: `pas_wc_cases.pas_acknowledged/pas_ack_at/pas_ack_by/pas_assigned_wc` · `pas_wc_trips` · ดู `wc-02`/`wc-03`
> โปรดักชันแนะนำให้ปุ่มรับทราบ WC เรียก **Custom API/flow** (`wc-06`/`wc-07`) เพื่อบังคับกติกา (รถเข็นไม่ซ้ำ/สถานะไม่ถอย) ฝั่งเซิร์ฟเวอร์ แทน Patch ตรงในแอป

### การ์ดบนเมนู (scrHome)
- tile `lpp` (♿ LP จ่ายงาน Porter) → `scrLP` · ให้ **needEdit:true** (เฉพาะ LP = EDITOR/ADMIN) ถ้าต้องการให้เฉพาะ LP เห็น
  ```
  // ใน colHMenu แถว lpp: เปลี่ยน needEdit: false → true (LP จ่ายงาน = สิทธิ์แก้)
  ```
- พอตเตอร์ (USER) เข้า **การ์ด "งานของฉัน" (scrMe)** → แท็บงานวีลแชร์ รับเคสเอง
