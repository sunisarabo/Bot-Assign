# 29 · เมนูหลักตามสิทธิ์ (scrHome) — สแกฟโฟลด์เต็ม

หน้าแรกรวมทางเข้าทุกหน้า · การ์ดเมนูโชว์/ซ่อนตาม `varPriv` (จาก `27` A) · โชว์ชื่อผู้ใช้ + badge สิทธิ์
พนักงาน(ดูอย่างเดียว)เห็นเฉพาะหน้าดู · ซุป/แอดมินเห็นหน้าแก้ไขด้วย

> ต้องทำ `27` ขั้นที่ 0 + A (App.OnStart ตั้ง `varPriv`/`varMyCode`) ก่อน

## 0) ชี้ให้แอปเปิดที่ scrHome
`App.StartScreen` = `=scrHome`
(ถ้าอยากให้เครื่องคีออสก์พอตเตอร์เด้งไป scrMy เลย: `=If(varPriv, scrHome, scrHome)` — ปรับตามเคสจริง)

## 1) scrHome.OnVisible — สร้างรายการเมนู
`key` = ตัวชี้หน้า · `needEdit=true` = เห็นเฉพาะซุป/แอดมิน
```powerapps
// scrHome.OnVisible
ClearCollect(colHMenu,
  { key:"my",      title:"งานของฉันวันนี้", sub:"ดูงาน + กดรับทราบ",        icon:"📋", needEdit:false, needAdmin:false, accent:RGBA(29,66,138,1) },
  { key:"roster",  title:"ตารางเวร (Roster)", sub:"คน × วัน · แลกเวร/ลา/เปลี่ยนกะ", icon:"🗓", needEdit:false, needAdmin:false, accent:RGBA(29,66,138,1) },
  { key:"assign",  title:"มอบหมายงาน (Assign)", sub:"ลงตำแหน่งต่อไฟลท์",        icon:"🧭", needEdit:false, needAdmin:false, accent:RGBA(45,106,79,1) },
  { key:"flights", title:"ไฟลท์",             sub:"เพิ่ม/แก้/ยกเลิก",            icon:"✈", needEdit:true,  needAdmin:false, accent:RGBA(168,99,0,1) },
  { key:"wh",      title:"ชม.ทำงาน/OT",       sub:"รายสัปดาห์ · cap 48/36",      icon:"⏱", needEdit:false, needAdmin:false, accent:RGBA(90,50,140,1) },
  { key:"ot",      title:"ตรวจ OT",           sub:"OT ขอจริง",                  icon:"💰", needEdit:false, needAdmin:false, accent:RGBA(176,58,46,1) },
  { key:"admin",   title:"จัดการระบบ",         sub:"สิทธิ์ · import/export · generate", icon:"⚙", needEdit:true, needAdmin:true, accent:RGBA(60,60,60,1) }
);
Set(varHWho, Coalesce(varMe.emp_name, User().FullName, "ผู้ใช้"))
```
> มี WC/Porter ในแอปเดียวกัน ก็เพิ่มแถว `{ key:"wc", title:"วีลแชร์ (LP)", ..., needEdit:true }`

## 2) คอนโทรลบนหน้า
| คอนโทรล | ชนิด | property |
|---|---|---|
| `recHHead` | Rectangle | `Fill=RGBA(29,66,138,1)` · `Height=84` · `Width=Parent.Width` |
| `lblHTitle` | Label | `Text="PAS · ระบบจัดกำลังพล PSA-HKT"` · `Color=White` · `Bold` · `Size=20` · `X=20 Y=14` |
| `lblHWho` | Label | `Text="สวัสดี " & varHWho` · `Color=RGBA(220,230,250,1)` · `Size=12` · `X=20 Y=50` |
| `lblHRole` | Label | badge สิทธิ์ (ด้านล่าง) · `X=Parent.Width-170 Y=26 Width=150 Height=32` |
| `galHMenu` | Gallery (Vertical, wrap) | การ์ดเมนู (ด้านล่าง) · `X=16 Y=100 Width=Parent.Width-32 Height=Parent.Height-116` |

