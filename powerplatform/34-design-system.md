# 34 · Design system — มินิมอล · ใช้ง่าย · ตัวอักษรไม่เลื่อน

สเปกหน้าตาแอป PAS ให้ **สม่ำเสมอทุกหน้า** · อ่านง่าย · **layout ไม่ขยับ/ตัวอักษรไม่เลื่อน** เวลาโหลดข้อมูล
หัวใจ: กำหนด **token กลาง** (สี/ขนาด/ระยะ) ที่ `App.Formulas` แล้วทุกหน้าอ้างอิงตัวเดียวกัน → แก้ที่เดียว เปลี่ยนทั้งแอป

---

## 1) Theme tokens — ใช้ `T` ที่แอปมีอยู่แล้ว (อย่าสร้าง Theme/Sz/Sp ใหม่)
แอปนี้นิยาม theme **`T`** ไว้ที่ `App.Formulas` แล้ว (scrSignIn/scrAdminRoles/scrAssign ใช้ `T.*` อยู่) → **ยึด `T` ตัวเดียว** ทุกหน้า
> ⚠️ เวอร์ชันก่อนหน้าของ doc นี้เสนอ `Theme/Sz/Sp` — **เลิกใช้** ให้ใช้ `T` ของจริงแทน

token `T` ที่ใช้จริง (สี) — อ้างด้วย `T.<ชื่อ>`:
| กลุ่ม | token |
|---|---|
| พื้น/พื้นผิว | `T.bg` (พื้นจอ) · `T.surface` · `T.surface2` · `T.line` (เส้น) |
| หลัก | `T.brand` (น้ำเงินหลัก/หัวจอ/ปุ่มหลัก) · `T.font` (ฟอนต์) |
| ตัวอักษร | `T.ink` (หลัก) · `T.ink2` (รอง) · `Color.White` (บนพื้นเข้ม) |
| สถานะ | `T.ok`/`T.okSoft` · `T.bad`/`T.badSoft` · `T.warn`/`T.warnSoft` · `T.info`/`T.infoSoft` · `T.sky`/`T.skySoft` |

**ขนาดตัวอักษร / ความสูง:** หน้าจริงใช้เลขตรง ๆ + responsive `If(Parent.Width < 760, เล็ก, ใหญ่)` (ไม่มี Sz/Sp token)
ยึดสเกลให้สม่ำเสมอ: หัวจอ 14–17 · หัวการ์ด 12–15 · body 10–13 · caption 8.5–9 · ปุ่มสูง 36–48 · หัวแถบ 64 · มุมโค้ง 9 (ปุ่มกลม 18–22)
```powerapps
// ปุ่มหลักมาตรฐาน (คัดจาก scrSignIn)
Fill = T.brand · Color = Color.White · Font = T.font · FontWeight = Semibold
HoverFill = ColorFade(T.brand,-10%) · PressedFill = ColorFade(T.brand,-20%)
Radius(ทุกมุม) = 9 · BorderThickness = 0 · Height = 44
```

---

## 2) กติกา "ตัวอักษรไม่เลื่อน / layout ไม่ขยับ" (สำคัญ)
สาเหตุตัวอักษรเลื่อนตอนโหลด + วิธีกัน:
1. **ตั้ง `Height`/`Size`/`Y` คงที่เสมอ** — อย่าให้ auto-grow (Label ตั้ง Height ตายตัว ไม่ใช้ AutoHeight) → ข้อความยาวตัด `...` แทนดันบรรทัด
2. **จองที่ว่างของค่าที่ยังไม่มา** — ป้ายตัวเลข/สถานะใช้ `Coalesce(x, "—")` หรือ `Text(Coalesce(n,0))` → ว่าง = "—"/"0" ไม่ยุบช่อง
3. **ความสูงแถวแกลเลอรีคงที่** `TemplateSize` fixed → แถวไม่ขยับตามเนื้อหา
4. **ตำแหน่งอิง token เดียว** (Head/Row/Gutter) → ทุกหน้า header สูงเท่ากัน ปุ่มชิดเท่ากัน ไม่กระโดด
5. **จำนวนในปุ่ม/แท็บ** (เช่น "งานไฟลท์ (3)") — ตั้งปุ่ม **Width คงที่** อย่าให้ปุ่ม auto-fit ข้อความ (เลขเปลี่ยน 1→10 ปุ่มจะไม่ขยาย)
6. **ไอคอน/emoji** วางใน Label กว้างคงที่ (เช่น 44) ไม่ปน inline กับข้อความที่ยาวไม่เท่ากัน
7. **กริดรับผิดชอบด้วย `WrapCount`** (ตามความกว้าง) ไม่ใช่ย้าย X/Y รายตัว → ปรับจอแล้วไม่เพี้ยน
8. **ชิดขอบ 16px (`Sp.Gutter`) เท่ากันทุกหน้า** · ไม่มี horizontal scroll

