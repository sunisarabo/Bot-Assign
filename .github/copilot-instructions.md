# Copilot instructions — Bot-Assign (PAS · AOTGA HKT)

ระบบจัดการกำลังพล PSA/LL (Ground Handling, สนามบินภูเก็ต) — อ่านไฟล์เวรรายวัน → Dashboard / Timetable / Productivity / SLA / OT
**กำลังย้ายจาก Google (Apps Script + Sheets/Drive) ไป Microsoft 365** — งานย้ายระบบให้ใช้ agent `m365-migration`

## โครง repo
- `*.gs` — Apps Script (ระบบเดิม, ยัง production) · deploy อัตโนมัติด้วย `.github/workflows/clasp-push.yml`
- `Code.gs` — bundle ที่สร้างจาก `build_code.py` → **ห้ามแก้ตรง** แก้ที่โมดูลเดี่ยวแล้วรัน `python3 build_code.py`
- `graph/` — Node อ่าน Excel บน SharePoint ผ่าน Microsoft Graph
- `backend/` + `db/` — Node + PostgreSQL (Entra OIDC, SMTP M365)
- `powerplatform/` — Dataverse / Power Apps / Power Automate / Power BI blueprint
- `reference_parser.py` — spec อ้างอิง (Python) ใช้เทียบผล parser
- `FINDINGS.md` — กฎข้อมูล roster · `MIGRATION.md`, `docs/MIGRATION-INVENTORY.md` — แผน/สถานะการย้าย

## กฎสำคัญ
- Attendance มาจาก **REMARK** ไม่ใช่ shift code · parse ตาม **header** ไม่ใช่ชื่อแท็บ (ดู `FINDINGS.md`)
- เวลา/วันที่ใช้ `Asia/Bangkok` เสมอ
- Node 18+, CommonJS, ใช้ global `fetch`, หลีกเลี่ยง dependency ใหม่
- ห้าม commit secret / ข้อมูลพนักงานจริง
- คำอธิบายและคอมเมนต์ภาษาไทยได้ (ผู้ดูแลเป็นทีม Admin ไทย)
