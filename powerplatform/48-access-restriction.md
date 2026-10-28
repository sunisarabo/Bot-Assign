# 48 · จำกัดการเข้าใช้ระบบ (ให้เฉพาะคนที่ได้รับสิทธิ์)

เป้า: **คนนอกเปิดระบบไม่ได้** · เข้าได้เฉพาะ ADMIN · คนที่อยู่ใน `PAS_Users` (active) · พนักงาน/พอตเตอร์ที่เข้าด้วย PIN
> เปลี่ยนจากเดิมที่ M365 คนไหนก็เข้าดูได้ (default Viewer) → **ไม่อยู่ในรายชื่อ = บล็อก**

## ชั้นที่ 1 · แชร์แอป + สิทธิ์ลิสต์ เฉพาะกลุ่ม (ด่านจริง)
- **Power Apps → Share** → แชร์เฉพาะ **security group / รายชื่อ** ที่อนุญาต · **อย่าแชร์ทั้งองค์กร/Everyone**
- **SharePoint lists** (`PAS_*`): ให้สิทธิ์เฉพาะกลุ่มเดียวกัน (คนนอก list อ่าน/เขียนไม่ได้ แม้เปิดแอปได้)
- บัญชี **Kiosk** (เครื่องกลาง) = 1 บัญชีมีสิทธิ์ list เพื่อให้ staff เข้าแบบ PIN
> ชั้นนี้คือด่านจริง — ต่อให้ bypass หน้าแอป ก็อ่าน/เขียนข้อมูลไม่ได้ถ้าไม่มีสิทธิ์ list

## ชั้นที่ 2 · gate ในแอป (App.OnStart) — เปลี่ยน default เป็นบล็อก
```powerapps
Set(varMe, LookUp(PAS_Users, Title = Lower(User().Email)));
Set(varAdmin, Lower(User().Email) in ["hktadminpsa@aotga.com","hktadminll@aotga.com","sunisara.bo@aotga.com","dutyhkt@aotga.com"]);
// role: Admin(เมล) · ในตาราง&active · ไม่งั้นว่าง (ยังไม่ได้รับสิทธิ์)
Set(varRole, If(varAdmin, "Admin", !IsBlank(varMe) && varMe.active, varMe.role.Value, Blank()));
Set(varPriv,  varRole in ["Admin","Editor"]);
Set(varIsPorter, varRole = "Porter");
// อนุญาตเข้า = แอดมิน · อยู่ในตาราง active · (หรือภายหลังเข้าแบบ PIN → varRole="Kiosk"/"Viewer" ที่ scrSignIn ตั้งให้)
Set(varAllowed, varAdmin || (!IsBlank(varMe) && varMe.active));
Set(varMyCode, Coalesce(varMe.emp_code, ""))
```
> ปุ่ม/หน้าแก้ยัง gate ด้วย `varPriv`/`varAdmin` เหมือนเดิม (doc 39/40) · ที่เพิ่มคือ **`varAllowed`** กันคนนอกตั้งแต่เข้า

### App.StartScreen (route)
```powerapps
App.StartScreen = If(
  IsBlank(User().Email),            scrSignIn,     // เครื่องกลาง/ไม่มี M365 → เลือกชื่อ+PIN
  varAllowed,                       scrHome,       // ได้รับสิทธิ์ → เมนู
  scrNoAccess)                                     // M365 แต่ไม่มีสิทธิ์ → หน้าบล็อก
```
> staff/porter เข้าแบบ PIN ที่ `scrSignIn` → เมื่อ PIN ถูก ตั้ง `varAllowed = true` + `varRole` (Viewer/Porter) แล้ว Navigate(scrMe) (ตามที่ build ไว้)

## หน้า scrNoAccess (บล็อก)
- ข้อความ: **"คุณยังไม่ได้รับสิทธิ์เข้าใช้ระบบ PAS"** · "ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์" + ช่องติดต่อ
- **ไม่มีเมนู/ปุ่มไปหน้าอื่น** (หรือมีแค่ "ลองใหม่"/"ออกจากระบบ")
```powerapps
// recNABg Rectangle คลุมจอ + lblNA ข้อความ + (ออปชัน) btnNARetry = Reload() / Navigate(scrSignIn)
```

## กัน bypass (ทุกหน้า)
ใส่ใน `OnVisible` ของทุกหน้าที่มีข้อมูล:
```powerapps
If(!varAllowed, Navigate(scrNoAccess))
```

## สรุป "ใครเข้าได้"
| กลุ่ม | เข้าได้ | ได้สิทธิ์ |
|---|---|---|
| 4 เมลแอดมิน | ✅ | Admin |
| อยู่ใน PAS_Users + active | ✅ | ตาม role (Editor/Viewer/Porter…) |
| staff/porter เข้าด้วย PIN | ✅ | Viewer/Porter (ผ่าน scrSignIn) |
| M365 อื่น ๆ ที่ไม่อยู่ในรายชื่อ | ❌ | scrNoAccess |
| คนนอกองค์กร | ❌ | เปิดแอปไม่ได้ (ไม่ได้แชร์ + ไม่มีสิทธิ์ list) |

## วิธีให้สิทธิ์คนใหม่
แอดมินเพิ่มใน **scrAdminRoles** (PAS_Users: อีเมล + role) → คนนั้นเข้าได้ครั้งถัดไป · ถอนสิทธิ์ = ปิด active หรือลบแถว
> สอดคล้องนโยบาย `39`/`40` (Admin=4 เมล · Editor/Viewer/Porter · Porter เห็นเฉพาะวีลแชร์)
