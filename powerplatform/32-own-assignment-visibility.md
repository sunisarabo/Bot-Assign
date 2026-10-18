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

## 2 · พอตเตอร์ "รับงาน" ที่ `scrLP` โหมด porter (ตามที่ build จริง)

**หน้าเดียว 2 โหมด** คุมด้วย `varLPMode`:
- **`varLPMode = "lp"`** (ค่าปริยาย เข้าจากเมนู) = LP จ่ายงาน (คิว + เคส STANDBY + มอบหมาย) · gate `varPriv`
- **`varLPMode = "porter"`** = พอตเตอร์ดูเคสของตัวเอง + กดรับทราบ · ไม่ต้อง `varPriv` (Kiosk/Viewer เข้าได้)

**ทางเข้าโหมด porter:** หน้า `scrSignIn` ปุ่ม **"♿ โหมดพอตเตอร์ (รับงาน LP)"** → `Set(varLPMode, "porter"); Navigate(scrLP)`
(เครื่องกลางเลือกชื่อ+PIN ก่อน แล้วเข้าโหมดพอตเตอร์)

ในโหมด porter (`scrLP`) — **ของจริงใช้ `PAS_Porter` (lp_*)**, ระบุตัวด้วยชื่อ `varLPMe` (emp_name):
- โหลดเคสของพอตเตอร์วันนี้จาก `PAS_Porter` (filter `day_key = วันนี้` + `lp_porter = varLPMe`)
- ปุ่ม **"รับเคส/รับทราบ"**: `Patch(PAS_Porter, …, { lp_state: "ACK", lp_ack_at: Now() })` · เริ่ม→ON_PROCESS+pickup_at · จบ→DONE+delivered_at (ดู `wc-11`)
- กลับ/ออก: `varLPMode="porter"` → ปุ่ม 🔒 ออก กลับ `scrSignIn`

> **ดึงเข้า "งานของฉัน" (scrMe) ให้แม่น:** เพิ่ม `PAS_Porter.lp_porter_code` (เขียน emp_code ตอนจ่ายงาน) แล้ว scrMe filter `lp_porter_code = varMyCode` — ดู `wc-11` §1 · ของจริงใช้ `PAS_Porter` ไม่ใช่ `pas_wc_*`

### การ์ดบนเมนู (scrHome)
- tile `lpp` (♿ LP จ่ายงาน Porter) → `scrLP` (โหมด lp) · `needEdit:true` → เห็นเฉพาะ LP (Supervisor/Duty/Admin)
- พอตเตอร์ (ไม่มี M365) ไม่เข้าทางเมนู — เข้าผ่าน `scrSignIn` → ปุ่มโหมดพอตเตอร์ → `scrLP` porter

> ส่วน **`scrMe`** = งานไฟลท์/กิจกรรมของตัวเอง + รับทราบ (ไม่รวมเคสวีลแชร์แล้ว) — เคสวีลแชร์อยู่ที่ scrLP porter
