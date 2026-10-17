# 31 · พนักงานเข้าใหม่ (sync อัตโนมัติ) + Sign-in + 3 ระดับสิทธิ์ (ADMIN / EDITOR / USER)

ตอบ 2 เรื่อง: (A) รายชื่ออัปเดตเองจาก PS-Manpower ไหม · (B) ทำ sign-in + แยกสิทธิ์ 3 ระดับ
> อัปเกรดจาก `07-access-roles.md` (โมเดล 2 เส้นทางเดิม) และ `27` A (STAFF/SUP/ADMIN → **ADMIN/EDITOR/USER**)

---

## A · พนักงานเข้าใหม่ — รายชื่ออัปเดตอัตโนมัติไหม?

**ไม่อัตโนมัติเองถ้าไม่ตั้ง sync** — ต้องมีไปป์ไลน์ import แบบ **upsert** จากไฟล์ PS-Manpower (ทะเบียนพนักงาน) เข้า `PAS_Employee`
ตั้งแล้ว = เพิ่มชื่อในไฟล์ → **โผล่ในแอปเองทุกครั้งที่ refresh** (ไม่ต้องแก้แอป)

### ตั้ง Dataflow sync `PAS_Employee` (ทำครั้งเดียว)
1. make.powerapps.com → **Dataflows → + New** → `Sync PAS Employee`
2. **Get data → Excel/SharePoint** ชี้ไฟล์ PS-Manpower (ชีตทะเบียนพนักงาน: EmpID/ชื่อ/ทีม/ตำแหน่ง/Status/StartDate/EndDate)
3. **Map to PAS Employee** · **Key = Emp Code** (`pas_name`) → upsert:
   - แถวใหม่ (คนเข้าใหม่) = **เพิ่มอัตโนมัติ**
   - แถวเดิมเปลี่ยน (ย้ายทีม/ตำแหน่ง) = **อัปเดต**
   - คนลาออก: ไฟล์ตั้ง Status=RESIGNED + EndDate → map เข้า `pas_status` → แอปกรอง `status=ACTIVE` ออกให้เอง
4. **ตั้งค่าเริ่มต้นคนใหม่:** ใน Power Query เพิ่มคอลัมน์คงที่ `app_role = "USER"` (ถ้าไฟล์ไม่มีคอลัมน์สิทธิ์) → คนเข้าใหม่ได้สิทธิ์ **USER** โดยปริยาย (ปลอดภัยสุด) แล้ว ADMIN ค่อยเลื่อนขั้นทีหลัง
   > ถ้าไฟล์ PS-Manpower มีคอลัมน์ "สิทธิ์/Role" อยู่แล้ว ก็ map ตรงเข้า `app_role` ได้เลย
5. **Refresh schedule:** รายวัน (เช่น 06:00) หรือ on-demand → **Publish**

### ผลต่อแอป (รายชื่อโผล่ที่ไหนบ้าง)
- `ddMyWho` (scrMy), pick-list ต่าง ๆ ที่อ่าน `PAS_Employees` → เห็นคนใหม่ทันทีหลัง refresh
- **Roster**: generator (`build_roster.py`) อ่านทะเบียนไฟล์เดียวกัน → คนใหม่เข้ารอบจัดกะเดือนถัดไปอัตโนมัติ (ต้องอยู่ในทะเบียนก่อนรัน)
- **ประวัติเวร** `import_daily_roster.py` upsert ด้วย EmpCode อยู่แล้ว → ไม่ต้องแก้

> สรุป: ตั้ง **Dataflow upsert (key=Emp Code) + schedule** ครั้งเดียว → คนเข้าใหม่/ลาออก sync เองตลอด · default สิทธิ์ = USER

---

## B · Sign-in + 3 ระดับสิทธิ์

### ระดับสิทธิ์ (คอลัมน์ `PAS_Employees.app_role` · Choice)
| Role | ใคร | ทำอะไรได้ |
|---|---|---|
| **ADMIN** | ดูแลระบบหลังบ้านทั้งหมด | ทุกอย่าง + จัดการสิทธิ์ · import/export · สั่ง generate · ตั้งค่า · WC LP config · ลบข้อมูล |
| **EDITOR** | หัวหน้าทีม/ซุป | แก้ **บางส่วน**: roster (แลกเวร/ลา/เปลี่ยนกะ) · assignment (ลง/จัดอัตโนมัติ) · ไฟลท์ · อนุมัติลา/OT — **แต่เข้าหลังบ้าน/จัดการสิทธิ์ไม่ได้** |
| **USER** | พนักงานทั่วไป | **ดู** งานของฉัน · roster/assignment/OT (อ่าน) · กดรับทราบงานตัวเอง — แก้ไม่ได้ |

