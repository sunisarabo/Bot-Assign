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
| `queries.js` | ชั้น query อ่านอย่างเดียว (summary / timetable / flights / porter / prewc / dates) |
| `auth.js` | OIDC login มาตรฐาน (Entra-ready · ตั้งค่าผ่าน env) |
| `mailer.js` | ส่งอีเมลผ่าน SMTP (Microsoft 365-ready · ตั้งค่าผ่าน env) |
| `server.js` | HTTP + routing + auth gate + เสิร์ฟหน้า dashboard |
| `public/index.html` | หน้า dashboard (โทน AOTGA) เรียก API + ปุ่ม login |

## Login ด้วย Microsoft (OIDC · Entra ID)
เป็น OIDC มาตรฐาน — ชี้ Microsoft ตอนนี้ได้ ถ้าย้ายอนาคตเปลี่ยนแค่ env (ไม่ผูกเจ้า)

**ตั้งใน Entra (Azure) → App registrations → New registration:**
1. Redirect URI (Web) = `https://<โฮสต์>/auth/callback`
2. Certificates & secrets → New client secret → คัดลอกค่า
3. เก็บ **Application (client) ID** และ **Directory (tenant) ID**

**env:**
```bash
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=<application-client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_REDIRECT_URI=https://<โฮสต์>/auth/callback
SESSION_SECRET=<สุ่มยาว ≥32 ตัว>
AUTH_REQUIRED=1        # บังคับ login (ไม่ตั้ง = เปิดดูได้ ช่วง dev)
COOKIE_SECURE=1        # เมื่อรันหลัง HTTPS
```
routes: `/auth/login` · `/auth/callback` · `/auth/logout` · `/auth/me`
ไม่ตั้ง OIDC_* → login ปิด เว็บยังรันแบบเปิด (prototype)
> prototype เก็บ session ใน memory · โปรดักชันควรใช้ store ร่วม (Redis) + หลาย instance

## แจ้งเตือนอีเมลผ่าน Microsoft 365 (SMTP)
```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587                       # STARTTLS
SMTP_USER=notify@yourdomain.com
SMTP_PASS=<app password / secret>
SMTP_FROM=PAS แจ้งเตือน <notify@yourdomain.com>
```
- `GET /api/mail/verify` — ทดสอบ login SMTP (ไม่ส่งจริง)
- `POST /api/mail/test {"to":"..."}` — ส่งอีเมลทดสอบ
- ไม่ตั้ง SMTP_* → แจ้งเตือนปิด ระบบยังรันได้

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
