# 16 · แลกเวร (Shift Swap) ≤ 3 ครั้ง/เดือน — Power Fx (ต่อหน้า Roster)

แตะ 2 ช่องในกริด Roster → สลับกะกัน · คุมโควตา **3 ครั้ง/เดือน/คน** · log ทุกครั้ง

## 1) ตาราง `pas_swap_log` (สร้างใน Dataverse)
Tables → **+ New table** → **PAS Swap Log**
- Primary column → rename **Key** (Text)
- + columns: **EmpA**(Text) · **DateA**(Date) · **EmpB**(Text) · **DateB**(Date) · **MonthKey**(Text) · **SwappedBy**(Text) · **SwappedAt**(DateTime)

> นับโควตาของคน X เดือนนั้น = แถวที่ `MonthKey` ตรง และ `EmpA=X หรือ EmpB=X`

## 2) โหมดแลกเวร + แตะเลือก 2 ช่อง
```powerapps
// ปุ่ม "โหมดแลกเวร" (btnSwapMode.OnSelect) — เปิด/ปิด
Set(varSwapMode, !varSwapMode); Set(varSwapA, Blank()); Set(varSwapB, Blank())

// btnCell.OnSelect (ในกริด) — ตอนอยู่โหมดแลก เก็บช่องที่แตะ
If(varSwapMode,
   If(IsBlank(varSwapA),
      Set(varSwapA, { code: galStaff.Selected.code, date: ThisItem.d, id: ThisItem.id,
                      sh: ThisItem.base }),
      Set(varSwapB, { code: galStaff.Selected.code, date: ThisItem.d, id: ThisItem.id,
                      sh: ThisItem.base })
   )
)
// ไฮไลต์ช่องที่เลือก: btnCell.BorderThickness =
//   If((galStaff.Selected.code=varSwapA.code && ThisItem.d=varSwapA.date) ||
//      (galStaff.Selected.code=varSwapB.code && ThisItem.d=varSwapB.date), 3, 0)
```

## 3) ยืนยันแลก (btnSwapConfirm.OnSelect)
```powerapps
If(IsBlank(varSwapA) || IsBlank(varSwapB),
   Notify("เลือกให้ครบ 2 ช่อง", NotificationType.Warning),
   With({
       mk: Text(varM1, "yyyy-mm"),
       cntA: CountRows(Filter(pas_swap_logs, MonthKey = Text(varM1,"yyyy-mm"),
                 (EmpA = varSwapA.code) Or (EmpB = varSwapA.code))),
       cntB: CountRows(Filter(pas_swap_logs, MonthKey = Text(varM1,"yyyy-mm"),
                 (EmpA = varSwapB.code) Or (EmpB = varSwapB.code))),
       rA: LookUp(pas_duties, pas_duty = varSwapA.id),
       rB: LookUp(pas_duties, pas_duty = varSwapB.id)
   },
   If(cntA >= 3 Or cntB >= 3,
      Notify("เกินโควตาแลกเวร 3 ครั้ง/เดือน (A=" & cntA & " B=" & cntB & ")", NotificationType.Error),
      // เก็บค่าก่อนเขียนทับ
      Set(varTmpA, { sc: rA.pas_shift_code, bk: rA.pas_bucket, ot: rA.pas_ot_hours,
                     ss: rA.pas_shift_start, se: rA.pas_shift_end });
      Set(varTmpB, { sc: rB.pas_shift_code, bk: rB.pas_bucket, ot: rB.pas_ot_hours,
                     ss: rB.pas_shift_start, se: rB.pas_shift_end });
      // สลับ
      Patch(pas_duties, rA, { pas_shift_code: varTmpB.sc, pas_bucket: varTmpB.bk,
             pas_ot_hours: varTmpB.ot, pas_shift_start: varTmpB.ss, pas_shift_end: varTmpB.se });
      Patch(pas_duties, rB, { pas_shift_code: varTmpA.sc, pas_bucket: varTmpA.bk,
             pas_ot_hours: varTmpA.ot, pas_shift_start: varTmpA.ss, pas_shift_end: varTmpA.se });
      // log
      Patch(pas_swap_logs, Defaults(pas_swap_logs),
        { Key: GUID(), EmpA: varSwapA.code, DateA: varSwapA.date,
          EmpB: varSwapB.code, DateB: varSwapB.date, MonthKey: mk,
          SwappedBy: User().Email, SwappedAt: Now() });
      Notify("แลกเวรสำเร็จ", NotificationType.Success);
      Set(varSwapA, Blank()); Set(varSwapB, Blank());
      Select(btnLoad)   // รีโหลดกริด
   )))
```

## 4) โชว์โควตาเหลือ (ตัวช่วย)
```powerapps
// ต่อคนในแถว galStaff: ครั้งที่แลกเดือนนี้
"แลก " & CountRows(Filter(pas_swap_logs, MonthKey=Text(varM1,"yyyy-mm"),
         (EmpA=ThisItem.code) Or (EmpB=ThisItem.code))) & "/3"
```

## หมายเหตุ
- สลับได้ทั้ง **วันหยุด↔วันทำงาน** และ **กะต่างกัน** (แลกค่าทั้งก้อน shift/bucket/ot)
- จำกัดสิทธิ์: วาง `btnSwapMode.Visible = varPriv` (ซุปทำ) · ถ้าให้พนักงาน "ขอแลก" เองค่อยทำเป็น flow ขออนุมัติภายหลัง
- โควตานับทั้ง EmpA และ EmpB → แลก 1 ครั้งกิน 1 สิทธิ์ของทั้งคู่
- กฎ AOTGA: การสลับวันหยุดตกลง/อนุมัติได้ (หมวด 5 ข้อ 4) — ควรให้ซุปกดยืนยัน
