# PAS · แผนย้ายระบบ (Google → ระบบของเราเอง / vendor-neutral)

> เป้าหมาย: **ย้ายทุกอย่างเข้าระบบเดียว** ที่เป็นของเราเอง ไม่ผูก Google และไม่ผูก Microsoft
> ข้อมูลอยู่ใน **PostgreSQL** · โค้ดเป็น **Node** (ใส่ Docker รันที่ไหนก็ได้) · login/อีเมลต่อผ่านมาตรฐาน (OIDC/SMTP)
>
> วันนี้บริษัทกำลังย้ายอีเมลไป Microsoft (Outlook) — เอกสารนี้ทำให้ระบบ PAS **ไม่ผูกกับเจ้าใดเจ้าหนึ่ง**
> จะอยู่บน Google ต่อ, ย้ายไป Microsoft, หรือรันเองบนเซิร์ฟเวอร์บริษัทก็ได้ โดยไม่ต้องเขียนใหม่

---

## ภาพรวมสถาปัตยกรรม

```
ที่มาข้อมูล (ชั่วคราว)         สะพานย้าย                 ระบบหลัก (ปลายทาง)
─────────────────────       ─────────────           ────────────────────────
Google Sheets / Excel  ──►  export JSON  ──►  import ──►  PostgreSQL  ──►  Backend (Node)  ──►  เว็บ/แดชบอร์ด
(Apps Script DbExport.gs)   (Drive/ไฟล์)    (db/*.js)     (schema.sql)     (backend/)          (index.html / Metabase)
```

- **ระยะเปลี่ยนผ่าน:** ยังกรอกใน Sheets/Excel ได้ แต่ทุกคืน export → import เข้า DB (DB = system of record)
- **ปลายทาง:** เลิกพึ่ง Sheets — กรอก/อ่านผ่านเว็บแอปที่ต่อ DB ตรง ๆ

---

## 1) เตรียม PostgreSQL + schema

```bash
createdb pas
psql -d pas -f db/schema.sql          # 17 ตาราง + enum + view (v_team_daily, v_source_split)
```
(รันที่ไหนก็ได้: เครื่องบริษัท, VM, หรือ managed Postgres — ไม่ผูกผู้ให้บริการ)

## 2) Export ข้อมูลจากระบบเดิม (ฝั่ง Apps Script)

รันใน editor (เมนู Run) — ผลลง Google Drive เป็นไฟล์ JSON:

| ฟังก์ชัน | ได้อะไร | ความถี่ |
|---|---|---|
| `rbSaveMasterJson()`      | `pas_master.json` — พนักงานทั้งหมด (Total + BKK Batch ทุกแท็บ, source HKT/BKK/Globex) | เมื่อรายชื่อเปลี่ยน |
| `rbSaveAllDay('2026-09-19')` | 5 ไฟล์ของวันนั้น: `pas_day_ · pas_flights_ · pas_porter_ · pas_prewc_ · pas_manpower_` | รายวัน |

## 3) Import เข้า DB (ฝั่ง Node — ไม่พึ่ง driver, พ่น SQL, idempotent ต่อวัน)

```bash
node db/import_master.js   pas_master.json              | psql -d pas   # employee (รันก่อน)
node db/import.js          pas_day_2026-09-19.json      | psql -d pas   # duty + assignment
node db/import_flights.js  pas_flights_2026-09-19.json  | psql -d pas   # flight_schedule
node db/import_porter.js   pas_porter_2026-09-19.json   | psql -d pas   # porter_job + porter_staff_day
node db/import_prewc.js    pas_prewc_2026-09-19.json    | psql -d pas   # prewheelchair_booking
node db/import_manpower.js pas_manpower_2026-09-19.json | psql -d pas   # manpower_report
```
- ทุกตัว **ลบข้อมูลของวันนั้นก่อน insert** → รันซ้ำได้ปลอดภัย
- รายละเอียด mapping ดู `db/README.md`

## 4) รันเว็บแอปที่อ่านจาก DB (ฝั่ง Node)

```bash
cd backend && npm install
DATABASE_URL="postgres://pas:pas@127.0.0.1:5432/pas" npm start   # http://localhost:3000
```
แท็บ: 📊 ภาพรวม · 🧑‍✈️ Timetable · ✈️ ไฟลท์ · 🧳 Porter · ♿ Pre-WC จอง (ดูวันอนาคตได้)
รายละเอียด API ดู `backend/README.md`

## 5) อัตโนมัติรายวัน

