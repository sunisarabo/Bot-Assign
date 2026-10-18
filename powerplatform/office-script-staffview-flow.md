# รัน Staff View อัตโนมัติทุกเช้า (Power Automate)

ให้ **Power Automate** รัน Office Script `PAS Staff View` บนไฟล์ export รายเดือน (`PAS_2026-10.xlsx`)
ทุกเช้า โดยส่ง "วันนี้" เข้าไป → ชีต **Staff View** จะรีเฟรชเอง (ย้อนหลังทุกวัน + ล่วงหน้าถึงพรุ่งนี้)

> ตัวต่อ SharePoint + Excel Online (Business) = มาตรฐาน · **ไม่ต้อง admin consent** · ฟรี

## เตรียม (ครั้งเดียว)
1. เปิด `PAS_2026-10.xlsx` ใน Excel Online → **Automate → New Script** → วาง `office-script-staff-view.ts` →
   **Save** → ตั้งชื่อ **`PAS Staff View`** (จะไปอยู่ OneDrive/Office Scripts เรียกจาก Flow ได้)
2. (ครั้งเดียว) แชร์ไฟล์/ชีตแบบ **View-only** ให้ **เมลกลางทีม** — SharePoint → Manage Access → *Can view*

## สร้าง Flow
make.powerautomate.com → **Create → Scheduled cloud flow**

1. **Trigger: Recurrence**
   - Interval `1` · Frequency `Day` · เวลา เช่น **06:00** · Time zone: **SE Asia Standard Time** (ICT)

2. **(ขั้นช่วย) Compose — วันนี้แบบ yyyy-MM-dd ตามเวลาไทย**
   - Action: **Compose** (ชื่อ `todayICT`)
   - Inputs:
     ```
     @{convertFromUtc(utcNow(), 'SE Asia Standard Time', 'yyyy-MM-dd')}
     ```

3. **Excel Online (Business) — Run script**
   - Location: **SharePoint** · Site: ไซต์ HKT PSA · Document Library: Documents
   - File: `…/PAS_2026-10.xlsx` (เลือกไฟล์ export รายเดือน)
   - Script: **PAS Staff View**
   - **Script parameters:**
     | พารามิเตอร์ | ค่า |
     |---|---|
     | `todayISO` | `@{outputs('todayICT')}` (หรือ output ของ Compose) |
     | `year` | `0` (เดาปีจากชื่อไฟล์ให้เอง) หรือใส่ `2026` ตรง ๆ |

4. **Save**

→ ทุกเช้า 06:00 ชีต **Staff View** ถูกสร้างใหม่: คนทำงานทุกคน **ย้อนหลังทั้งหมด + ถึงพรุ่งนี้**
พนักงานเปิดด้วยเมลกลางทีม แล้ว **AutoFilter พิมพ์รหัสตัวเอง = งานของฉัน** / พิมพ์ทีม = งานทีม

## ชี้ไฟล์เดือนปัจจุบันอัตโนมัติ (ถ้าไฟล์ export เปลี่ยนชื่อรายเดือน)
ถ้าชื่อไฟล์ย้ายตามเดือน (`PAS_2026-11.xlsx` …) ให้แทนขั้น 3 ด้วย:
1. **Compose `fileName`** = `PAS_@{convertFromUtc(utcNow(),'SE Asia Standard Time','yyyy-MM')}.xlsx`
2. **SharePoint – Get file metadata using path** → `…/{outputs('fileName')}` → ได้ **Identifier**
3. **Run script** ใช้ File = Identifier นั้น · ส่ง `year = @{convertFromUtc(utcNow(),'SE Asia Standard Time','yyyy')}`

## หมายเหตุ
- `todayISO` เว้นว่างได้ (สคริปต์ใช้วันจริงของเครื่อง) — แต่ Power Automate รันบน UTC จึงควรส่งวันเวลาไทยเข้าไปกันคลาดเคลื่อนช่วงเที่ยงคืน
- เพดาน "ถึงพรุ่งนี้" บังคับที่ **ข้อมูลในชีต** (ไม่มีวันอนาคตไกล) ไม่ใช่ที่สิทธิ์ → ปลอดภัยแม้แชร์ด้วยบัญชีกลาง
- อยากได้ล่วงหน้ามากกว่า 1 วัน แก้ `maxDate` ในสคริปต์ (`getDate()+1` → `+N`)
- รันไฟล์เดียวใช้เวลา ~10–30 วิ
