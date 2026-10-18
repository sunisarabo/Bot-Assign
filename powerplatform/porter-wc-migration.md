# WC Tracker → โมดูลใน PWMS (Power Platform)

ร่างตารางข้อมูลที่โมดูล WC ต้องใช้ ดึงจากโค้ดจริงใน `Code.gs` / `Index.html`
ทุกฟิลด์ที่ระบบปัจจุบันอ่านหรือเขียน อยู่ในเอกสารนี้ครบ

**เวอร์ชันที่ร่างจาก:** `3f4f60b` (v5.0 + งานค้าง + ลดจำนวนครั้งที่ต้องกด)

---

## สิ่งที่ต้องรู้ก่อนอ่านตาราง

### 1. Porter ~76 คนไม่มีบัญชี Microsoft 365

Canvas app บังคับล็อกอิน Entra ID ทุกคน — **ฝั่ง porter จึงขึ้น Power Apps ไม่ได้**
สถาปัตยกรรมที่เอกสารนี้ตั้งสมมติฐานไว้:

| ฝั่ง | ใครใช้ | อยู่บนอะไร |
|---|---|---|
| LP — จ่ายงาน · คิว · สรุป · ตารางเวร · งานค้าง | LP/หัวหน้า ~5-10 คน | โมดูลใน PWMS |
| Porter — งานของฉัน · รับทราบ · กดเริ่ม/จบงาน | porter ~76 คน | **Power Pages** (เว็บ anonymous · มือถือส่วนตัว) — `wc-04` · หรือ canvas บนจอรวม — `wc-03` · ชี้มาที่ตารางชุดนี้ |

ทั้งสองฝั่งอ่าน-เขียน **ตารางชุดเดียวกัน** ตารางในเอกสารนี้จึงต้องเข้าถึงได้จากทั้งสองทาง
(Dataverse → Web API + service principal · SharePoint → REST/Graph)

### 2. ปัจจุบันไม่มี "ฐานข้อมูล" — มีแต่ชีทที่คนกรอกมือ

แหล่งข้อมูลทั้ง 4 ที่ระบบอ่านอยู่:

| ไฟล์ | เจ้าของ | รูปแบบ | ระบบทำอะไรกับมัน |
|---|---|---|---|
| `Daily Flight Schedule Record 2026` | OPS | tab รายเดือน (`SEP2026`) | อ่านเท่านั้น |
| `MMM YYYY PORTER SUMMARY` | OCC/VIP | **tab รายวัน · ไฟล์ใหม่ทุกเดือน** | อ่าน **และเขียนกลับ** |
| `MMM YYYY PRE-WHEELCHAIR` | LP | **tab รายวัน · ไฟล์ใหม่ทุกเดือน** | อ่านเท่านั้น |
| `WC Tracker Log` | ระบบนี้ | 5 ชีท | เขียนเท่านั้น |

"ไฟล์ใหม่ทุกเดือน + tab ใหม่ทุกวัน" คือเหตุผลที่โค้ดมี `getPorterFileName()`,
`findPorterDayTab()`, `findPreDayTab()` ไว้เดาชื่อไฟล์/tab เอง — **ย้ายเป็นตารางแล้วโค้ดชุดนี้หายไปทั้งก้อน**
วันที่กลายเป็นคอลัมน์ธรรมดา

### 3. รายชื่อพนักงานกับรถเข็น ตอนนี้ฝังอยู่ในโค้ดหน้าเว็บ

`STAFF[]` 76 คน · `WC[]` 67 คัน · `ROMAN{}` ตารางแปลงชื่อไทย→อังกฤษ — hardcode อยู่ใน `Index.html`
แก้รายชื่อ = แก้โค้ด + deploy ใหม่ **ข้อนี้ตารางจริงดีกว่าชัดเจน ไม่มีข้อเสีย**

---

## ภาพรวมตาราง

```
Staff ──────┬── RosterDay (ตารางเวรรายวัน)
            ├── QueueEntry (คิวรายวัน)
            ├── CaseAssignment (M:N ผ่าน CasePorter)
            ├── Trip
            └── WheelchairStatus (ผู้แจ้งซ่อม)

Wheelchair ─┬── Trip
            └── WheelchairStatus

Flight ─────┬── Case ──┬── CasePorter ── Staff
            │          └── Trip
            └── PreBooking

(รายวัน ไม่ผูกใคร) DemandWindow · ManpowerWindow · DailySummary · AssignLog
```

---

# 1 · Wheelchair — ทะเบียนรถเข็น

มาจาก `WC[]` ใน `Index.html` (67 คัน) — ตอนนี้เป็น hardcode

