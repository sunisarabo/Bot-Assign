# WC/Porter · 12 · snippet แท็บ "งานวีลแชร์" สำหรับ scrMe จริง (PAS_Porter)

เอาไป **เสียบในหน้า scrMe ที่มีอยู่** (ไม่ใช่วางทับทั้งหน้า) · ใช้ `PAS_Porter` (lp_*) ตาม `wc-11` · สไตล์ `T.*`
พอตเตอร์เห็นเคสที่ตัวเองได้รับ/ต้องทำ ในหน้า "งานของฉัน" + กดรับทราบ/เริ่ม/จบ ได้ที่นี่ (ตารางเดียวกับ scrLP porter)

> ต้องมี **`PAS_Porter.lp_porter_code`** (เขียน emp_code ตอนจ่ายงานใน scrLP) เพื่อจับคู่แม่น · ไม่มีก็ fallback ด้วยชื่อ (เสี่ยงชื่อซ้ำ)

## 1) เพิ่มใน `scrMe.OnVisible` (ต่อท้าย)
```powerapps
// ชื่อไว้ fallback จับคู่ (ถ้ายังไม่มี lp_porter_code)
Set(varMeName, Coalesce(varMeEmp.name_en, varMeEmp.name_th, ""));
// เคสพอตเตอร์ของฉันวันนี้ + สถานะคำนวณ st
ClearCollect(colMeWC,
  AddColumns(
    Filter(PAS_Porter, day_key = varMyKey,
      (lp_porter_code = varMyCode) || (IsBlank(lp_porter_code) && lp_porter = varMeName)),
    "st", If(!IsBlank(lp_state), lp_state,
             Len(delivered_at) >= 4, "DONE",
             Len(pickup_at) >= 4, "ON_PROCESS", "NEW")))
```
> ถ้ามีตัวสลับแท็บอยู่แล้ว ใช้ `varMeTab` เดิม · ถ้ายังไม่มี ให้ Set ค่าเริ่มต้น `If(IsBlank(varMeTab), Set(varMeTab,"flight"))`

## 2) ปุ่มแท็บ (วางข้างแท็บ "งานไฟลท์")
```powerapps
btnMeTabWC.Text  = "♿ งานวีลแชร์ (" & CountRows(Filter(colMeWC, st in ["ASSIGNED","ACK","ON_PROCESS","NEW"])) & ")"
btnMeTabWC.OnSelect = Set(varMeTab, "wc")
btnMeTabWC.Fill  = If(varMeTab = "wc", T.ok, T.surface2)
btnMeTabWC.Color = If(varMeTab = "wc", Color.White, T.ink2)
// Height 36 · Radius 18 · Font T.font · Size 10 · Semibold (ให้เท่าแท็บอื่น)
```
เพิ่มจำนวน "ยังไม่รับทราบ" ของ WC เข้าไปในแถบเตือนเดิม (ถ้ามี `lblMeWarn`):
```powerapps
// + CountRows(Filter(colMeWC, st in ["NEW","ASSIGNED"]))   // ยังไม่ ACK
```

## 3) แกลเลอรี `galMeWC` (วางทับพื้นที่เดียวกับ galMe · Visible ตามแท็บ)
```powerapps
galMeWC.Visible = varMeTab = "wc"
galMeWC.Items   = SortByColumns(Filter(colMeWC, st in ["NEW","ASSIGNED","ACK","ON_PROCESS"]), "eta")
// TemplateSize 96 · TemplatePadding 6 · TemplateFill transparent
```
คอนโทรลในแถว:
```powerapps
// การ์ดพื้น (Rectangle) — สีตามสถานะ
recMWCard.Fill = Switch(ThisItem.st, "DONE", T.okSoft, "ON_PROCESS", T.skySoft, "ACK", T.infoSoft, T.warnSoft)
recMWCard.BorderColor = T.line · BorderThickness 1 · (X2 Y2 W-4 H-6)

// ข้อมูลเคส (Label — อย่าใส่ Radius ใน Label)
lblMWInfo.Text =
  "🦽 " & ThisItem.flight_no & " · " & ThisItem.service.Value &
  " · เกท " & Coalesce(ThisItem.gate, "-") &
  If(ThisItem.is_arrival, " · เข้า " & ThisItem.eta, " · ออก " & ThisItem.etd) &
  Char(10) & "สถานะ: " & ThisItem.st
lblMWInfo.Color = T.ink · Size 12 · Semibold · Font T.font

// ปุ่มเดียวเปลี่ยนตามสถานะ: รับทราบ → เริ่ม → จบ
btnMWAct.Text = Switch(ThisItem.st, "NEW","รับเคส/รับทราบ", "ASSIGNED","รับเคส/รับทราบ", "ACK","เริ่มงาน", "ON_PROCESS","จบงาน", "✓ เสร็จ")
btnMWAct.DisplayMode = If(ThisItem.st = "DONE", DisplayMode.Disabled, DisplayMode.Edit)
btnMWAct.Fill = If(ThisItem.st = "DONE", T.okSoft, T.ok)
btnMWAct.Color = If(ThisItem.st = "DONE", T.ok, Color.White)
btnMWAct.OnSelect =
  With({s: ThisItem.st},
    If(s in ["NEW","ASSIGNED"],
         Patch(PAS_Porter, ThisItem, { lp_state: "ACK", lp_ack_at: Now() }),
       s = "ACK",
         Patch(PAS_Porter, ThisItem, { lp_state: "ON_PROCESS", lp_start_at: Now(), pickup_at: Text(Now(),"hh:mm") }),
       s = "ON_PROCESS",
         Patch(PAS_Porter, ThisItem, { lp_state: "DONE", lp_done_at: Now(), delivered_at: Text(Now(),"hh:mm") })));
  Notify(Switch(ThisItem.st, "ACK","เริ่มงาน " & ThisItem.flight_no, "ON_PROCESS","จบงาน " & ThisItem.flight_no, "รับทราบ " & ThisItem.flight_no), NotificationType.Success);
  Select(btnMeTabWC)   // รีโหลด colMeWC (หรือเรียก OnVisible logic ซ้ำ)
```
> ปุ่มเดียว 3 สเต็ป (รับทราบ→เริ่ม→จบ) ให้พอตเตอร์กดง่ายบนมือถือ · อยากแยกปุ่มก็ทำ 3 ปุ่มตาม st ได้

## 4) หมายเหตุ
- **ต้องรับทราบ (ACK) ก่อนเริ่ม** — ปุ่มบังคับลำดับอยู่แล้ว (NEW/ASSIGNED→ACK→ON_PROCESS→DONE)
- `service` เป็น **Choice** → ใช้ `.Value` · ส่วน `PAS_Assignment.priority` เป็น **Text** (คนละตาราง อย่าสับสน)
- โปรดักชัน: ปุ่มที่เขียน PAS_Porter ควรผ่าน flow/plug-in บังคับกติกา (รถเข็น/สถานะไม่ถอย) ถ้าต้องการความแน่น
- จับคู่ด้วย `lp_porter_code` แม่นสุด · fallback ชื่อ `lp_porter` ใช้ชั่วคราว (ชื่อ import อาจเป็นชื่อเล่น/อังกฤษ เช่น "Worawut" — ให้ตรงกับ `name_en`)