---

## 3) แพทเทิร์นคอมโพเนนต์ (ใช้ซ้ำทุกหน้า)
**Header (ทุกหน้า):** Rectangle `Fill=Theme.Navy Height=Sp.Head` + Title `Color=Theme.OnDark Size=Sz.H1 Bold X=Sp.Gutter` + ปุ่มกลับขวาบน (`Fill=Theme.Card Color=Theme.Navy`)
**ปุ่มหลัก:** `Fill=Theme.Navy Color=Theme.OnDark Height=Sp.Btn` · **ปุ่มรอง:** `Fill=Theme.Card Color=Theme.Navy BorderColor=Theme.Navy`
**การ์ด:** Rectangle `Fill=Theme.Card` + แถบสีซ้าย/บน (accent) · เว้น `Sp.Gap`
**Label หลัก:** `Color=Theme.Ink Size=Sz.Body` · **รอง:** `Color=Theme.Sub Size=Sz.Cap`
**Stat tile:** เลข `Size=Sz.Num Bold Color=accent` + ป้าย `Size=Sz.Cap Color=Theme.Sub` (ความสูง `Sp.Tile` คงที่)
**แกลเลอรีรายการ:** `TemplateFill=Theme.Card` สลับเส้น `Theme.Line` · `TemplateSize` คงที่

---

## 4) วิธี retrofit หน้าที่ทำไว้ (scrHome/scrMe/scrLP/scrDay/…)
1. วาง tokens ที่ `App.Formulas` (ข้อ 1)
2. แทนค่าดิบ → token (เช่น `RGBA(29,66,138,1)` → `Theme.Navy` · `Size: =18/20` → `Sz.H1`)
3. Label ทุกตัวตั้ง **Height คงที่** + ค่าที่อาจว่างใช้ `Coalesce`
4. ปุ่มที่ข้อความมีตัวเลข → **Width คงที่**
5. เว้นขอบ `Sp.Gutter` เท่ากัน · กริดใช้ `WrapCount`
> ไม่ต้องรื้อโครง แค่สลับค่าเป็น token + ล็อกความสูง → ได้ลุคเดียวกันทั้งแอป ตัวอักษรนิ่ง

---

## 5) โทนรวม (มินิมอล)
- พื้นจอเทาอ่อน `Theme.Bg` · การ์ดขาว · เงา/เส้นบางสีเดียว `Theme.Line`
- สีเน้นใช้ **น้อยจุด** (หัวจอ + accent การ์ด + ปุ่มหลัก) ที่เหลือเทา/ขาว
- ตัวอักษร 2 ระดับพอ (Ink/Sub) · ขนาดตายตัว 5 ค่า (H1/H2/Body/Cap/Num)
- ปุ่ม/แถวสูงเท่ากัน (Btn 40 · Row 44 · Head 64) → สายตากวาดง่าย ไม่เลื่อน

> อยากให้ผม **ออก `.pa.yaml` ของแต่ละหน้าใหม่แบบใช้ token (Theme/Sz/Sp) + ล็อกความสูงครบ** ส่งให้ paste ทับทีละหน้าได้ — บอกได้ว่าเริ่มหน้าไหน
