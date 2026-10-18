# WC/Porter · 10 · ตาราง `pas_wc_prebooking` + populate

ต้นทางเดียวของเคสวีลแชร์ (จองล่วงหน้าต่อไฟลท์) → flow `WC Build Cases` (`wc-09`) แตกเป็นเคสรายตัว

> ⚠️ **ปลายทางเคส:** แอปจริงใช้ **`PAS_Porter` (lp_*)** ไม่ใช่ `pas_wc_case` — ตาราง `pas_wc_prebooking` (ต้นทาง) ใช้ได้เลย แต่ flow build ต้องเขียนลง `PAS_Porter`/`lp_*` ตามจริง (รอ export scrLP เพื่อ map คอลัมน์)

## 1) สร้างตาราง `pas_wc_prebooking`
make.powerapps.com → **+ New table** → **PAS WC Prebooking**
- Primary column → **Key** (Text) = `<Flt no.>|<YYYY-MM-DD>` (ใช้เป็น **Alternate Key** upsert ด้วย)

| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `pas_bookingdate` | Date Only | วันของเที่ยวบิน |
| `pas_flightno` | Text | เช่น `410/411` (รวมขาเข้า/ออก) |
| `pas_airline` | Text | IATA |
| `pas_routing` | Text | เช่น AUH-HKT-AUH |
| `pas_sta` · `pas_std` | Text (HH:MM) | เวลาถึง/ออก |
| `pas_ctopen` · `pas_ctclose` | Text (HH:MM) | เคาน์เตอร์เปิด/ปิด |
| `arr_wchr` `arr_wchs` `arr_wchc` `arr_avih` `arr_maas` | Whole number | จำนวนขาเข้า ต่อบริการ |
| `dep_wchr` `dep_wchs` `dep_wchc` `dep_avih` `dep_maas` | Whole number | จำนวนขาออก ต่อบริการ |

> Alternate Key: **Keys → + New key → `Key`** (จะได้ upsert ตอน import/flow)

## 2) Populate — จากไฟล์ PRE-WHEELCHAIR
สร้าง CSV ด้วย generator (อ่านแท็บรายวัน `01OCT26`…):
```bash
python3 tools/gen_prebooking.py  "OCT_2026_PRE-WHEELCHAIR.xlsx"  --nonzero  -o pas_wc_prebooking.csv
```
> `--nonzero` = เก็บเฉพาะไฟลท์ที่มีจองจริง (เทสต์: ต.ค. 1079 ไฟลท์-วัน → 216 แถวมีจอง) · ตัดออกได้ถ้าอยากเก็บครบ
คอลัมน์ CSV ตรงกับตาราง (Key, pas_bookingdate, pas_flightno, …, arr_*/dep_*)

**นำเข้า:**
- **IMP-X:** ตาราง → Import data from Excel → map → key = `Key`
- **IMP-DF (ซ้ำรายวัน):** Dataflow อ่าน CSV/ไฟล์ → upsert key `Key` (ดู `28`)
- หรือ **Office Script** อ่านแท็บรายวันตรง ๆ (คอลัมน์เดียวกับ generator: Arrival 9-13 · DEP 15-19) → Power Automate upsert

## 3) ต่อ flow `WC Build Cases` (`wc-09`)
flow อ่าน `pas_wc_prebooking` ของวัน → แตก `arr_*`/`dep_*` (5 บริการ × 2 ทิศ รวม AVIH) เป็น `pas_wc_case` รายเคส (idempotent `CaseNo`)
> หลังสร้างตาราง + flow + **Add flow เข้าแอป** → ผมเพิ่มปุ่ม **สร้างเคสจาก Pre-WC** กลับเข้า scrLP ให้ (ตอนนี้ตัดไว้)

## 4) โครงไหลข้อมูล
```
PRE-WHEELCHAIR.xlsx → gen_prebooking.py → pas_wc_prebooking (จองล่วงหน้า)
   → flow WC Build Cases → pas_wc_case (รายเคส STANDBY)
      → scrLP โหมด lp (จ่ายงาน) → scrLP โหมด porter / งานของฉัน (รับทราบ)
```