| ฟิลด์ | ชนิด | มาจากไหน | หมายเหตุ |
|---|---|---|---|
| `WheelchairId` | Autonumber / PK | — | ใหม่ |
| `ControlNo` | Text(20) · unique | `WC[].ctrl` | `AOTGA-WH-1` … `AOTGA-WH-67` · **คีย์ที่ระบบใช้จริงทุกที่** |
| `ShortNo` | Text(10) | `WC[].no` | `WH-1` … `WH-67` · แสดงบนปุ่ม |
| `Type` | Choice | `WC[].type` | ใหญ่ (44) · เคบิ้น (10) · กลาง (7) · พับขา (4) · Extra (2) |
| `IsActive` | Yes/No | — | **ใหม่** — ตอนนี้ปลดระวางรถเข็นไม่ได้ ต้องลบออกจากโค้ด |

> `ControlNo` เป็นคีย์ที่ใช้ทั่วระบบ (`trips[ctrl]`, `wcRepair[ctrl]`, `TripLog.รถเข็น`)
> อย่าเปลี่ยนรูปแบบตอนย้าย ไม่งั้นข้อมูลเดิมจับคู่ไม่ได้

---

# 2 · Staff — ทะเบียนพนักงาน

มาจาก `STAFF[]` + `ROMAN{}` ใน `Index.html` (76 คน) — ตอนนี้เป็น hardcode

| ฟิลด์ | ชนิด | มาจากไหน | หมายเหตุ |
|---|---|---|---|
| `StaffId` | Text(10) · PK | `STAFF[].id` | รหัสพนักงาน `2304628` |
| `FullNameTh` | Text(100) | `STAFF[].name` | `ฉัตรชัย ฤทธิปู่` |
| `NickTh` | Text(40) | `STAFF[].nick` | `ฉัตรชัย` · ใช้แสดงทุกหน้าจอ |
| `NameEn` | Text(60) | `ROMAN[id]` | `Chatchai` — **ต้องสะกดตรงกับที่ชีทเขียน** |
| `IsActive` | Yes/No | — | ใหม่ |

### ⚠ `NameEn` คือหนี้ทางเทคนิคที่ควรจบในการย้ายครั้งนี้

ชีท PORTER SUMMARY เขียนชื่อ porter เป็น **ข้อความอังกฤษ** ในช่องเดียว หลายคนคั่นด้วย comma
(`"Chatchai, Teerapong"`) ระบบจึงต้อง:

- `splitPorters()` แยกชื่อออกจากข้อความ
- `normName()` ตัดช่องว่าง/จุด/ตัวพิมพ์ แล้วเทียบแบบ **ยอมให้เป็นคำขึ้นต้นของกันและกัน**
  เพราะชีทสะกดไม่นิ่ง — `A Meen` vs `Ameen` · `Wuttichai K.` vs `Wutichai S.`
- ตาราง `ROMAN` 76 แถวที่ต้องตามแก้ทุกครั้งที่ชีทสะกดเปลี่ยน (แก้ไปแล้ว 21 ชื่อระหว่างพัฒนา)

**ย้ายเป็นตารางแล้วใช้ `StaffId` เป็น foreign key ปัญหานี้หายทั้งก้อน**
`NameEn` เหลือไว้เป็นแค่ฟิลด์แสดงผล/นำเข้าข้อมูลเก่า ไม่ใช่คีย์อีก

**แต่ตอนนำเข้าข้อมูลเก่าจะต้องใช้มันจับคู่** — และจำนวนคนสองฝั่งไม่เท่ากัน:

| | จำนวน |
|---|---|
| `STAFF[]` / `ROMAN{}` ในแอป | **76** |
| บล็อก STAFF RECORD ในชีท (วัดเมื่อ 20 ก.ย.) | **77** |

