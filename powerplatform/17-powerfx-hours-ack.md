# 17 · ชม.ทำงาน/OT (B) + รับทราบงาน (Acknowledge) + แจ้งเตือน — Power Fx

## B · ดู ชม.ทำงาน / ชม.OT (เพิ่มในหน้า Roster)
ชม.ทำงาน = ผลรวมความยาวกะของวันที่ขึ้นงาน · ชม.OT = ผลรวม `pas_ot_hours`

### ต่อคน (ในแถว galStaff)
```powerapps
With({
  wh: Sum(Filter(colDuty, pas_employee.pas_name = ThisItem.code,
                 pas_bucket.Value in ["WORKING","OT_OFF"]),
          (pas_shift_end - pas_shift_start) / 60),
  ot: Sum(Filter(colDuty, pas_employee.pas_name = ThisItem.code), pas_ot_hours)
},
  "ทำงาน " & Round(wh,0) & " ชม. · OT " & Round(ot,0) & " ชม."
)
```

### การ์ด KPI รวมทีม (บนหน้า)
```powerapps
lblTeamWork.Text = Round(Sum(Filter(colDuty, pas_bucket.Value in ["WORKING","OT_OFF"]),
                             (pas_shift_end - pas_shift_start)/60), 0) & " ชม."
lblTeamOT.Text   = Round(Sum(colDuty, pas_ot_hours), 0) & " ชม."
// เตือนเกินเพดาน OT (36 ชม./สัปดาห์ ≈ 155/เดือน) ต่อคน → แดง
lblOTWarn.Text = CountRows(
  AddColumns(GroupBy(colDuty,"pas_employee","g"),
    "ot", Sum(g, pas_ot_hours)) ) & " คน — เช็กคนเกิน 36 ชม./สัปดาห์"
```
> ความยาวกะ: N 1260–1800, M 300–840, A 780–1320 (นาที) = 9 ชม. ต่อกะ · OFF = 0

---

## C · รับทราบงาน (Acknowledge) ก่อนเริ่มงาน
กฎ: พนักงาน **ต้องกด "รับทราบ"** assignment ของตัวเองก่อน จึงเริ่มงาน/กดสถานะอื่นได้

### เพิ่มคอลัมน์ใน `pas_assignment`
- **pas_acknowledged** (Yes/No, default No) · **pas_ack_at** (DateTime) · **pas_ack_by** (Text)

### หน้า "งานของฉัน" (ต่อจาก 09) — gallery งานของวันนี้
```powerapps
// งานของฉันวันนี้ (join assignment ↔ duty ของตัวเอง)
ClearCollect(colMyAsg,
  Filter(pas_assignments,
    pas_duty.pas_work_date = varDate,
    pas_duty.pas_employee.pas_name = varCode));

// แบนเนอร์เตือนถ้ายังมีงานไม่รับทราบ
lblAckBanner.Text = "⚠️ มีงานยังไม่รับทราบ " &
  CountRows(Filter(colMyAsg, pas_acknowledged <> true)) & " งาน — กดรับทราบก่อนเริ่มงาน"
lblAckBanner.Visible = CountRows(Filter(colMyAsg, pas_acknowledged <> true)) > 0
```

### ปุ่ม "รับทราบ" ในแต่ละงาน
```powerapps
btnAck.Visible  = ThisItem.pas_acknowledged <> true
btnAck.OnSelect =
  Patch(pas_assignments, ThisItem,
    { pas_acknowledged: true, pas_ack_at: Now(), pas_ack_by: varCode });
  Notify("รับทราบงาน " & ThisItem.pas_name & " แล้ว", NotificationType.Success)

// (ตัวเลือก) รับทราบทั้งหมดทีเดียว
btnAckAll.OnSelect = ForAll(Filter(colMyAsg, pas_acknowledged<>true) As r,
  Patch(pas_assignments, r, { pas_acknowledged:true, pas_ack_at:Now(), pas_ack_by:varCode }))
```

### ล็อก "เริ่มงาน" จนกว่าจะรับทราบ
```powerapps
btnStartJob.DisplayMode = If(ThisItem.pas_acknowledged = true, DisplayMode.Edit, DisplayMode.Disabled)
// หรือทั้งหน้า: ปุ่มเริ่มงานทุกปุ่ม Disabled ถ้ายังมีงานไม่ ack
```
> ซุปเห็นสถานะรับทราบได้ (คอลัมน์ pas_ack_at) → รู้ว่าใครยังไม่รับงาน

---

## D · แจ้งเตือน (พอตเตอร์รับเคสวีลแชร์ / งานซัพพอร์ต)
⚠️ **พอตเตอร์ไม่มีบัญชี M365** → push รายคนผ่าน Power Apps ไม่ได้ · มี 3 ทางเลือก:

| ช่องทาง | ใช้ได้กับพอตเตอร์? | วิธี |
|---|---|---|
| **In-app live** (แนะนำ) | ✅ | แอปพอตเตอร์ (จอรวม/เมลกลาง) มี **Timer** รีเฟรชทุก ~20 วิ → ถ้ามีเคสใหม่ของรหัสที่เลือก เด้งแบนเนอร์ + เสียง |
| **LINE Notify** | ✅ | flow ส่งเข้า **กลุ่ม LINE ทีม** เมื่อมีเคสใหม่/งานซัพ (token กลาง, ไม่ต้องบัญชีรายคน) |
| Power Apps push | ❌ | ต้องบัญชี M365 รายคน — ใช้ได้เฉพาะ PSA ที่มีบัญชี (ซุป/duty) |

### In-app live (Power Fx ฝั่งพอตเตอร์)
```powerapps
// Timer (Repeat=true, Duration=20000) .OnTimerEnd:
ClearCollect(colMyCases,
  Filter(pas_porter_jobs, pas_work_date = Today(),
         /* porter = รหัสที่เลือก */ pas_porter_names = varMyName,
         pas_acknowledged <> true));
If(CountRows(colMyCases) > CountRows(colPrev),
   Notify("🔔 มีเคสวีลแชร์ใหม่ " & CountRows(colMyCases) & " เคส", NotificationType.Information));
ClearCollect(colPrev, colMyCases)
```
> พอตเตอร์กด **"รับเคส"** = Acknowledge เหมือนข้อ C แล้วค่อยกด เริ่ม/จบงาน (ตาม WC Tracker เดิม)

### LINE Notify (flow)
Power Automate: trigger **When a row is added** (`pas_porter_job` / `pas_assignment` ที่เป็นงานซัพ)
→ HTTP POST `https://notify-api.line.me/api/notify` header `Authorization: Bearer <TOKEN>`
body `message=เคสใหม่ <flight> <service> รับที่ <gate>` → เข้า LINE กลุ่มทีม

> งานซัพพอร์ต (ข้ามทีม) ใช้กลไกเดียวกัน: assignment ที่มี flag ซัพ → แจ้งทีมปลายทาง
