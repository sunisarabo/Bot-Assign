# 39 · นโยบายสิทธิ์จริง (ตำแหน่ง → role) — ฉบับยืนยัน

กำหนดโดยผู้ใช้ · เป็น **แหล่งอ้างอิงจริง** (แทนตัวอย่างใน `31`)

## 1) ตำแหน่ง → app_role
| ตำแหน่ง | app_role | สิทธิ์ |
|---|---|---|
| **Director · Manager · Assistant Manager · Supervisor** | **Editor** | ดู **และแก้ไข** ตามฟังก์ชัน |
| **Senior · Agent · Officer** | **Viewer** | ดูอย่างเดียว ตามฟังก์ชัน |
| **Porter** | **Porter** | ดูอย่างเดียว **เฉพาะที่เกี่ยวกับวีลแชร์** |
| 3 เมลนี้เท่านั้น | **Admin** | ดูแลหลังบ้านทั้งหมด |

**Admin = เฉพาะ 3 เมล:** `hktadminpsa@aotga.com` · `hktadminll@aotga.com` · `sunisara.bo@aotga.com`

## 2) ค่า app_role (Choice ใน PAS_Users) — ชุดสุดท้าย
`Admin` · `Editor` · `Viewer` · `Porter` · `Kiosk`
> แอปเดิมมี `Supervisor`/`Duty` → ถือเป็น **Editor** (เปลี่ยนค่าเป็น `Editor` หรือรวมเข้า exclude-list ให้ = แก้ได้) · `Kiosk` = บัญชีเครื่องกลางคงไว้

## 3) App.OnStart (คุมสิทธิ์ + ล็อก Admin 3 เมล)
```powerapps
Set(varMe, LookUp(PAS_Users, Title = Lower(User().Email)));
Set(varRole, If(IsBlank(varMe) || !varMe.active, "Viewer", varMe.role.Value));
// Admin = เฉพาะ 3 เมล (กันพลาด: ต่อให้ตารางตั้งผิด 3 เมลนี้ก็เป็น Admin เสมอ · คนอื่นเป็น Admin ไม่ได้)
Set(varAdmin,
  Lower(User().Email) in ["hktadminpsa@aotga.com", "hktadminll@aotga.com", "sunisara.bo@aotga.com"]);
If(varAdmin, Set(varRole, "Admin"));
// แก้ไขได้ = Admin หรือ Editor
Set(varPriv, varRole in ["Admin", "Editor"]);
// พอตเตอร์ = ดูเฉพาะวีลแชร์
Set(varIsPorter, varRole = "Porter");
Set(varMyCode, Coalesce(varMe.emp_code, varMyCode, ""))
```
> ถ้ายังใช้ exclude-list เดิม: `Set(varPriv, !(varRole in ["Viewer","Porter","Kiosk","Staff","Employee"]))` ก็ได้ผลเท่ากัน

## 4) Porter เห็นเฉพาะวีลแชร์ (scrHome)
กรองการ์ดเมนูเพิ่มเงื่อนไข porter:
```powerapps
galHMenu.Items =
  Filter(colHMenu,
    If(varIsPorter,
       key in ["my", "lpp"],                              // พอตเตอร์: เฉพาะงานของฉัน + ♿ พอตเตอร์
       (!needEdit || varPriv) && (!needAdmin || varAdmin)  // คนอื่น: ตามสิทธิ์แก้/แอดมิน
    ))
```
- `scrMe` ของพอตเตอร์โชว์แท็บ **งานวีลแชร์** (ดู `wc-12`) · ปุ่ม ♿ ไป `scrLP` porter
- กัน deep-link: หน้าอื่น (roster/assign/flights/ot/day) ใส่ `If(varIsPorter, Navigate(scrHome))` ใน OnVisible

## 5) "ตามฟังก์ชัน" (Editor แก้ได้บางส่วน · Viewer ดู)
- **Editor** (`varPriv=true`) → ปุ่มแก้เปิด (แลกเวร/ลา/เปลี่ยนกะ/assign/ไฟลท์/LP จ่ายงาน) ตาม gate `varPriv` ที่มีอยู่
- **Viewer** (`varPriv=false`) → ปุ่มแก้เป็นสีเทา/ซ่อน · เปิดดูทุกหน้าที่ไม่ใช่หลังบ้าน
- **หลังบ้าน** (import/export · generate · จัดการสิทธิ์/PIN) → `varAdmin` เท่านั้น

## 6) scrAdminRoles — dropdown role
```powerapps
ddARURole.Items = ["Admin", "Editor", "Viewer", "Porter", "Kiosk"]
```
- ป้ายอธิบาย: Admin=หลังบ้านทั้งหมด · Editor=ดู+แก้ตามฟังก์ชัน · Viewer=ดูอย่างเดียว · Porter=เฉพาะวีลแชร์ · Kiosk=เครื่องกลาง
- (แนะนำ) **กันตั้ง Admin ให้คนนอก 3 เมล:** ใน btnARUSave ถ้าเลือก role=Admin แต่อีเมลไม่ใช่ 3 เมล → เตือนและไม่บันทึก
```powerapps
If(ddARURole.Selected.Value = "Admin" && !(Lower(Trim(txtARUEmail.Text)) in ["hktadminpsa@aotga.com","hktadminll@aotga.com","sunisara.bo@aotga.com"]),
   Notify("ตั้ง Admin ได้เฉพาะ 3 เมลที่กำหนด", NotificationType.Error), /* ...Patch ปกติ... */ )
```

## 7) ตั้ง role จากตำแหน่งอัตโนมัติ (ออปชัน)
ถ้าอยากเดา role จาก `PAS_Employees.position`/`pos_group` ตอนเพิ่ม user:
```powerapps
Switch(true,
  Lower(Trim(txtARUEmail.Text)) in [admin 3 เมล], "Admin",
  varPos in ["Director","Manager","Assistant Manager","Supervisor"], "Editor",
  varPos = "Porter", "Porter",
  "Viewer")   // Senior/Agent/Officer + อื่น ๆ
```
> ส่วนใหญ่ PAS_Users = หัวหน้า/แอดมิน (ไม่กี่คน) ตั้งมือก็ได้ · พนักงานทั่วไปไม่ต้องมีใน PAS_Users (เข้าด้วย PIN)

## สรุปที่ต้องแก้ในแอป
1. PAS_Users.role choice = `Admin/Editor/Viewer/Porter/Kiosk`
2. App.OnStart ตามข้อ 3 (ล็อก Admin 3 เมล + varIsPorter)
3. scrHome filter porter-only (ข้อ 4) + กัน deep-link หน้าอื่นสำหรับ porter
4. scrAdminRoles dropdown + กัน Admin นอก 3 เมล (ข้อ 6)
