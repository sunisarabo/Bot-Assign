# 32 · ขอบเขตการเห็น assignment (ทีมตัวเอง) + พอตเตอร์ "รับงาน"

2 กติกาตามที่ขอ:
1. **USER เห็น assignment ทั้งทีมของตัวเองในวันนั้น** (เพื่อนในทีม · คนทำไฟลท์เดียวกัน · ภาพรวมทีม) แต่ **เห็นเฉพาะทีมตัวเอง** · EDITOR/ADMIN เห็นทุกทีม
2. **พอตเตอร์ "รับงาน" ที่ `scrLP` โหมด porter** — กดรับทราบในนั้น · `scrLP` lp = LP จ่ายงาน

---

## 1 · USER เห็น "ทั้งทีมของตัวเอง" (scrAssign)

หลัก: USER ดู assignment **ทั้งทีมของตัวเอง** ได้ (เห็นเพื่อนร่วมทีม + คนทำไฟลท์เดียวกัน + ภาพรวมทีมวันนั้น) — จำกัดแค่ **ล็อกทีมไว้ที่ทีมตัวเอง** (เปลี่ยนไปทีมอื่นไม่ได้) · ส่วนปุ่ม **แก้ไข** ยังปิดสำหรับ USER (gate `varPriv`)

### 1.1 ไม่ต้องกรองรายคน — colADuty/colAAsg โหลดทั้งทีมเหมือนเดิม
```powerapps
// คงเดิม (กรองตามทีมที่เลือก = เห็นทั้งทีม) — ไม่ต้องเติม emp_code = varMyCode
ClearCollect(colADuty, Filter(PAS_Duty, day_key = varAKey, team = varAT)),
ClearCollect(colAAsg,  Filter(PAS_Assignment, day_key = varAKey, team = varAT)),
```
> USER จึงเห็นงานของทุกคนในทีม + ใครทำไฟลท์เดียวกัน · ปุ่มลง/แก้ตำแหน่งถูก gate `varPriv` (`27` A-3) → ดูได้ แก้ไม่ได้

### 1.2 ล็อกทีม = ทีมตัวเอง (USER เห็นเฉพาะทีมตัวเอง)
```powerapps
ddATeam.Default = =Coalesce(varMyTeam, First(colAAir).team)
// USER เปลี่ยนทีมไม่ได้ (เห็นเฉพาะทีมตัวเอง) · EDITOR/ADMIN สลับทีมได้
ddATeam.DisplayMode = =If(varPriv, DisplayMode.Edit, DisplayMode.Disabled)
// กันเผลอโหลดทีมอื่นถ้า USER พยายามข้าม:
// ใน btnALoad: Set(varAT, If(varPriv, ddATeam.Selected.Value, Coalesce(varMyTeam, ddATeam.Selected.Value)))
```
> ถ้าอยากไฮไลต์ "งานของฉัน" ในกริดทีม: ให้แถวที่ `emp_code = varMyCode` ขึ้นสีเน้น (ไม่ซ่อนคนอื่น)

### 1.3 อยากเน้นเฉพาะไฟลท์เดียวกับฉัน (ออปชัน)
ปุ่มสลับ "ทั้งทีม / ไฟลท์ของฉัน":
```powerapps
// varAMineOnly toggle → กรองเฉพาะไฟลท์ที่ฉันอยู่
galAAsg.Items = If(varAMineOnly,
  With({myFl: Distinct(Filter(colAAsg, emp_code = varMyCode), Title)},
       Filter(colAAsg, Title in myFl.Value)),   // คนที่ทำไฟลท์เดียวกับฉัน
  colAAsg)
```

> หน้า **scrMe** = งานของฉันล้วน ๆ (เฉพาะ `emp_code = varMyCode`) · ส่วน scrAssign = ภาพรวมทีม (ตามข้อนี้)

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