โหลดทุกไฟล์ของวันในคำสั่งเดียว (idempotent · ข้ามไฟล์ที่ไม่มี):
```bash
DATABASE_URL="postgres://pas:pas@host/pas" db/load_all.sh <โฟลเดอร์> 2026-09-19          # รายวัน
DATABASE_URL="postgres://pas:pas@host/pas" db/load_all.sh <โฟลเดอร์> 2026-09-19 --master  # โหลด master ด้วย
```
ตั้ง **cron** (เช่นตี 1 ทุกวัน โหลดของเมื่อวาน หลัง Apps Script export ลงโฟลเดอร์ sync):
```cron
0 1 * * *  DATABASE_URL="postgres://pas:pas@host/pas" /path/db/load_all.sh /path/exports "$(date -d yesterday +\%F)" >> /var/log/pas_import.log 2>&1
```
- **ช่วงยังใช้ Sheets:** trigger (Apps Script) รัน `rbSaveAllDay(iso)` ทุกคืน → sync ไฟล์ลงโฟลเดอร์ → cron ข้างบนโหลดเข้า DB
- **หลังเลิกใช้ Sheets:** กรอกผ่านเว็บ → เขียนลง DB ตรง ไม่ต้อง export/import อีก

---

## Google → Microsoft: checklist ให้ "ไม่ผูกเจ้าใดเจ้าหนึ่ง"

| เรื่อง | เดิม (Google) | ทำให้เป็นกลาง | หมายเหตุ |
|---|---|---|---|
| ที่เก็บข้อมูล | Google Sheets | **PostgreSQL** ของเราเอง | ทำแล้ว (schema + importer) |
| แอป/โลจิก | Apps Script | **Node** ใน Docker | prototype ใน `backend/` แล้ว |
| Login | บัญชี Google | **OIDC** → Microsoft Entra ID (`backend/auth.js`) | ✅ ทำแล้ว · ตั้งค่าผ่าน env ย้ายเจ้าได้ |
| อีเมลแจ้งเตือน | Gmail/GAS | **SMTP** → Microsoft 365 (`backend/mailer.js`) | ✅ ทำแล้ว · เปลี่ยนปลายทางได้โดยไม่แก้โลจิก |
| ไฟล์แนบ/รายงาน | Google Drive | **S3-compatible** (MinIO/Azure Blob) | มาตรฐานเดียว ย้ายได้ |
| แดชบอร์ด | เว็บ GAS | เว็บ Node เอง หรือ **Metabase/Grafana** ต่อ DB | อ่านจาก DB ตัวเดียวกัน |

**หลักการ:** เก็บ *ข้อมูล* ในรูปแบบเปิด (SQL) + *โลจิก* ในโค้ดพกพาได้ (Node/Docker) + ต่อบริการภายนอกผ่าน *มาตรฐาน* (OIDC/SMTP/S3)
→ ย้าย Google↔Microsoft↔on-prem ได้โดยเปลี่ยนแค่ "ปลั๊ก" ไม่ใช่เขียนระบบใหม่

---

## สถานะปัจจุบัน

- ✅ schema (17 ตาราง + view) — โหลดผ่าน PostgreSQL 16
- ✅ importer ครบ: master · duty+assignment · flights · porter · pre-WC · manpower (idempotent ต่อวัน)
- ✅ exporter ฝั่ง Apps Script (`DbExport.gs`) — `rbSaveAllDay` / `rbSaveMasterJson`
- ✅ backend Node + เว็บ 7 แท็บ อ่านจาก DB จริง (ภาพรวม/Timetable/Productivity/Gantt/ไฟลท์/Porter/Pre-WC)
- ✅ **Login ด้วย Microsoft (OIDC/Entra)** + **แจ้งเตือนอีเมลผ่าน Microsoft 365 (SMTP)** — ตั้งค่าผ่าน env (ดู `backend/README.md`)
- ✅ **Productivity + Gantt** ยกเป็นโมดูลบน DB (`backend/productivity.js`) · Util% รายคน/ทีม + รายชั่วโมง
- ✅ **session/สถานะ login ใน Postgres** (`backend/store.js`) → รองรับหลาย instance (สลับ Redis ได้)
- ✅ **auto-import รายวัน** (`db/load_all.sh` + ตัวอย่าง cron)
- ⬜ ยก **SLA เต็ม** (coverage/ครบ-ขาด/ซัพ) มาเป็น query/โมดูล — ต้อง populate `sla_rule`/`manning_rule` + export `win_lo/win_hi` เพื่อ Util แม่นเต็ม
