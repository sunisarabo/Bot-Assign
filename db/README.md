# PAS · PostgreSQL schema (vendor-neutral migration)

`schema.sql` = แบบจำลองข้อมูลที่ปัจจุบันอยู่ใน Google Sheets ให้ย้ายมาเป็น DB มาตรฐาน
(ไม่ผูก Google/Microsoft) · ทดสอบโหลดผ่าน PostgreSQL 16 แล้ว

## โหลด schema
```bash
createdb pas
psql -d pas -f db/schema.sql
```

## ชีต/ตัวอ่านเดิม → ตาราง
| ที่มา (Sheet · .gs) | ตาราง |
|---|---|
| Master "Total" + BKK Batch 1/2 (`MasterReader.gs`) | `employee` (+ `team`, `position_group`) |
| ชีตทีมรายวัน — คน/กะ/OT/สถานะ (`RosterReader.gs`) | `duty` |
| คอลัมน์งาน/ไฟลท์ต่อคน + โซนเวลา (`RosterReader` · `JobByShift` · `AssignCheck`) | `assignment` |
| ตารางบินสัปดาห์ (`WeeklyFlight.gs`) | `flight_schedule` |
| กฎ SLA (`SLA.gs`) | `sla_rule`, `sla_config` |
| กฎรับ/ไม่รับซัพ · เช็คอินเฉพาะทีม (`AirlineSupport.gs`) | `airline_support`, `airline.ci_in_team` |
| กฎกำลังพลขั้นต่ำ (`ManningRules.gs`) | `manning_rule` |
| PORTER SUMMARY รายวัน (`Porter.gs`) | `porter_job`, `porter_staff_day` |
| PRE-WHEELCHAIR รายวัน (`PreWheelchair.gs`) | `prewheelchair_booking` |
| แบบฟอร์ม MANPOWER (`rbReadManpower_`) | `manpower_report` |
| SUPPORT REQUEST (`DutyImport.gs`) | `support_request` |

## แนวคิดหลัก
- **`duty`** = 1 คน/วัน · **`assignment`** = 1 งาน/ไฟลท์ ต่อ duty (แกนหลักของระบบ)
- ตรรกะเดิม (SLA / Productivity / AssignCheck / JobByShift) ย้ายมาเป็น backend ได้
  โดยเปลี่ยนแค่ "ตัวอ่าน" จาก Sheets → SQL — logic เป็น JS ใช้ต่อได้เกือบทั้งหมด
- View ตัวอย่าง: `v_team_daily` (สรุปรายทีม/วัน), `v_source_split` (HKT/BKK/Globex)
  ให้ผลตรงกับที่ระบบนับจากชีตทุกประการ

## Importer: duty + assignment (พร้อมใช้)
สะพานช่วงย้ายระบบ — รันตัวอ่านเดิมแล้ว export JSON → แปลงเป็น SQL ลง DB (idempotent ต่อวัน)

**ฝั่ง Apps Script** (`DbExport.gs`):
- `rbExportDayJson(iso)` → คืน JSON ของวันนั้น (PSA teams + assignments)
- `rbSaveDayJson(iso)`  → เซฟ JSON ลง Drive แล้วคืน URL (ดึงไฟล์ไป import)

**ฝั่ง Node** (`db/import.js`, ไม่พึ่ง driver — พ่น SQL):
```bash
node db/import.js pas_export_2026-09-19.json | psql -d pas
# หรือ
cat day.json | node db/import.js | psql "$DATABASE_URL"
```
- upsert team/employee stub ให้ FK ผ่าน (เติมรายละเอียดเต็มทีหลังด้วย master importer)
- ล้างข้อมูลของวันนั้นก่อน insert → รันซ้ำได้ปลอดภัย
- แมป bucket/OT/เวลา/ไฟลท์ ตามตรรกะเดิม · ทดสอบโหลด + view ผ่าน PostgreSQL 16 แล้ว

## เส้นทางย้ายข้อมูล (ภาพรวม)
1. **duty + assignment** — export JSON (`rbSaveDayJson`) → `db/import.js` → DB  ✅ *(ทำแล้ว)*
2. master importer (employee เต็ม), flights, porter, pre-WC, manpower — ทำถัดไป
3. ตั้ง import รายวัน (cron/trigger) ให้ DB เป็น system of record
4. Dashboard ต่อ DB ตรง ๆ (Metabase/Grafana) · เว็บแอปใหม่ query จาก DB

> เก็บ Sheets/Excel ไว้เป็น "ไฟล์นำเข้า" ได้ แต่ **ระบบหลักอ้างอิง DB** เพื่อไม่ผูกผู้ให้บริการเจ้าใดเจ้าหนึ่ง