### ตัวแปรใน `App.OnStart` (แทนของเดิมใน `27` A-2)
```powerapps
// 1) ผู้ใช้ที่ล็อกอิน M365 → หาสิทธิ์จากตาราง
Set(varMe, LookUp(PAS_Employees, Lower(work_email) = Lower(User().Email)));
Set(varRole, Coalesce(varMe.app_role.Value, "USER"));   // ไม่พบ/ไม่มีสิทธิ์ = USER
// 2) ธงใช้ซ้ำทั้งแอป
Set(varPriv,  varRole in ["ADMIN", "EDITOR"]);          // "แก้ได้" (ใช้ที่เดิมใน 27/29 ได้เลย)
Set(varAdmin, varRole = "ADMIN");                        // หลังบ้าน/จัดการสิทธิ์
Set(varMyCode, Coalesce(varMe.emp_code, ""));
Set(varMyTeam, Coalesce(varMe.team, ""))
```
> โค้ด gate เดิมใน `27` A-3 ใช้ `varPriv` = เห็นเฉพาะปุ่มแก้ (ADMIN+EDITOR) ต่อได้ · เพิ่ม **`varAdmin`** gate เฉพาะปุ่มหลังบ้าน (import/export · สั่ง generate · จัดการสิทธิ์)

### Sign-in: ทำยังไงให้ "พนักงาน" เข้าได้ (ส่วนใหญ่ไม่มี M365)
2 ทางในแอปเดียว — route ตามว่ามีบัญชีไหม:

| กลุ่ม | วิธี sign-in | ได้ Role |
|---|---|---|
| **ADMIN / EDITOR** (+ USER ที่มี M365) | **Entra ID** (ล็อกอิน M365 ในตัว Power Apps) → `app_role` จากอีเมล | ตามตาราง |
| **USER ไม่มี M365** | **เลือกชื่อ + PIN** (เหมือนพอตเตอร์ `wc-03`) บนจอรวม/มือถือ | USER เสมอ |

**PIN สำหรับ USER ไม่มี M365** (คอลัมน์ `PAS_Employees.pas_pin` · 4-6 หลัก):
```powerapps
// หน้า sign-in เบา (scrSignIn) เมื่อ User().Email ไม่อยู่ในตาราง หรือกด "เข้าแบบพนักงาน"
// ddSIWho = เลือกชื่อ · txtSIPin = PIN
btnSIGo.OnSelect =
  =With({e: LookUp(PAS_Employees, emp_code = ddSIWho.Selected.code)},
     If(IsBlank(e) || e.pas_pin <> txtSIPin.Text, Notify("PIN ไม่ถูกต้อง", NotificationType.Error),
        Set(varMe, e); Set(varRole, "USER"); Set(varPriv, false); Set(varAdmin, false);
        Set(varMyCode, e.emp_code); Set(varMyTeam, e.team);
        Navigate(scrHome)))
```
> PIN ไม่ใช่ความปลอดภัยระดับสูง (ดู `07` หมายเหตุ PDPA) — กันสะดวก/สวมรอยกันเองในทีมพอ · ADMIN/EDITOR **ต้อง** M365 จริง (เพราะแก้ข้อมูล)

### App.StartScreen (route ตามว่าล็อกอินหรือยัง)
```powerapps
App.StartScreen = =If(IsBlank(LookUp(PAS_Employees, Lower(work_email)=Lower(User().Email))), scrSignIn, scrHome)
// ADMIN/EDITOR/USER-M365 → ตารางพบ → scrHome · ไม่มี M365 → scrSignIn (เลือกชื่อ+PIN)
```

---

## C · gate ตามระดับ (ต่อยอดจาก 27/29)
| หน้า/ปุ่ม | USER | EDITOR | ADMIN | gate |
|---|---|---|---|---|
| scrMy (รับทราบงานตัวเอง) | ✅ | ✅ | ✅ | — |
| ดู roster/assign/wh/ot | ✅ | ✅ | ✅ | — |
| แก้ roster/assign/ไฟลท์ · จัดอัตโนมัติ | ❌ | ✅ | ✅ | `varPriv` |
| อนุมัติลา/OT | ❌ | ✅ | ✅ | `varPriv` |
| import/export · สั่ง generate · WC LP config · จัดการสิทธิ์ (เปลี่ยน app_role) | ❌ | ❌ | ✅ | **`varAdmin`** |

### หน้า "จัดการสิทธิ์" (ADMIN เท่านั้น) — scrAdminRoles
```powerapps
// galARole.Items = PAS_Employees · ต่อแถวมี dropdown app_role
ddARRole.Items = =["USER","EDITOR","ADMIN"]
ddARRole.OnChange =
  =If(varAdmin, Patch(PAS_Employees, ThisItem, {app_role: {Value: ddARRole.Selected.Value}});
      Notify("ตั้ง " & ThisItem.emp_name & " = " & ddARRole.Selected.Value, NotificationType.Success))
// ปุ่มตั้ง PIN ใหม่: Patch(..., {pas_pin: txtARPin.Text})
```
> เข้าหน้านี้จากการ์ด "จัดการระบบ" บน scrHome (โชว์เฉพาะ `varAdmin`)

---

## สรุปคอลัมน์ที่ต้องมีบน PAS_Employee (รวมกับ 27 ขั้น 0)
`app_role` (Choice ADMIN/EDITOR/USER, default USER) · `work_email` (Text) · `pas_pin` (Text 4-6 หลัก) · `status` (ACTIVE/RESIGNED) · `emp_code`/`emp_name`/`team` (มีแล้ว)
