# 40 · snippet ใช้นโยบายสิทธิ์ (doc 39) — พร้อมเสียบ scrHome / scrAdminRoles

ฟรักเมนต์พร้อมวางในหน้าจริง · ตามนโยบาย `39` (Editor=Director/Manager/AsstMgr/Supervisor · Viewer=Senior/Agent/Officer · Porter=เฉพาะวีลแชร์ · Admin=4 เมล)

## 1) App → OnStart (วางต่อท้ายของเดิม · ล็อก Admin 4 เมล)
```powerapps
Set(varMe, LookUp(PAS_Users, Title = Lower(User().Email)));
Set(varRole, If(IsBlank(varMe) || !varMe.active, "Viewer", varMe.role.Value));
Set(varAdmin, Lower(User().Email) in ["hktadminpsa@aotga.com", "hktadminll@aotga.com", "sunisara.bo@aotga.com", "dutyhkt@aotga.com"]);
If(varAdmin, Set(varRole, "Admin"));
Set(varPriv, varRole in ["Admin", "Editor"]);
Set(varIsPorter, varRole = "Porter");
Set(varMyCode, Coalesce(varMe.emp_code, varMyCode, ""))
```

## 2) scrHome
### 2.1 กรองการ์ดเมนู (Porter เห็นเฉพาะ my + lpp)
```powerapps
galHMenu.Items =
  Filter(colHMenu,
    If(varIsPorter,
       key in ["my", "lpp"],
       (!needEdit || varPriv) && (!needAdmin || varAdmin)))
```
### 2.2 badge สิทธิ์
```powerapps
lblHRole.Text =
  Switch(true, varAdmin, "ADMIN · หลังบ้าน", varIsPorter, "พอตเตอร์ · วีลแชร์", varPriv, "แก้ไขได้ · " & varRole, "ดูอย่างเดียว")
lblHRole.Fill =
  Switch(true, varAdmin, T.bad, varPriv, T.ok, varIsPorter, T.infoSoft, T.surface2)
```

## 3) กัน deep-link (วางใน OnVisible ของหน้าที่ porter ไม่ควรเข้า)
`scrRoster` · `scrAssign` · `scrFlights` · `scrOT` · `scrDay` · `scrWH`:
```powerapps
If(varIsPorter, Notify("พอตเตอร์ดูได้เฉพาะงานวีลแชร์", NotificationType.Warning); Navigate(scrHome))
```
> `scrMe` (แท็บวีลแชร์) และ `scrLP` โหมด porter = เข้าได้ · หน้าแก้ไขยัง gate ด้วย `varPriv` (Viewer เปิดดูได้ แก้ไม่ได้)

## 4) scrAdminRoles
### 4.1 dropdown role (5 ค่า)
```powerapps
ddARURole.Items = ["Admin", "Editor", "Viewer", "Porter", "Kiosk"]
```
### 4.2 ป้ายอธิบาย role ที่เลือก
```powerapps
lblARURoleTh.Text =
  Switch(ddARURole.Selected.Value,
    "Admin", "ADMIN · หลังบ้านทั้งหมด (เฉพาะ 4 เมล)",
    "Editor", "ดู+แก้ตามฟังก์ชัน (Director/Manager/Asst/Supervisor)",
    "Viewer", "ดูอย่างเดียว (Senior/Agent/Officer)",
    "Porter", "ดูเฉพาะงานวีลแชร์",
    "Kiosk", "เครื่องกลาง · เลือกชื่อ+PIN",
    ddARURole.Selected.Value)
```
### 4.3 บล็อกตั้ง Admin ให้คนนอก 4 เมล (ครอบ btnARUSave.OnSelect)
```powerapps
=With({e: Lower(Trim(txtARUEmail.Text))},
  If(ddARURole.Selected.Value = "Admin" && !(e in ["hktadminpsa@aotga.com", "hktadminll@aotga.com", "sunisara.bo@aotga.com", "dutyhkt@aotga.com"]),
     Notify("ตั้ง Admin ได้เฉพาะ 4 เมลที่กำหนด", NotificationType.Error),
     /* ...โค้ด Patch PAS_Users เดิม... */ ))
```

## 5) (ออปชัน) เดา role จากตำแหน่งตอนเพิ่ม user
```powerapps
Set(varSuggestRole,
  Switch(true,
    Lower(Trim(txtARUEmail.Text)) in ["hktadminpsa@aotga.com","hktadminll@aotga.com","sunisara.bo@aotga.com","dutyhkt@aotga.com"], "Admin",
    varARUPos in ["Director","Manager","Assistant Manager","Supervisor"], "Editor",
    varARUPos = "Porter", "Porter",
    "Viewer"))
// ddARURole.Default = varSuggestRole
```

## เช็กหลังเสียบ
- เข้าด้วย 4 เมล → badge "ADMIN" · เห็นการ์ดจัดการระบบ
- Supervisor/Manager → แก้ได้ (varPriv) · ไม่เห็นหลังบ้าน
- Senior/Agent/Officer → ดูได้ ปุ่มแก้เทา
- Porter → เห็นแค่ งานของฉัน(วีลแชร์) + ♿ · หน้าอื่นเด้งกลับ
- ตั้ง Admin ให้เมลอื่น → ถูกบล็อก
