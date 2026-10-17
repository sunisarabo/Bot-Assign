# 20 · จัดการไฟลท์ (เพิ่ม/แก้/ยกเลิก) + re-import ตารางบิน — Power Fx

ไฟลท์เปลี่ยนตลอด (ดีเลย์/ยกเลิก/เพิ่มเที่ยว) → ต้อง เพิ่ม·แก้·ลงยกเลิก ได้ในแอป + นำเข้าตารางใหม่ทับได้

## 0) เพิ่มคอลัมน์ใน `pas_flight`
- **pas_status** (Choice: `SCHEDULED` · `ADDED` · `CHANGED` · `CANCELLED`) default SCHEDULED
- **pas_flightkey** (Text) = `FlightNo_Date_Direction` ← ใช้เป็น **Alternate key** (upsert ตอน re-import)
- **pas_remark** (Text) — เหตุผล/หมายเหตุ
- ตั้ง Alternate key: Tables → PAS Flight → **Keys → + New key** → เลือก `pas_flightkey`

> CSV `pas_flight_int.csv` มี `pas_flightkey`/`pas_status` ให้แล้ว

## 1) หน้าจัดการไฟลท์ (scrFlights)
```powerapps
// เลือกวัน + ทีม
Set(varFDate, dpFlt.SelectedDate);
ClearCollect(colFlt,
  SortByColumns(
    Filter(pas_flights, pas_flight_date = varFDate,
      /* ทีม (ถ้ากรอง) */ LookUp(pas_team_airlines, Airline = pas_airline_iata).Team = ddFTeam.Selected.pas_name),
    "pas_sta"));
// galFlt.Items = colFlt — แสดง pas_name · เวลา · route · pas_status
// สีสถานะ: ยกเลิก=แดงจาง
galFlt.TemplateFill = If(ThisItem.pas_status.Value="CANCELLED", RGBA(255,230,230,1),
                         ThisItem.pas_status.Value="ADDED", RGBA(230,245,255,1), White)
```

## 2) แก้ไขไฟลท์ (EditForm)
```powerapps
// frmFlt.DataSource = pas_flights · frmFlt.Item = galFlt.Selected
// Fields: pas_name, pas_flight_date, pas_airline_iata, pas_direction,
//         pas_sta, pas_std, pas_aircraft_type, Gate, pas_remark
// ปุ่มบันทึก
btnSaveFlt.OnSelect =
  SubmitForm(frmFlt);
  Patch(pas_flights, galFlt.Selected, { pas_status: { Value: "CHANGED" } });
  Notify("บันทึกการแก้ไขไฟลท์แล้ว", NotificationType.Success)
```
> เวลา STA/STD เก็บเป็นนาที (เช่น 390 = 06:30) — แสดง/กรอกเป็น HH:MM แล้วแปลง:
> `pas_sta = Hour(tpSta.Selected)*60 + Minute(...)` · แสดง `Text(..HH:MM..)`

## 3) เพิ่มไฟลท์ใหม่ (NewForm)
```powerapps
btnNewFlt.OnSelect = NewForm(frmFlt); Set(varShowFlt, true)
// ปุ่มบันทึกเพิ่ม:
btnAddFlt.OnSelect =
  Patch(pas_flights, Defaults(pas_flights),
    { pas_name: txtFltNo.Text,
      pas_flightkey: txtFltNo.Text & "_" & Text(dpNew.SelectedDate,"yyyy-mm-dd") & "_" & ddDir.Selected.Value,
      pas_flight_date: dpNew.SelectedDate,
      pas_airline_iata: txtAir.Text, pas_direction: ddDir.Selected,
      pas_sta: Hour(tpSta.Selected)*60+Minute(tpSta.Selected),
      pas_std: Hour(tpStd.Selected)*60+Minute(tpStd.Selected),
      pas_aircraft_type: txtAc.Text, pas_status: { Value: "ADDED" },
      pas_remark: txtRemark.Text });
  Notify("เพิ่มไฟลท์แล้ว", NotificationType.Success); Select(btnLoadFlt)
```

## 4) ลงยกเลิก (Cancel)
```powerapps
btnCancelFlt.OnSelect =
  Patch(pas_flights, galFlt.Selected,
    { pas_status: { Value: "CANCELLED" }, pas_remark: txtRemark.Text });
  // ปลด/ตีธงงานที่ผูกไฟลท์นี้ (assignment)
  ForAll(Filter(pas_assignments, pas_name = galFlt.Selected.pas_name,
                pas_duty.pas_work_date = galFlt.Selected.pas_flight_date) As a,
    Patch(pas_assignments, a, { pas_task: "[CANCELLED] " & a.pas_task }));
  Notify("ยกเลิกไฟลท์ " & galFlt.Selected.pas_name & " แล้ว", NotificationType.Warning);
  Select(btnLoadFlt)
```
> ไฟลท์ยกเลิก = ไม่ลบแถว (เก็บประวัติ) แค่ `pas_status=CANCELLED` · กรองออกจากหน้าจัด assignment ได้ด้วย `pas_status.Value <> "CANCELLED"`

## 5) re-import ตารางบินที่อัปเดต (Power Automate / Import)
- **แบบไฟล์:** Tables → PAS Flight → Import data from Excel → `pas_flight_int.csv` (ใหม่)
  → เพราะมี **Alternate key `pas_flightkey`** ระบบจะ **อัปเดตแถวที่ตรง / เพิ่มแถวใหม่** (upsert) ไม่ซ้ำ
- **อัตโนมัติ:** Flow (Recurrence) อ่าน CSV บน SharePoint → Dataverse **Upsert** ด้วย `pas_flightkey`
  → เที่ยวใหม่เพิ่มเอง · เวลาเปลี่ยนอัปเดตเอง (ไฟลท์ที่ลงยกเลิกมือไว้ ให้ flow ข้ามถ้า status=CANCELLED)

## หมายเหตุ
- กรองหน้า assignment/sizing ให้ **ตัด CANCELLED** ออก: `Filter(pas_flights, …, pas_status.Value <> "CANCELLED")`
- ไฟลท์ ADDED/CHANGED มือ จะไม่ถูก re-import ทับถ้า flow เช็ก `pas_status` ก่อน (คงการแก้มือไว้)
- สิทธิ์: เพิ่ม/แก้/ยกเลิก เฉพาะ `varPriv` (ซุป/duty)
