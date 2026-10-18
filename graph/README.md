# PAS บน Microsoft — พอร์ต code + ฐานข้อมูล = Excel บน SharePoint

ย้าย logic จาก Google Apps Script → **Node app** ที่อ่านไฟล์เวร Excel บน **SharePoint** ผ่าน **Microsoft Graph API**
(แทน Google Sheets/Drive) · โฮสต์บน Azure · login Entra

```
Excel บน SharePoint (Shared Documents/2025/<เดือน>/<วัน>.xlsx)
   → Microsoft Graph API (อ่าน worksheet ทั้งชื่อแท็บ + ค่าเซลล์)
   → parseDay (duty / assignment / manpower)
   → [ป้อน db/import.js → Postgres]  หรือ  [เสิร์ฟ dashboard ตรง ๆ]
```

> **แม่นกว่าเดิม:** Graph ให้ **ชื่อแท็บจริง** → รู้ทีมแน่นอน (เดิมอ่านจาก Google export ชื่อแท็บหาย ต้องเดาจากลำดับ)

## ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `graphClient.js` | ต่อ Graph (client-credentials) + อ่าน SharePoint/Excel (site→drive→folder→worksheet) |
| `readDay.js` | หาไฟล์เวรของวันที่กำหนด (root→เดือน→วัน) แล้วอ่านทุกชีต |
| `parseDay.js` | แปลงค่าเซลล์ → duty/assignment/manpower (พอร์ตจาก RosterReader/parse_daily_workbook) |
| `index.js` | CLI: สรุป หรือพ่น JSON |

## ตั้งสิทธิ์ (ครั้งเดียว) — Entra app + Graph permission
1. Entra → App registrations → New (หรือใช้ตัวเดิม) → เก็บ **Client ID** + สร้าง **client secret**
2. **API permissions → Add → Microsoft Graph → Application permissions** → เพิ่ม **`Sites.Read.All`** + **`Files.Read.All`**
   → กด **Grant admin consent** (ต้องเป็นแอดมิน)

## env
```bash
GRAPH_TENANT_ID=619b9081-4c12-4243-af65-d67cb3b41d81
GRAPH_CLIENT_ID=<app id>
GRAPH_CLIENT_SECRET=<secret>
SP_HOSTNAME=aotgath.sharepoint.com
SP_SITE_PATH=/sites/0AAYJ05_KoLORUk9PVA
SP_ROOT_FOLDER=/Shared Documents/2025      # โฟลเดอร์ปีที่มีโฟลเดอร์เดือน (เช่น 09.SEP26)
```

## รัน (ในเครื่อง — เครื่องคุณต่อ SharePoint ได้)
```bash
node graph/index.js 2026-09-19                      # สรุป: ทีม/คน/assignment/manpower
node graph/index.js 2026-09-19 --json > pas_day.json
node db/import.js pas_day.json | psql -d pas        # (ถ้าจะเก็บลง Postgres ด้วย)
```

## ไฟล์เวรต้องอยู่บน SharePoint
ย้าย/สำเนา workbook รายวันขึ้น **SharePoint (Shared Documents/2025/<เดือน>/)** เป็น `.xlsx`
- โครงในไฟล์เหมือนเดิม: แท็บ `MANPOWER` + แท็บรายทีม (ชื่อแท็บ = รหัสทีม)
- Graph workbook API อ่าน `.xlsx` ได้ตรง ไม่ต้อง export

## เว็บ Dashboard (`server.js`)
เสิร์ฟหน้าเว็บ (โทน AOTGA) อ่าน Excel ผ่าน Graph ตรง ๆ · cache ต่อวัน · แท็บ ภาพรวม/Timetable/Productivity/Gantt/Manpower
```bash
# ต่อ SharePoint จริง (ตั้ง env GRAPH_*/SP_* ตามด้านบน)
node graph/server.js            # เปิด http://localhost:3000

# พรีวิว UI โดยยังไม่ต่อ Graph (ใช้ข้อมูลตัวอย่าง graph/demo.json)
PAS_DEMO=1 node graph/server.js
```
API: `/api/day` · `/api/timetable` · `/api/productivity` · `/api/gantt` (ทุกตัวรับ `?date=YYYY-MM-DD`) · `/api/health`

| ไฟล์เพิ่ม | หน้าที่ |
|---|---|
| `compute.js` | คำนวณ Util/Gantt/รายชั่วโมง/รายทีม จากผล parse (ยกจาก backend/productivity.js) |
| `server.js` | HTTP + cache ต่อวัน + เสิร์ฟ dashboard/API |
| `public/index.html` | หน้า dashboard (แท็บ · SVG กราฟ+Gantt · hover) |
| `demo.json` | ข้อมูลตัวอย่างสำหรับ `PAS_DEMO=1` |

## Deploy Azure
Dockerfile แบบเดียวกับ `backend/` ได้ (Node 20-alpine · `CMD node server.js`) → Azure Container Apps
ตั้ง env `GRAPH_*` + `SP_*` เป็น secret · เปิด egress ให้ `graph.microsoft.com` + `login.microsoftonline.com`

## หมายเหตุ
- ต้องมี Node 18+ (ใช้ global fetch)
- network ที่รัน ต้องต่อ `graph.microsoft.com` ได้ (เครื่อง/Azure ต่อได้ · sandbox ของผู้ช่วยบล็อก — จึงทดสอบ Graph สดในนี้ไม่ได้ แต่ parser ทดสอบ logic แล้ว)
