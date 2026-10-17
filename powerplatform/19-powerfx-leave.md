# 19 · บันทึกขอลาในกริด Roster (SL/VL/BL/…) — Power Fx

แตะช่องในกริด → เลือกประเภทลา → อัปเดต `pas_duty` + log `pas_leave_request` + เช็กโควตาตามกฎ HR

## รหัสลา → pas_bucket + โควตา (จาก `hr-rules.md`)
| ปุ่ม | ความหมาย | pas_bucket | โควตา/กฎ |
|---|---|---|---|
| **SL** | ลาป่วย | SICK | ≤30 วัน/ปี · ติดกัน ≥3 วันต้องมีใบแพทย์ |
| **VL** | พักร้อน (Annual) | VACATION | 6/8/10 วัน (อายุงาน ≥1/≥3/≥7 ปี) · ติดกัน ≤5 · ยื่น ≥3 วัน |
| **BL** | ลากิจ (Business) | LEAVE | 5 วัน/ปี (รายเดือน) · ติดกัน ≤2 |
| **ML** | ลาคลอด | LEAVE | ≤120 วัน · ยื่น ≥30 วัน |
| **PL** | ลาอื่น ๆ | LEAVE | ตามระเบียบ |
| **M/A/N** | ทำงาน | WORKING | — |
| **OFF** | วันหยุด | OFF | — |

## 1) ตาราง `pas_leave_request`
Tables → **+ New table** → **PAS Leave Request**
- Primary → **Key** (Text) · + columns: **EmpCode**(Text) · **LeaveType**(Text) · **LeaveDate**(Date) ·
  **Status**(Choice: PENDING/APPROVED/REJECTED) · **Reason**(Text) · **RequestedBy**(Text) · **RequestedAt**(DateTime)
> นับโควตา = แถวที่ EmpCode/LeaveType ตรง + ปีเดียวกัน (Status APPROVED)

## 2) แตะช่อง → เปิดป๊อปอัปเลือก (ไม่อยู่โหมดแลก)
```powerapps
// btnCell.OnSelect (ต่อจากโหมดแลก) — ถ้าไม่ได้แลกและเป็นซุป → เปิดป๊อปอัป
If(!varSwapMode && varPriv,
   Set(varEditCell, { code: galStaff.Selected.code, date: ThisItem.d, id: ThisItem.id });
   Set(varShowPick, true))
// คอนเทนเนอร์ popPick.Visible = varShowPick
```

