# Migration Inventory — Google Apps Script → Microsoft 365

> ทะเบียนสถานะการย้ายแต่ละโมดูล · ใช้คู่กับ agent `.github/agents/m365-migration.agent.md`
> อัปเดตแถวทุกครั้งที่พอร์ตโมดูลเสร็จ (สถานะ + ไฟล์ปลายทาง + วันที่ verify parity)

**Legend สถานะ:** ✅ พอร์ตแล้ว + verify · 🟡 พอร์ตบางส่วน · ⬜ ยังไม่เริ่ม · ➖ ไม่ต้องย้าย (เครื่องมือเฉพาะ Google)
**Track:** A = Graph + Node (`graph/`) · B = Postgres + Node (`backend/`, `db/`) · C = Power Platform (`powerplatform/`)

## 1. โมดูลอ่าน/แปลงข้อมูล (core — ทำก่อน)

| โมดูล .gs | บรรทัด | Google services ที่ใช้ | ปลายทาง | สถานะ | หมายเหตุ |
|---|---:|---|---|---|---|
| `RosterReader.gs` | 1297 | SpreadsheetApp, DriveApp | A `graph/parseDay.js` · B `db/import.js` | 🟡 | ต้องยืนยัน parity ครบทุก layout (TR variant, PORTER, PORTER CREWSIGN, ADMIN DOC, SU templates) เทียบ `reference_parser.py` |
| `MasterReader.gs` | 216 | SpreadsheetApp | B `db/import_master.js` | 🟡 | ฝั่ง Graph (อ่าน Master `Total` จาก SharePoint) ยังไม่มี |
| `LLReader.gs` | 317 | SpreadsheetApp, ScriptApp | A / B | ⬜ | LL section-based layout · ใช้ `reference_parser.py --ll` เป็น spec |
| `WeeklyFlight.gs` | 291 | SpreadsheetApp, DriveApp, Drive API (convert) | B `db/import_flights.js` | 🟡 | Graph อ่าน .xlsx ตรง → ตัดขั้น convert ทิ้ง |
| `Porter.gs` | 317 | SpreadsheetApp, DriveApp, CacheService, PropertiesService | B `db/import_porter.js` | 🟡 | |
| `PreWheelchair.gs` | 110 | SpreadsheetApp, DriveApp, PropertiesService | B `db/import_prewc.js` | 🟡 | |
| `DbExport.gs` | 182 | SpreadsheetApp, DriveApp | (สะพานชั่วคราว) | ➖ | ใช้ระหว่าง parallel run เท่านั้น — เลิกเมื่อ cut-over |

## 2. โมดูล logic บริสุทธิ์ (ไม่แตะ Google service → พอร์ตตรงเป็น Node ได้เลย)

| โมดูล .gs | บรรทัด | ปลายทาง | สถานะ | หมายเหตุ |
|---|---:|---|---|---|
| `Productivity.gs` | 308 | `backend/productivity.js`, `graph/compute.js`, `powerplatform/office-script-util.ts` | 🟡 | `win_lo/win_hi` ยังประมาณ (DEP_LEAD 60 / ARR_TAIL 45 / DEF_JOB 45) |
| `SLA.gs` | 1189 | B / A | ⬜ | ต้อง populate `sla_rule` / `manning_rule` |
| `AirlineSupport.gs` | 96 | B / A | ⬜ | |
| `AssignCheck.gs` | 606 | B / A | ⬜ | |
| `AutoPlan.gs` | 563 | B / A | ⬜ | |
| `JobByShift.gs` | 134 | B / A | ⬜ | |

## 3. โมดูลที่ผูก I/O หนัก (ต้องออกแบบ adapter)