สองชื่อที่เห็นในชีทแล้วจับคู่กับแอปไม่ได้: `Sirichai` (#76) · `NAWAF` (#77)

**ต้องกระทบยอดรายชื่อให้ตรงก่อนนำเข้า** ไม่งั้นเคสของคนที่จับคู่ไม่ได้จะหาเจ้าของไม่เจอ
(ส่วนต่างไม่ใช่ 2 พอดี แปลว่ามีคนในแอปที่ไม่อยู่ในชีทวันนั้นด้วย — ต้องไล่ทีละชื่อ)

---

# 3 · Flight — ตารางบินรายวัน

มาจาก `Daily Flight Schedule Record 2026` tab รายเดือน · อ่านเท่านั้น (`COL`)

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `FlightId` | Autonumber / PK | — | ใหม่ |
| `FlightDate` | Date | `COL.DATE` (0) | คอลัมน์แรกไม่มีหัวตาราง เป็น Date object |
| `Airline` | Text(3) | `COL.AIRLINE` (1) | IATA — `TG`, `EY`, `PG` |
| `FlightNo` | Text(20) | `COL.FLTNO` (2) | **มีรูปแบบ `410/411`** = ขาเข้า/ขาออกคู่กัน |
| `Routing` | Text(40) | `COL.ROUTING` (3) | `AUH-HKT-AUH` |
| `STA` / `STD` | Text(5) | `COL.STA` (4) / `COL.STD` (5) | `HH:mm` |
| `ETA` / `ETD` | Text(5) | `COL.ETA` (8) / `COL.ETD` (9) | `HH:mm` |
| `AcType` | Text(10) | `COL.ACTYPE` (6) | `B78X` |
| `Remark` | Text(255) | `COL.REMARK` (16) | |
| `Status` | Text(40) | `COL.STATUS` (20) | `On time` / `Delayed` / `Cancelled` |
| `FlightType` | Choice | `COL.FLTTYPE` (21) | `Quickturn` / `Departure` / `Arrival` → ARR/DEP/QT |

### ไม่มีของเทียบ → ต้องเขียนใหม่เป็น business logic

| ตอนนี้ทำโดย | ทำอะไร |
|---|---|
| `fmtTime()` | เวลาในชีทมาได้ 4 แบบ: Date object · `0715` · `19.00` · **`1900(-1)`** (= เที่ยวบินข้ามวัน) โค้ดดึงเลข 3-4 หลักชุดแรกออกมาแล้วตรวจช่วง — ถ้าปล่อยผ่านเคยได้ `190:01` |
| ตัดเที่ยวบินยกเลิก | `/cancel\|postpon/i` สแกน **4 คอลัมน์** (ETA, ETD, Status, TYPE OF FLIGHT) เพราะเจ้าหน้าที่บางคนพิมพ์ "Cancelled" ลงช่อง ETA แทนช่อง Status |
| `getFlightType()` | ถ้าคอลัมน์ TYPE OF FLIGHT ว่าง ต้องเดาจาก Routing (นับว่า HKT อยู่ตรงไหน) |

> **ข้อเสนอ:** ถ้า Power Automate ดึงตารางบินเข้าตารางจริงได้ ให้ทำ normalisation
> ตอน ingest ครั้งเดียว แล้วเก็บ `STA`/`STD` เป็น `Time`/`DateTime` จริง ไม่ใช่ข้อความ
> ทั้ง 3 ข้อข้างบนจะเหลือแค่ขั้นตอน ingest ไม่ใช่โค้ดที่หน้าจอต้องรู้

---

# 4 · Case — เคสที่ assign (หัวใจของระบบ)

มาจาก `MMM YYYY PORTER SUMMARY` **tab รายวัน** (`PCOL`) — ระบบ **อ่านและเขียนกลับ**

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `CaseId` | Autonumber / PK | — | ใหม่ |
| `CaseDate` | Date | ชื่อ tab (`20SEP26`) | **วันที่อยู่ในชื่อ tab ไม่ได้อยู่ในแถว** |
| `CaseNo` | Whole number | `B` · `PCOL.NO` (1) | "ที่" — เลขลำดับในวันนั้น |
| `Airline` | Text(3) | `C` · `PCOL.AIRLINE` (2) | IATA · ค่า `ETC` = เคสที่ไม่ผูกไฟลท์ |
| `FlightNo` | Text(20) | `D` · `PCOL.FLTNO` (3) | |
| `FlightId` | Lookup → Flight | — | **ใหม่** — ตอนนี้ไม่มีความสัมพันธ์ จับคู่ด้วยข้อความ |
| `Status` | Choice | `F` · `PCOL.STATUS` (5) | `STANDBY` · `ON PROCESS` · `COMPLETED` · `CANCELLED` |
| `Eta` / `Etd` | Text(5) | `G` (6) / `I` (8) | |
| `StandbyArr` | Text(5) | `H` (7) | เวลาสแตนบายขาเข้า — **ระบบยังไม่ได้ใช้** |
| `BoardingTime` | Text(5) | `J` (9) | **ยังไม่ได้ใช้** |
| `GateStandbyChk` | Yes/No | `K` (10) · checkbox | **ยังไม่ได้ใช้** |
| `LpName` | Text(40) | `L` (11) | ชื่อ LP — **ยังไม่ได้ใช้** |
| `Gate` | Text(10) | `M` · `PCOL.GATE` (12) | ประตูทางออก |
| `NotifiedTime` | Text(5) | `N` · `PCOL.NOTIFIED` (13) | เวลาที่ได้รับแจ้งเคส |
| `PickupMark` | Yes/No | `O` · `PCOL.PICKUP_MARK` (14) | checkbox · **ระบบเขียน** |
| `PickupTime` | Text(5) | `P` · `PCOL.PICKUP_TIME` (15) | **ระบบเขียน** ตอนกดเริ่มงาน |
| `DeliverTime` | Text(5) | `Q` · `PCOL.DELIVER_TIME` (16) | **ระบบเขียน** ตอนกดจบงาน |
| `ServiceType` | Choice | `R` · `PCOL.SVC` (17) | `WCHR` · `WCHS` · `WCHC` · `MAAS` · `AVIH` |
| `IsArrival` | Yes/No | `S` · `PCOL.ARR_CHK` (18) | checkbox |
| `IsDeparture` | Yes/No | `T` · `PCOL.DEP_CHK` (19) | checkbox |
| `VerifiedChk` | Yes/No | `U` (20) | ตรวจสอบแล้ว — **ยังไม่ได้ใช้** |
| `Remark` | Text(255) | `W` · `PCOL.REMARK` (22) | |
| `SeatNo` | Text(10) | `X` (23) | **ยังไม่ได้ใช้** |

คอลัมน์ที่ **ไม่ต้องย้าย**:

| คอลัมน์เดิม | ทำไมไม่ต้อง |
|---|---|
| `A` STATUS (0) | ไม่มีโค้ดอ่าน |
| `V` ระยะเวลารอ (21) | เป็น**สูตรในชีท** → ใน Power Platform ทำเป็น calculated column หรือคำนวณตอนแสดง |

## 4b · CasePorter — ใครทำเคสไหน (M:N)

ช่อง `E` (`PCOL.PORTER`) ของชีทเก็บ **หลายคนในข้อความเดียว** คั่นด้วย comma
`"Chatchai, Teerapong"` → ต้องแตกเป็นตารางเชื่อม

| ฟิลด์ | ชนิด | หมายเหตุ |
|---|---|---|
| `CaseId` | Lookup → Case | |
| `StaffId` | Lookup → Staff | |
| `AssignedAt` | DateTime | **ใหม่** — ตอนนี้ไม่รู้ว่าจ่ายงานตอนไหน (รู้แค่ผ่าน AssignLog) |
| `AssignedBy` | Text(40) | **ใหม่** |

> ตารางนี้คือกำไรที่ชัดที่สุดของการย้าย: ตอนนี้การนับว่าใครถือกี่เคส
> ต้องแตกข้อความแล้ว fuzzy match ชื่อทุกครั้งที่โหลดหน้าจอ

---

# 5 · Trip — การให้บริการแต่ละรอบ

มาจากชีท `TripLog` (`LOG_HEADERS` / `TCOL`) · ระบบเขียนเองทั้งหมด

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `TripId` | Text(30) · unique | 1 `Trip ID` | `TRP-20260920-001` สร้างฝั่งหน้าเว็บ |
| `TripDate` | Date | 2 `วันที่` | `dd/MM/yyyy` **ข้อความ** |
| `WheelchairId` | Lookup → Wheelchair | 3 `รถเข็น` | เดิมเก็บ `AOTGA-WH-12` เป็นข้อความ |
| `WheelchairType` | — | 4 `ประเภท WC` | **ตัดออก** — ได้จาก lookup |
| `StaffId` | Lookup → Staff | 5 `รหัสพนักงาน` | |
| `StaffNick` / `StaffName` | — | 6-7 | **ตัดออก** — ได้จาก lookup |
| `FlightCode` | Text(20) | 8 `เที่ยวบิน` | |
| `Airline` / `Routing` / `Sta` / `Std` | — | 9-12 | **ตัดออก** ถ้าผูก `FlightId` ได้ |
| `StartTime` | DateTime | 13 `เวลาเริ่ม` | เดิม `HH:mm:ss` **ข้อความ แยกจากวันที่** |
| `EndTime` | DateTime | 14 `เวลาจบ` | ว่าง = ยังไม่จบ |
| `DurationMin` | Decimal | 15 `ระยะเวลา (นาที)` | คำนวณฝั่งหน้าเว็บ · ควรเป็น calculated |
| `TripStatus` | Choice | 16 `สถานะ` | `กำลังบริการ` · `เสร็จสิ้น` · `ค้าง — ไม่ได้กดจบ` |
| `SavedAt` | DateTime | 17 `บันทึกเมื่อ` | |
| `CaseId` | Lookup → Case | 18, 21-23 | เดิมใช้ 4 คอลัมน์ (`Case No`, `Case Row`, `Case Airline`, `Case Flt`) เพื่อหาแถวในชีทกลับ |
| `ServiceType` | — | 19 `SSR` | **ตัดออก** — ได้จาก Case |
| `CasePorterText` | — | 20 `Porter (ชีท)` | **ตัดออก** |

### 🔴 4 คอลัมน์ที่จะหายไปเพราะไม่ต้องมีอีก

`Case No` · `Case Row` · `Case Airline` · `Case Flt` มีอยู่เพื่อ **หาแถวในชีทกลับให้เจอ**
ตอนกดจบงานจากอีกเครื่อง — เพราะ OCC อาจแทรก/ลบแถวระหว่างนั้น (`locateCaseRow()`)

มี `CaseId` เป็น foreign key แล้ว ทั้ง 4 คอลัมน์และฟังก์ชันหาแถวหายไปทั้งหมด

### เวลาเก็บเป็นข้อความ = ที่มาของบั๊กจริง

`TripDate` เป็น `dd/MM/yyyy` และ `StartTime` เป็น `HH:mm:ss` **แยกช่องกัน** ต้องมี
`tripStartMs()` ประกอบกลับเพื่อรู้ว่างานเริ่มมานานเท่าไร — และตอนแรก
`getActiveTrips()` ไม่ได้ดูอายุเลย ทำให้ trip จาก 21 ส.ค. ยังโชว์ว่า
"กำลังให้บริการ" และ **ล็อกรถเข็น 3 คันไว้เป็นเดือน**

> ใช้ `DateTime` เดียวตั้งแต่ต้น แล้วตรรกะ "งานค้าง" เหลือแค่
> `StartTime < UtcNow - 12h` ไม่ต้องแปลงข้อความเลย

---

# 6 · QueueEntry — คิวรับเคสรายวัน

มาจากชีท `Queue` (`QUEUE_HEADERS`)

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `QueueDate` | Date | 1 `วันที่` | |
| `SortOrder` | Whole number | 2 `ลำดับ` | **ตัวตัดสินเมื่อเคสเท่ากัน** ไม่ใช่ลำดับคิวจริง |
| `StaffId` | Lookup → Staff | 3 `รหัสพนักงาน` | |
| `StaffNick` | — | 4 `ชื่อเล่น` | **ตัดออก** |
| `Shift` | Text(20) | 5 `กะ` | `07:00-16:00` — เวลาจริง ไม่ใช่ A/B/C |
| `State` | Choice | 6 `สถานะ` | `ว่าง` · `กำลังบริการ` |
| `TripsToday` | Whole number | 7 `Trips วันนี้` | ควรเป็น rollup จาก Trip |
| `UpdatedAt` | DateTime | 8 `อัปเดต` | |

> **กติกาการเรียงคิว (ต้องย้ายมาด้วย):** เรียงตาม `TripsToday` **น้อยสุดขึ้นก่อน** แยกตามกะ
> ถ้าเท่ากันใช้ `SortOrder` ตัดสิน (คนที่ว่างก่อน/เข้าคิวก่อนขึ้นก่อน) — **ไม่ใช่ FIFO**
> `queueOnEnd()` ดัน `SortOrder` ไปท้ายสุดเมื่อจบงาน

---

# 7 · RosterDay — ตารางเวรจริงรายวัน

มาจาก `PRE-WHEELCHAIR` tab รายวัน บล็อก C "Porter Daily Assignment" (`FCOL.R_*`)

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `RosterDate` | Date | ชื่อ tab | |
| `StaffId` | Lookup → Staff | `FCOL.R_NAME` (28) | **เดิมเป็นชื่ออังกฤษ ต้อง fuzzy match** |
| `TimeIn` / `TimeOut` | Time | `R_IN` (29) / `R_OUT` (30) | |
| `OtIn` / `OtOut` | Time | `R_OT_IN` (31) / `R_OT_OUT` (32) | |
| `DutyStatus` | Choice | — | `DUTY` หรือรหัสลา |
| `LeaveCode` | Choice | `R_IN` เมื่อไม่ใช่เวลา | `OFF` `SL` `BL` `AL` `ML` `PL` `X` `-` (`OFF_CODES`) |

### ไม่มีของเทียบ → `onDuty` / `onOT` เป็นค่าที่คำนวณสด

`inShift()` ตรวจว่า "ตอนนี้" อยู่ในกะไหม และ **รองรับกะข้ามคืน**
(`17:00-05:00`, `15:00-03:00`, `14:00-00:00`) — ถ้าเวลาออกน้อยกว่าเวลาเข้า แปลว่าข้ามวัน

ใน Power Platform ให้เป็น formula/measure ตอนแสดง **ไม่ต้องเก็บเป็นคอลัมน์**
(ค่ามันเปลี่ยนทุกนาที) — แต่ต้องเขียนตรรกะข้ามคืนให้ถูก มีเทสต์เดิม 11 เคสไว้เทียบได้

---

# 8 · StaffRecordDay — คนที่มาทำงานวันนั้น (ตามที่ OCC กรอก)

มาจาก `PORTER SUMMARY` tab รายวัน บล็อกขวา (`SCOL`) — **แยกจาก RosterDay คนละไฟล์คนละเจ้าของ**

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `RecordDate` | Date | ชื่อ tab | |
| `SeqNo` | Whole number | `Z` · `SCOL.NO` (25) | |
| `StaffId` | Lookup → Staff | `AB` · `SCOL.NAME` (27) | ชื่ออังกฤษ ต้อง fuzzy match |
| `Sked` | Text(20) | `AA` · `SCOL.SKED` (26) | |
| `CaseCount` | Whole number | `AC` · `SCOL.CASES` (28) | ที่ OCC นับไว้เอง |
| `IsDayOff` | Yes/No | **สีพื้นหลังเซลล์** | ⛔ ดูด้านล่าง |

### ⛔ `IsDayOff` — ตัวเดียวที่ย้ายตรง ๆ ไม่ได้เลย

ชีทมาร์กวันหยุดด้วย **สีแดงในช่องชื่อ** (หมายเหตุในชีทเขียนว่า `** RED MARK = DAY OFF`)
โค้ดจึงอ่าน `getBackgrounds()` แล้วตัดสินด้วย heuristic:

```js
// isDayOffColor() — รองรับหลายเฉดแดง (#ff0000, #e06666, #f4cccc)
return r > 180 && (r - g) > 35 && (r - b) > 35;
```

**Connector ของ Power Platform อ่านรูปแบบเซลล์ไม่ได้ อ่านได้แค่ค่า** — ทั้ง Google Sheets
และ Excel connector

**ทางออกเดียว: ให้คนกรอกชีทใส่รหัสเป็นข้อความในคอลัมน์จริง**
นี่คือการเปลี่ยนวิธีทำงานของ OCC ไม่ใช่งานโปรแกรม — **ต้องคุยกับ OCC ก่อนเริ่มเขียนโค้ด**

ถ้าย้ายข้อมูลเข้าตารางจริงแล้ว `StaffRecordDay` อาจไม่ต้องมีเลย เพราะ `RosterDay`
ให้ข้อมูลเดียวกันและแม่นกว่า — **คุ้มถามว่าทำไมต้องมีสองที่** ตอนนี้ระบบใช้ทั้งคู่
เพราะตารางเวรอาจไม่ครบ

---

# 9 · PreBooking — ยอดจองล่วงหน้ารายไฟลท์

มาจาก `PRE-WHEELCHAIR` tab รายวัน บล็อก A (`FCOL`)

| ฟิลด์ | ชนิด | คอลัมน์เดิม |
|---|---|---|
| `BookingDate` | Date | ชื่อ tab |
| `FlightId` | Lookup → Flight | `AIRLINE` (0) + `FLTNO` (1) |
| `Routing` | Text(40) | `ROUTING` (2) |
| `Sta` / `Std` | Text(5) | `STA` (5) / `STD` (6) |
| `CtOpen` / `CtClose` | Text(5) | `CT_OPEN` (7) / `CT_CLOSE` (8) |
| `ArrWchr` `ArrWchs` `ArrWchc` `ArrAvih` `ArrMaas` | Whole number | 9-13 |
| `DepWchr` `DepWchs` `DepWchc` `DepAvih` `DepMaas` | Whole number | 15-19 |

> `A_TOTAL` (14) และ `D_TOTAL` (20) ในชีทเป็นผลรวม → **ไม่ต้องเก็บ** ทำเป็น calculated
> ระบบเก็บเฉพาะไฟลท์ที่ `arr.total || dep.total` ไม่ใช่ศูนย์
>
> คอลัมน์ `STA_RAW` (3) / `STD_RAW` (4) มีไว้เพราะชีทมีทั้งเวลาดิบและเวลาที่ format แล้ว — ใช้แค่ (5)/(6)

## 9b · DemandWindow / ManpowerWindow — ความต้องการ vs กำลังคนต่อช่วงเวลา

มาจากบล็อก B ของ tab เดียวกัน — **สองตารางซ้อนกันในคอลัมน์เดียว** คั่นด้วยแถวที่เขียนว่า `MANPOWER`

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `WindowDate` | Date | ชื่อ tab | |
| `WindowLabel` | Text(15) | `WIN_LBL` (23) | `08:00-10:00` ทุก 2 ชม. |
| `Kind` | Choice | ตำแหน่งในชีท | `DEMAND` หรือ `MANPOWER` |
| `Value1` | Whole number | `WIN_1` (25) | demand → ขาเข้า · manpower → SKED |
| `Value2` | Whole number | `WIN_2` (26) | demand → ขาออก · manpower → OT |

> **ไม่มีของเทียบ:** แถวช่วงเวลาถูก **merge สองบรรทัด** โค้ดต้องกันซ้ำด้วยการเทียบ
> label กับแถวก่อนหน้า · และ `currentWindow()` หาช่วงที่ครอบเวลาปัจจุบัน (รองรับข้ามเที่ยงคืน)
> ย้ายเป็นตารางแล้วเรื่อง merge หายไป แต่ `currentWindow()` ยังต้องมี

---

# 10 · WheelchairStatus — แจ้งซ่อม

มาจากชีท `WCStatus` (`WC_HEADERS`) · ระบบเขียนเอง

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `WheelchairId` | Lookup → Wheelchair | 1 `รถเข็น` | |
| `Status` | Choice | 2 `สถานะ` | `ซ่อม` · `ใช้งานได้` |
| `Note` | Text(255) | 3 `อาการ/หมายเหตุ` | |
| `ReportedBy` | Lookup → Staff | 4 `แจ้งโดย` | เดิมเป็นข้อความ |
| `ReportedAt` | DateTime | 5 `แจ้งเมื่อ` | |
| `UpdatedAt` | DateTime | 6 `อัปเดตล่าสุด` | |

> เก็บทุกครั้งที่แจ้งเป็นประวัติ (ไม่ลบแถว) สถานะปัจจุบันคือแถวล่าสุดของรถเข็นคันนั้น
> ใน Dataverse ทำเป็นตารางประวัติ + calculated field บน Wheelchair จะอ่านง่ายกว่า

---

# 11 · AssignLog — ประวัติการจ่ายงาน

มาจากชีท `AssignLog` (`ASSIGN_HEADERS`) · ระบบเขียนเอง · เพิ่งเพิ่มใน v5.0

| ฟิลด์ | ชนิด | คอลัมน์เดิม | หมายเหตุ |
|---|---|---|---|
| `LoggedAt` | DateTime | 1 `บันทึกเมื่อ` | |
| `LogDate` | Date | 2 `วันที่` | |
| `SheetRow` | Whole number | 3 `แถวในชีท` | **ตัดออก** — ไม่มีชีทแล้ว |
| `CaseId` | Lookup → Case | 4 `เคส` | |
| `FlightCode` / `ServiceType` | — | 5-6 | **ตัดออก** — ได้จาก Case |
| `AssignedToText` | Text(100) | 7 `จ่ายให้` | ชื่อหลังเปลี่ยน |
| `PreviousText` | Text(100) | 8 `คนเดิม` | ชื่อก่อนเปลี่ยน |
| `AssignedBy` | Text(40) | 9 `จ่ายโดย` | |
| `Note` | Text(255) | 10 `หมายเหตุ` | |

> **ใน Dataverse ตารางนี้อาจไม่ต้องมี** — audit log ในตัวบันทึกการแก้ `CasePorter` ให้แล้ว
> ถ้าเปิด auditing ไว้ ให้ใช้ของในตัวดีกว่าทำเอง

---

# 12 · DailySummary — สรุปรายวัน

มาจากชีท `DailySummary` · ระบบคำนวณแล้วเขียนทับแถวของวันนั้น

| คอลัมน์เดิม | ใน Power Platform |
|---|---|
| `วันที่` · `Trips ทั้งหมด` · `Trips เสร็จ` · `เฉลี่ย (น.)` · `นานสุด (น.)` · `สั้นสุด (น.)` · `> 60 น.` · `อัปเดต` | **ไม่ต้องมีตาราง** — เป็น aggregate จาก Trip ทั้งหมด |

`getTodaySummary()` ยังคำนวณอีกชุดจากเคส **ที่ไม่ได้เก็บลงชีทเลย** (คำนวณสดทุกครั้ง):
`total` `arr` `dep` `standby` `process` `completed` `unassigned`
`bySvc` `byAirline` `byStaff` `onDuty` `dayOff` `preBooked` `rosterOn/Off/All`

> ทั้งหมดเป็น aggregate จาก Case / CasePorter / RosterDay / PreBooking
> **ใน Power BI หรือ Dataverse view ได้ฟรี** ไม่ต้องเขียนโค้ดนับเอง — นี่เป็นกำไรอีกข้อ

---

# กติกาธุรกิจที่ต้องย้ายมาด้วย (ไม่ใช่ตาราง แต่หายง่ายที่สุด)

สิ่งที่มองไม่เห็นในหน้าจอ แต่ถ้าไม่มีแล้วระบบใหม่จะแย่กว่าเดิม — ทั้งหมดอยู่ฝั่ง server

| # | กติกา | ที่มา | เกิดอะไรถ้าไม่มี |
|---|---|---|---|
| 1 | เคสที่มีเวลาส่งแล้ว **ห้ามเปลี่ยนคน** | `assignCase()` | มีคนไปแก้ชื่อคนทำเคสที่จบแล้ว ประวัติเพี้ยน |
| 2 | เคสที่กำลังทำ **เพิ่มคนช่วยได้ แต่ถอดคนที่ทำอยู่ออกไม่ได้** | `assignCase()` | คนที่กำลังเข็นผู้โดยสารอยู่หลุดจากเคส |
| 3 | รถเข็นที่มีคนใช้อยู่ **เริ่มงานซ้ำไม่ได้** พร้อมบอกว่าใครใช้ตั้งแต่กี่โมง | `handleStart()` | รถเข็นคันเดียวถูกบันทึกว่าใช้พร้อมกันสองคน |
| 4 | **งานค้างเกิน 12 ชม. ไม่นับว่ากำลังทำ** และต้องมีทางปิด | `scanOpenTrips()` · `closeStaleTrips()` | เคยทำให้ WH-2/18/60 ถูกล็อกเป็นเดือน — porter หยิบไปใช้ไม่ได้ |
| 5 | สถานะเคส **ไม่ถอยหลัง** (`COMPLETED` ไม่กลับเป็น `ON PROCESS`) และ **ไม่แตะเคสที่ `CANCELLED`** | `setCaseStatus()` | สถานะกระพริบไปมาเวลามีคนกดซ้ำ |
| 6 | **ไม่เขียนทับช่องเวลาที่กรอกไว้แล้ว** | `markCase()` | แอปลบเวลาที่ LP กรอกมือ |
| 7 | คิวเรียงตาม **เคสน้อยสุดขึ้นก่อน** แยกตามกะ — ไม่ใช่ FIFO | `sortedShiftQueue()` | งานกระจุกที่คนเดิม |
| 8 | porter เริ่มได้ **เฉพาะเคสของตัวเอง** | `startFromLP()` | กดเริ่มงานของคนอื่นโดยไม่ตั้งใจ |
| 9 | ปิดงานค้าง **ไม่เดาเวลาจบ** (ปล่อยว่าง) | `closeStaleTrips()` | สถิติระยะเวลาเพี้ยนด้วยตัวเลขที่แต่งขึ้น |
| 10 | **LP ปิดงานค้างได้ porter ไม่ได้** | `renderStale()` | porter ไปปิดงานของคนอื่น |

ข้อ 1-6 เป็น **server-side** ทั้งหมด — ใน Power Platform ต้องอยู่ใน plug-in / Power Automate
หรือ business rule **ไม่ใช่แค่ซ่อนปุ่มในหน้าจอ** เพราะฝั่ง porter เป็นแอปแยกที่เรียกข้อมูลเดียวกัน

---

# สรุป: อะไรดีขึ้น อะไรต้องคุยกับคนก่อน

## ย้ายแล้วดีขึ้นทันที

| | เดิม | ใหม่ |
|---|---|---|
| รายชื่อพนักงาน/รถเข็น | hardcode ใน HTML ต้อง deploy ใหม่ | ตารางจริง แก้ในแอป |
| ใครทำเคสไหน | ข้อความ `"A, B"` + fuzzy match ชื่อ | `CasePorter` + `StaffId` |
| ไฟล์รายเดือน / tab รายวัน | เดาชื่อไฟล์และ tab เอง 3 ฟังก์ชัน | คอลัมน์วันที่ |
| เวลา | ข้อความ 4 รูปแบบ · วันที่แยกจากเวลา | `DateTime` |
| หาแถวในชีท | `locateCaseRow()` + 4 คอลัมน์สำรอง | foreign key |
| สรุป/สถิติ | นับเองทุกครั้งที่โหลด | view / Power BI |
| ประวัติการแก้ | `AssignLog` ที่เขียนเอง | audit ในตัว (Dataverse) |

## ⚠ ต้องตัดสินใจ/คุยกับคนก่อนเริ่มเขียน

1. **วันหยุด = สีแดงในเซลล์** → ต้องให้ OCC เปลี่ยนมาใส่รหัสเป็นข้อความ **คุยกับ OCC**
2. **OCC/LP จะเสียชีทที่ใช้กรอกอยู่** → ต้องมีหน้ากรอกแทนใน PWMS **คุยกับ OCC/LP**
3. **porter ~76 คนไม่มีบัญชี** → ฝั่ง porter อยู่นอก Power Apps **คุยกับ IT**
4. **`StaffRecordDay` กับ `RosterDay` ซ้ำซ้อน** → ยังต้องมีสองที่ไหม **คุยกับ OCC/LP**
5. **Dataverse หรือ SharePoint** → ใช้ตามที่ PWMS ใช้อยู่ **เช็คกับคนทำ PWMS**
6. **`Sirichai` (#76) · `NAWAF` (#77)** มีชื่อในชีทแต่ไม่มีในระบบ → เติมก่อนนำเข้าข้อมูลเก่า

## ฟิลด์ที่ชีทมีแต่ระบบไม่ใช้ — ย้ายหรือไม่ย้าย?

`StandbyArr` · `BoardingTime` · `GateStandbyChk` · `LpName` · `VerifiedChk` · `SeatNo`

OCC กรอกไว้แต่แอปไม่เคยอ่าน — **ถ้าย้ายก็ควรมีคนใช้** ไม่งั้นเป็นช่องว่างที่ไม่มีใครกรอก
คุ้มถามว่าใครใช้ข้อมูลพวกนี้อยู่
