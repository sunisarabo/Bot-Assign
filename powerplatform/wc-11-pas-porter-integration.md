# WC/Porter · 11 · สคีมาจริง `PAS_Porter` (lp_*) + ดึงงานพอตเตอร์เข้า "งานของฉัน"

เอกสารนี้ = **ฉบับตรงของจริง** (แทน pas_wc_* ใน wc-01..10 ที่เป็นดีไซน์คู่ขนาน) · อิง handoff schema 18 ต.ค. 2026

## PAS_Porter (~44,700 แถว · มาจาก import ไฟล์ PORTER SUMMARY รายวัน)
กรองด้วย **`day_key`** เสมอ (กรอง Title แล้ว throttle)

| คอลัมน์ | ใช้ |
|---|---|
| `Title` | `yyyy-mm-dd\|<job_no>` · LP เพิ่มเอง(walk-in) = `yyyy-mm-dd\|A<n>`, job_no 9000+ |
| `day_key` / `work_date` / `month_key` | คีย์กรอง |
| `job_no` · `flight_no` (ไม่มีรหัสสายการบิน) · `airline_iata` | |
| `service` (Choice WCHR/WCHS/WCHC/MAAS/AVIH/ETC) · `is_arrival`/`is_departure` | |
| `eta`/`etd`/`gate`/`seat`/`remark` · `notified_at`/`pickup_at`/`delivered_at`/`wait_time` (hh:mm) | |
| `porter_names` (Note) · `status` · `row_hash` | |
| **`lp_porter`** | emp_name ของพอตเตอร์ (ไม่ใช่ emp_code) |
| **`lp_state`** | NEW · ASSIGNED · ACK · ON_PROCESS · DONE (ว่าง = ยังไม่แตะ) |
| `lp_by` · `lp_assigned_at`/`lp_ack_at`/`lp_start_at`/`lp_done_at` | |

**สถานะคำนวณ (`st`):**
```powerapps
st = If(!IsBlank(lp_state), lp_state, Len(delivered_at) >= 4, "DONE", Len(pickup_at) >= 4, "ON_PROCESS", "NEW")
งานค้าง = st in ["ASSIGNED", "ACK", "ON_PROCESS"]
```

---

## 1) ดึงงานพอตเตอร์เข้า "งานของฉัน" (scrMe)

ต้องผูกพอตเตอร์ ↔ เคสด้วย **รหัส** เพื่อให้ scrMe (ที่ใช้ `varMyCode`) หาเจอ:
- **เพิ่มคอลัมน์ `lp_porter_code` (Text)** ใน PAS_Porter + ให้ปุ่มจ่ายงานใน scrLP เขียน emp_code ของพอตเตอร์ที่เลือกด้วย (ฝั่ง scrLP เพิ่มให้)
- ระหว่างยังไม่มี `lp_porter_code`: ดึงด้วย **ชื่อ** (`lp_porter = varLPMe`) ได้ชั่วคราว แต่ชื่อซ้ำ/สะกดต่างจะพลาด → แนะนำ `lp_porter_code`

**snippet สำหรับ scrMe (แท็บงานวีลแชร์) — ให้ฝั่งที่ถือ scrMe จริงเอาไปเสียบ:**
```powerapps
// โหลดเคสพอตเตอร์ของฉันวันนี้ (ใช้ lp_porter_code ถ้ามี, ไม่งั้น fallback ชื่อ)
ClearCollect(colMeWC,
  AddColumns(
    Filter(PAS_Porter, day_key = varMyKey,
      (lp_porter_code = varMyCode) || (IsBlank(lp_porter_code) && lp_porter = varMeName)),
    "st", If(!IsBlank(lp_state), lp_state, Len(delivered_at) >= 4, "DONE", Len(pickup_at) >= 4, "ON_PROCESS", "NEW")));
// แสดงเฉพาะงานค้าง
// galMeWC.Items = Filter(colMeWC, st in ["ASSIGNED","ACK","ON_PROCESS"])
```
แถวงาน:
```powerapps
lblMWInfo.Text = "🦽 " & ThisItem.flight_no & " · เกท " & Coalesce(ThisItem.gate, "-") & " · " & ThisItem.service.Value & " · " & ThisItem.st
// ปุ่ม "รับเคส/รับทราบ" → ACK
btnMWAck.DisplayMode = If(ThisItem.st in ["NEW","ASSIGNED"], DisplayMode.Edit, DisplayMode.Disabled)
btnMWAck.OnSelect =
  Patch(PAS_Porter, ThisItem, { lp_state: "ACK", lp_ack_at: Now() });
  Notify("รับทราบเคส " & ThisItem.flight_no, NotificationType.Success); Select(btnMeTabWC)
// ปุ่ม "เริ่มงาน" → ON_PROCESS + pickup_at · "จบงาน" → DONE + delivered_at
btnMWStart.OnSelect = Patch(PAS_Porter, ThisItem, { lp_state: "ON_PROCESS", lp_start_at: Now(), pickup_at: Text(Now(),"hh:mm") })
btnMWDone.OnSelect  = Patch(PAS_Porter, ThisItem, { lp_state: "DONE", lp_done_at: Now(), delivered_at: Text(Now(),"hh:mm") })
```
> ตรงกับ scrLP โหมด porter (ที่ระบุด้วยชื่อ) — scrMe เป็นอีกทางเข้าของงานเดียวกัน ใช้ตาราง/สถานะชุดเดียว

## 2) จ่ายงาน (scrLP โหมด lp) — เขียน lp_* (ของจริง)
```powerapps
// เลือกเคส (แถว PAS_Porter) + เลือกพอตเตอร์ → จ่าย
Patch(PAS_Porter, varLPCase,
  { lp_state: "ASSIGNED", lp_porter: ddLPPorter.Selected.emp_name,
    lp_porter_code: ddLPPorter.Selected.emp_code,   // ← คอลัมน์ใหม่ (ผูกรหัส)
    lp_by: User().Email, lp_assigned_at: Now() })
```
> พอตเตอร์กดรับทราบที่ scrMe หรือ scrLP porter → `lp_state = "ACK"` → เริ่ม/จบตามด้านบน

## 3) Pre-WC (จองล่วงหน้า) ↔ PAS_Porter
- PAS_Porter มีเคสจริงจาก import PORTER SUMMARY อยู่แล้ว → **ไม่ต้องสร้างเคสจาก pas_wc_prebooking ซ้ำ**
- `pas_wc_prebooking` (จาก `gen_prebooking.py`) ใช้เป็น **ข้อมูลวางแผน/คาดการณ์ของ LP** (จำนวนที่จะมา) เทียบกับเคสจริง — หรือ seed เคส walk-in (`job_no` 9000+) เมื่อไฟล์ summary ยังไม่ลง
- flow `WC Build Cases` (wc-09): ถ้าจะใช้ ให้เขียนปลายทางเป็น **PAS_Porter** (Title `day|9000+n`, service, is_arrival/departure, eta/etd, lp_state ว่าง) ไม่ใช่ pas_wc_case

## หมายเหตุแก้ของเดิมให้ตรง
- **PAS_Assignment ไม่มี `ack_by`** → ปุ่มรับทราบ Patch แค่ `{ acknowledged: true, ack_at: Now() }`
- **`priority` เป็น Text** → ใช้ `ThisItem.priority` (ไม่ใช่ `.Value`) เช่น `Switch(ThisItem.priority, "WHEELCHAIR", …)`
- wc-01..10 ที่อ้าง `pas_wc_*` = ดีไซน์คู่ขนาน · **ของจริงใช้ `PAS_Porter` (lp_*) ตามเอกสารนี้**