```powerapps
// badge สิทธิ์
lblHRole.Text  = =If(varPriv, "โหมดแก้ไข (ซุป/แอดมิน)", "👁 ดูอย่างเดียว")
lblHRole.Fill  = =If(varPriv, RGBA(45,106,79,1), RGBA(90,90,90,1))
lblHRole.Color = =RGBA(255,255,255,1)
lblHRole.Align = =Align.Center
lblHRole.Size  = =11
```

## 3) galHMenu — การ์ด + กรองตามสิทธิ์ + responsive
```powerapps
galHMenu.Items     = =Filter(colHMenu, (!needEdit || varPriv) && (!needAdmin || varAdmin))
// การ์ดกว้าง ~300 → จำนวนคอลัมน์ตามจอ
galHMenu.WrapCount = =Max(1, RoundDown((Parent.Width - 32) / 300, 0))
galHMenu.TemplateSize = =120
galHMenu.TemplatePadding = =8
```
คอนโทรลในแต่ละการ์ด:
```powerapps
// recHCard (Rectangle พื้นการ์ด)
recHCard.Fill      = =RGBA(255,255,255,1)
recHCard.BorderColor = =RGBA(230,230,230,1)
recHCard.X=4  Y=4  Width=Parent.TemplateWidth-16  Height=Parent.TemplateHeight-12

// recHBar (แถบสีซ้าย = accent ของเมนู)
recHBar.Fill = =ThisItem.accent
recHBar.X=4 Y=4 Width=6 Height=Parent.TemplateHeight-12

lblHIcon.Text  = =ThisItem.icon        // X=20 Y=16 Size=28
lblHCardT.Text = =ThisItem.title        // Bold Size=15 X=64 Y=18
lblHCardS.Text = =ThisItem.sub          // Size=11 Color=gray X=64 Y=46

// ปุ่มใส (คลุมทั้งการ์ด) ไป navigate
btnHGo.Fill = =RGBA(0,0,0,0)             // โปร่งใส
btnHGo.X=4 Y=4 Width=Parent.TemplateWidth-16 Height=Parent.TemplateHeight-12
btnHGo.OnSelect =
  =Switch(ThisItem.key,
     "my",      Navigate(scrMy),
     "roster",  Navigate(scrRoster),
     "assign",  Navigate(scrAssign),
     "flights", Navigate(scrFlights),
     "wh",      Navigate(scrWH),
     "ot",      Navigate(scrOT),
     "admin",   Navigate(scrAdminRoles)
     /* , "wc", Navigate(scrWC) */ )
```
> ใช้ปุ่มใสคลุมการ์ดแทน `Gallery.OnSelect` เพื่อให้ hover/กดชัด · ถ้าถนัดใช้ `galHMenu.OnSelect = Switch(galHMenu.Selected.key, ...)` ก็ได้

## 4) กันเข้าหน้าแก้ไขตรง ๆ (เสริม)
การ์ดซ่อนแล้ว แต่กัน deep-link/Back เข้าหน้าแก้: ที่ `scrFlights.OnVisible` (และหน้าแก้อื่น)
```powerapps
If(!varPriv, Notify("หน้านี้สำหรับหัวหน้าทีม/แอดมิน", NotificationType.Warning); Navigate(scrHome))
```
> หน้า "ดู" (roster/assign/wh/ot/my) ไม่ต้องกัน — พนักงานเปิดดูได้ ปุ่มแก้ถูก gate ด้วย `varPriv` อยู่แล้ว (`27` A-3)

## 5) ปุ่มกลับบ้านทุกหน้า
ที่ `btn*Back` เดิมของแต่ละหน้า เปลี่ยน/เพิ่ม: `OnSelect = Navigate(scrHome)` (แทน `Back()` ถ้าอยากกลับเมนูเสมอ)

---

## สรุป
- `scrHome` = gallery การ์ดเดียว · ข้อมูลเมนูใน `colHMenu` → เพิ่ม/ลดเมนูแก้ที่ collection ที่เดียว
- กรองสิทธิ์ด้วย `Filter(colHMenu, !needEdit || varPriv)` → ซุปเห็นครบ · พนักงานเห็นเฉพาะหน้าดู
- responsive ด้วย `WrapCount` ตามความกว้างจอ (มือถือ 1 คอลัมน์ · จอใหญ่หลายคอลัมน์)
