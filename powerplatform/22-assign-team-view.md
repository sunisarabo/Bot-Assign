# 22 · เพิ่มมุมมอง "👥 รายทีม (MANPOWER)" ในหน้า scrAssign

ต่อจากหน้า scrAssign ที่มี **▦ ตารางรายคน** + **✈ รายไฟลท์** แล้ว → เพิ่มมุมมองที่ 3 **รายทีม**
สรุปกำลังพลทุกทีมของวันนั้น ตามฟอร์ม MANPOWER (ทั้งหมด/ตามตาราง/ลาแต่ละชนิด/อบรม/ทำงานจริง/ชม.OT)

> ใช้ชื่อ data source/ฟิลด์เดียวกับหน้าคุณ: `PAS_Duty` (team·day_key·bucket·shift_code·ot_hours) · `PAS_Employees` (team)

## 1) โหลดข้อมูลทุกทีมของวัน (เพิ่มใน `btnALoad.OnSelect`)
เติมใน `Concurrent(...)` ที่มีอยู่ อีก 2 บรรทัด:
```powerapps
ClearCollect(colMPDuty, Filter(PAS_Duty, day_key = varAKey)),        // ทุกทีมของวันนั้น
ClearCollect(colMPEmp, PAS_Employees)                                 // ไว้นับกำลังพลรวม
```
> ถ้า PAS_Employees เยอะเกิน 2000 ให้โหลดเฉพาะ active: `Filter(PAS_Employees, status <> "Resigned")`

## 2) ปุ่มสลับมุมมอง (วางข้าง btnAViewG / btnAViewF)
```powerapps
btnAViewT:
  Text: "👥 รายทีม"
  Fill:  =If(varAView="team", RGBA(255,255,255,1), RGBA(48,84,150,1))
  Color: =If(varAView="team", RGBA(48,84,150,1), RGBA(255,255,255,1))
  X: =Parent.Width - 540   // เลื่อน btnAViewG/F ไปทางซ้ายให้พอ
  Y: =10 · Width: =130 · Height: =36
  OnSelect: =Set(varAView, "team")
```
> แก้ `Visible` ของ control มุมมองเดิมให้ซ่อนตอนรายทีม:
> galAHdr / galAStaff / recAHdrL / lblAH* → `Visible = varAView = "grid"` (เดิมเป็น `<> "flight"`)
> galAFv / htmlAFv / galAFvStaff → `Visible = varAView = "flight"` (เหมือนเดิม)

## 3) ตาราง MANPOWER (HtmlViewer `htmlAMP`)
```powerapps
htmlAMP:
  Control: HtmlViewer
  Visible: =varAView = "team"
  X: =16 · Y: =104 · Width: =Parent.Width - 32 · Height: =Parent.Height - 112
  HtmlText: |-
    =With({teams: ["AK","CHN","EK","EY","JQ","KE","PG","QR","SQ","SU","TK","TR","WYG9","SVWK","CHARTER","PORTER","PVTLP","DOM","ZF"]},
      "<div style='font:12px Segoe UI,Tahoma,sans-serif;overflow:auto;height:" & (Self.Height-12) & "px'>" &
      "<div style='background:#305496;color:#fff;padding:8px 12px;font-size:16px;font-weight:bold'>แบบฟอร์มรายงานกำลังพลประจำวัน · " & varAKey & "</div>" &
      "<table style='border-collapse:collapse;width:100%'>" &
      "<tr>" & Concat(["ทีม","ทั้งหมด","ตามตาราง","ลาป่วย","ลากิจ","พักร้อน","ลาคลอด","ลาอื่น","อบรม","ทำงานจริง","ชม.OT รวม"] As h,
        "<th style='padding:5px 8px;background:#305496;color:#fff;text-align:center;position:sticky;top:0'>" & h.Value & "</th>") & "</tr>" &
      Concat(teams As t,
        With({
          tot: CountRows(Filter(colMPEmp, team = t.Value)),
          sch: CountRows(Filter(colMPDuty, team = t.Value, bucket.Value in ["WORKING","OT_OFF"])),
          sl:  CountRows(Filter(colMPDuty, team = t.Value, shift_code = "SL")),
          bl:  CountRows(Filter(colMPDuty, team = t.Value, shift_code = "BL")),
          vl:  CountRows(Filter(colMPDuty, team = t.Value, shift_code = "VL")),
          ml:  CountRows(Filter(colMPDuty, team = t.Value, shift_code = "ML")),
          lo:  CountRows(Filter(colMPDuty, team = t.Value, bucket.Value = "LEAVE", !(shift_code in ["BL","ML"]))),
          trn: CountRows(Filter(colMPDuty, team = t.Value, bucket.Value = "TRAINING")),
          ot:  Round(Sum(Filter(colMPDuty, team = t.Value), ot_hours), 1)
        },
        "<tr style='text-align:center'><td style='padding:4px 8px;border:1px solid #D6E4F2;text-align:left;font-weight:bold'>Team (" & t.Value & ")</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & tot & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2;background:#E2EFDA'>" & sch & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & sl & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & bl & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & vl & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & ml & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & lo & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & trn & "</td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2;background:#FFF2CC'><b>" & (sch - sl - bl - vl - ml - lo - trn) & "</b></td>" &
        "<td style='padding:4px 8px;border:1px solid #D6E4F2'>" & ot & "</td></tr>")) &
      "</table></div>")
```
> **ทำงานจริง** = ตามตาราง − ลาทุกชนิด (คนที่ลงกะแต่ลา) · **ชม.OT รวม** = Σ ot_hours ของทีมวันนั้น
> `btnALoad` ปุ่ม Prev/Next (varAView<>"flight") ให้เพิ่ม `&& varAView<>"team"` ที่ Visible ด้วย (รายทีมไม่ต้องเลื่อน)

## 4) (ตัวเลือก) เพิ่ม OT ก่อน/หลังกะ ในมุมมองรายคน
ไฟล์จริงแยก **OT ก่อนกะ / หลังกะ (IN/OUT/Total)** — ถ้าต้องการ เพิ่มคอลัมน์ใน `PAS_Duty`:
`ot_pre_in/ot_pre_out/ot_pre_hrs` · `ot_post_in/ot_post_out/ot_post_hrs` แล้วโชว์ใน galAStaff
(ตอนนี้ roster รวมเป็น `ot_hours` ก้อนเดียว — แยกได้ภายหลังถ้าต้องกรอกเวลา OT จริง)
