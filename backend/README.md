# PAS prototype backend (Node + PostgreSQL)

เว็บแอปตัวอย่างที่ **อ่านจาก DB โดยตรง** (vendor-neutral) — ไม่ผูก Google/Microsoft
ใช้ standard: Node `http` + `pg` + หน้าเว็บ static · ตั้งค่าโฮสต์ผ่าน `DATABASE_URL`

## รัน
```bash
cd backend
npm install                       # ครั้งแรก (ติดตั้ง pg)
DATABASE_URL="postgres://pas:pas@127.0.0.1:5432/pas" npm start
# เปิด http://localhost:3000
```
(ใส่ข้อมูลก่อนด้วย importer ใน `../db/` — schema + import.js ฯลฯ)

## โครง
| ไฟล์ | หน้าที่ |
|---|---|
| `db.js` | Pool เชื่อม Postgres (env `DATABASE_URL`) |
| `queries.js` | ชั้น query อ่านอย่างเดียว (summary / timetable / flights / porter / dates) |
| `server.js` | HTTP + routing + เสิร์ฟหน้า dashboard |
| `public/index.html` | หน้า dashboard (โทน AOTGA) เรียก API |

## หน้าเว็บ (แท็บ)
📊 ภาพรวม · 🧑‍✈️ Timetable · ✈️ ไฟลท์ · 🧳 Porter · ♿ Pre-WC จอง — เลือกวันที่มุมขวาบน
(dropdown วันที่รวมทั้งวันที่มี duty และวันที่มี **จองล่วงหน้า** → เลือกวันอนาคตดู Pre-WC ได้)

## API
- `GET /api/health` · `GET /api/dates` (รวม duty + จองล่วงหน้า)
- `GET /api/summary?date=YYYY-MM-DD` — KPI + รายทีม (`v_team_daily`) + แยกกลุ่ม (`v_source_split`) + ไฟลท์ + porter + manpower
- `GET /api/timetable?date=` — รายคน + กะ + งาน/ไฟลท์ที่ได้รับ
- `GET /api/flights?date=` · `GET /api/porter?date=` · `GET /api/prewc?date=` (จองล่วงหน้า · ดูอนาคตได้)

## ทำไมแบบนี้ = ย้ายได้
- data อยู่ใน **Postgres ของเราเอง** · โค้ดเป็น Node ใส่ Docker รันที่ไหนก็ได้
- ต่อ login มาตรฐาน (OIDC → Microsoft Entra/Google/Keycloak) เพิ่มทีหลังได้
- ตรรกะเดิม (SLA/Productivity เป็น JS) ย้ายมาเป็น query/โมดูลใน `queries.js` ได้ต่อ

> prototype นี้โชว์ headcount/แยกกลุ่ม/ไฟลท์/porter จาก DB จริง · ขั้นต่อไปยก SLA/Productivity/Gantt มาเต็ม