| โมดูล .gs | บรรทัด | Google services | ปลายทาง Microsoft | สถานะ |
|---|---:|---|---|---|
| `WebDashboard.gs` | 2892 | HtmlService, doGet, CacheService, LockService, UrlFetchApp, … | A `graph/server.js` + `public/index.html` · B `backend/server.js` · C Power Apps | 🟡 |
| `RosterBot.gs` | 1155 | DriveApp, Drive API, UrlFetchApp (Google Chat), ScriptApp triggers | Node job (cron / Container Apps Job) + **Teams** แทน Google Chat | ⬜ |
| `OTDashboard.gs` | 647 | DriveApp, UrlFetchApp, CacheService, ScriptApp | B + Power BI | ⬜ |
| `OTCompare.gs` | 249 | SpreadsheetApp, PropertiesService | B | ⬜ |
| `WorkHours.gs` | 202 | SpreadsheetApp, PropertiesService | B | ⬜ |
| `ManningRules.gs` | 105 | SpreadsheetApp, CacheService | B (`manning_rule`) / C | ⬜ |
| `AdvancePlan.gs` | 1196 | GmailApp, MailApp, ScriptApp triggers | B + SMTP M365 (`backend/mailer.js`) | ⬜ |
| `DutyImport.gs` | 423 | GmailApp (อ่านเมล), PropertiesService | Graph `Mail.Read` หรือ Power Automate "When a new email arrives" | ⬜ |
| `RosterGen.gs` | 285 | SpreadsheetApp, DriveApp | Graph write Excel / B | ⬜ |
| `FormSetup.gs` | 203 | SpreadsheetApp, DriveApp | Power Apps form / Microsoft Forms / หน้าเว็บ B | ⬜ |
| `Code.gs` | 13080 | (bundle จาก `build_code.py`) | — | ➖ ไม่พอร์ต — แก้ที่โมดูลเดี่ยว |

## 4. Config / Script Properties → env (ต้องตั้งฝั่ง Microsoft)

| เดิม (Script Property / CONFIG) | ใหม่ (env / Key Vault) |
|---|---|
| `ROOT_FOLDER_ID` (Drive ปีของไฟล์เวร) | `SP_HOSTNAME`, `SP_SITE_PATH`, `SP_ROOT_FOLDER` |
| `OUTPUT_FOLDER_ID` | `SP_OUTPUT_FOLDER` หรือเขียนลง DB |
| `GCHAT_WEBHOOK_REPORT` | `TEAMS_WEBHOOK_URL` (Workflows / Power Automate) |
| `MANNING_SHEET_ID`, `WF_FILE_ID`, ไฟล์ Master / Porter / Pre-WC | path ของไฟล์บน SharePoint (`SP_*_PATH`) |
| บัญชี Google (login web app) | `OIDC_*` (Entra ID) — `backend/auth.js` |
| Gmail | `SMTP_*` (`smtp.office365.com:587`) — `backend/mailer.js` |
| Graph app | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` (secret → Key Vault) |

## 5. Triggers → Scheduler

| GAS trigger เดิม | เวลา (Asia/Bangkok) | ปลายทาง |
|---|---|---|
| `runDailyRosterReport` | 08:00, 14:00 | Container Apps Job / cron / Power Automate Recurrence |
| `apNotifyMissingDaily` | รายวัน (ตั้งค่าได้) | เดียวกัน + Teams/Outlook |
| `rbCounterBridgeRefresh` | 01:00 | เดียวกัน |
| `rbWarmCache` (5 นาที), `otWarmCache` (10 นาที) | ทุก 5/10 นาที | ไม่จำเป็นถ้า server cache ต่อวัน (`graph/server.js`) |

> Azure ใช้ UTC — ตั้ง cron เป็น UTC (08:00 ICT = 01:00 UTC) หรือกำหนด `TZ=Asia/Bangkok` ใน container

## 6. Parity checklist (ต้องผ่านก่อน cut-over)

- [ ] Headcount ต่อทีม (working / ot_off / off / sick / leave) ตรงกับ GAS ทุกทีม ≥ 14 วันติดกัน
- [ ] OT คน + OT ชั่วโมง ตรง
- [ ] Flights ต่อทีม + ต่อคน ตรง
- [ ] LL sections ตรง
- [ ] Util% / Gantt ต่างไม่เกิน 0.1 pp
- [ ] SLA coverage (ครบ/ขาด/ซัพ) ตรง
- [ ] รายงานแจ้งเตือนเข้า Teams/Outlook ตามเวลา
- [ ] Login Entra ใช้ได้ทุก role (Admin PSA / Admin LL / Director)