## 3) ปุ่มในป๊อปอัป — ตัวช่วยบันทึก (วางเป็น OnSelect ของแต่ละปุ่ม)
**ปุ่มลา เช่น SL** (เปลี่ยนรหัส/bucket ตามตารางบน):
```powerapps
// เช็กโควตาก่อน (เตือน ไม่บล็อก — ซุป override ได้)
With({ usedSL: CountRows(Filter(pas_leave_requests, EmpCode=varEditCell.code,
         LeaveType="SL", Year(LeaveDate)=Year(varEditCell.date), Status.Value="APPROVED")) },
  If(usedSL >= 30, Notify("⚠️ ลาป่วยเกิน 30 วัน/ปี (ใช้ไป " & usedSL & ")", NotificationType.Warning)));
// อัปเดตกะเป็นลา
Patch(pas_duties, LookUp(pas_duties, pas_duty = varEditCell.id),
  { pas_shift_code: "SL", pas_bucket: { Value: "SICK" },
    pas_ot_hours: 0, pas_shift_start: Blank(), pas_shift_end: Blank() });
// log คำขอ (ซุปกด = อนุมัติเลย)
Patch(pas_leave_requests, Defaults(pas_leave_requests),
  { Key: GUID(), EmpCode: varEditCell.code, LeaveType: "SL", LeaveDate: varEditCell.date,
    Status: { Value: "APPROVED" }, RequestedBy: User().Email, RequestedAt: Now() });
Set(varShowPick, false); Select(btnLoad)
```
**ปุ่ม VL** เหมือนกันแต่ `"VL"` / bucket `"VACATION"` + เช็กโควตาตามอายุงาน:
```powerapps
With({ emp: LookUp(pas_employees, pas_name = varEditCell.code),
       usedVL: CountRows(Filter(pas_leave_requests, EmpCode=varEditCell.code, LeaveType="VL",
                 Year(LeaveDate)=Year(varEditCell.date), Status.Value="APPROVED")) },
 With({ yrs: DateDiff(emp.pas_start_date, varEditCell.date, Years),
        ent: If(yrs>=7,10, yrs>=3,8, yrs>=1,6, 0) },
   If(usedVL >= ent, Notify("⚠️ พักร้อนเกินสิทธิ์ (" & usedVL & "/" & ent & ")", NotificationType.Warning))));
Patch(pas_duties, LookUp(pas_duties, pas_duty=varEditCell.id),
  { pas_shift_code:"VL", pas_bucket:{Value:"VACATION"}, pas_ot_hours:0,
    pas_shift_start:Blank(), pas_shift_end:Blank() });
Patch(pas_leave_requests, Defaults(pas_leave_requests),
  { Key:GUID(), EmpCode:varEditCell.code, LeaveType:"VL", LeaveDate:varEditCell.date,
    Status:{Value:"APPROVED"}, RequestedBy:User().Email, RequestedAt:Now() });
Set(varShowPick,false); Select(btnLoad)
```
**ปุ่ม BL/ML/PL** = ก็อปโครง เปลี่ยน `"BL"`/bucket `"LEAVE"` (BL เช็ก ≤5/ปี) · **ปุ่มทำงาน (M/A/N)** = set shift_code+WORKING+เวลา · **OFF** = bucket OFF
> ลบคำขอลา (ถ้ากดผิด): เปลี่ยนช่องกลับเป็นกะ → ลบแถว `pas_leave_request` ของ (EmpCode,LeaveDate) ด้วย

## 4) โชว์รหัสลาในกริด + สี
```powerapps
// base ในการสร้าง colGrid (ข้อ 14) ครอบคลุม shift_code อยู่แล้ว → SL/VL/BL จะโชว์เป็นตัวอักษร
// เพิ่มสีลงใน btnCell.Fill:
Switch(ThisItem.base,
  "M",RGBA(255,243,191,1),"A",RGBA(208,235,255,1),"N",RGBA(229,219,255,1),
  "OFF",RGBA(241,243,245,1),
  "SL",RGBA(255,201,201,1),"VL",RGBA(211,249,216,1),"BL",RGBA(255,236,179,1),
  "ML",RGBA(255,216,168,1),"PL",RGBA(232,222,248,1), White)
```

## 5) โควตาคงเหลือ (แสดงต่อคน)
```powerapps
// ในแถว galStaff — ลาป่วย/พักร้อน ใช้ไปปีนี้
"SL " & CountRows(Filter(pas_leave_requests, EmpCode=ThisItem.code, LeaveType="SL",
         Year(LeaveDate)=Year(varDate), Status.Value="APPROVED")) & "/30 · " &
"VL " & CountRows(Filter(pas_leave_requests, EmpCode=ThisItem.code, LeaveType="VL",
         Year(LeaveDate)=Year(varDate), Status.Value="APPROVED")) & " · " &
"BL " & CountRows(Filter(pas_leave_requests, EmpCode=ThisItem.code, LeaveType="BL",
         Year(LeaveDate)=Year(varDate), Status.Value="APPROVED")) & "/5"
```

## หมายเหตุ
- ซุปกดในกริด = อนุมัติทันที (Status APPROVED) · ถ้าให้พนักงาน "ขอลา" เองค่อยเริ่ม Status PENDING + หน้าอนุมัติ
- โควตาเป็น **เตือน** ไม่บล็อก (ซุปตัดสินใจ) — อยากบล็อกเปลี่ยน `Notify` เป็นหยุดก่อน Patch
- ลาติดกัน (เช่น SL ≥3 วันต้องมีใบแพทย์) เตือนเพิ่มได้จากนับวันต่อเนื่อง
- generator roster รอบถัดไปจะข้ามคนที่ลา/ไม่ว่างได้ ถ้า feed `pas_leave_request` กลับเข้า `--leave` (ทำเพิ่มภายหลัง)
