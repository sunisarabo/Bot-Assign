-- =====================================================================
-- PAS · PSA-HKT Assignment System — PostgreSQL schema
-- ---------------------------------------------------------------------
-- แบบจำลองข้อมูลที่ปัจจุบันอยู่ใน Google Sheets ให้ย้ายมาเป็น DB มาตรฐาน
-- (vendor-neutral) · แต่ละตารางระบุ "ที่มา" จากชีต/ตัวอ่าน .gs เดิม
--
-- แนวคิด:
--   * ตารางอ้างอิง (reference): team, position_group, airline, shift_code
--   * ข้อมูลหลักรายวัน: duty (คน-วัน) + assignment (job/ไฟลท์ต่อคน)
--   * ตารางบิน: flight_schedule
--   * กฎ: sla_rule, airline_support, manning_rule
--   * Porter: porter_job, porter_staff_day
--   * Pre-book รถเข็น: prewheelchair_booking
--   * สรุปที่ทีมกรอกเอง: manpower_report
--   * คำขอซัพข้ามทีม: support_request
--
-- ตรรกะธุรกิจเดิม (SLA/Productivity/AssignCheck/JobByShift) ย้ายมาเป็น
-- โค้ด backend ได้ทั้งหมด โดยเปลี่ยน "ตัวอ่าน" จาก Sheets → SQL เท่านั้น
-- =====================================================================

BEGIN;

-- ---------- ENUM types ----------
CREATE TYPE dept          AS ENUM ('PSA', 'LL');                                   -- การโดยสาร / ติดตามสัมภาระ
CREATE TYPE emp_source    AS ENUM ('HKT', 'BKK', 'GLOBEX', 'OUTSOURCE');           -- แหล่งกำลังพล (การ์ดแยกกลุ่มบน Dashboard)
CREATE TYPE emp_status    AS ENUM ('ACTIVE', 'RESIGNED');
CREATE TYPE duty_bucket   AS ENUM ('WORKING', 'OT_OFF', 'OFF', 'SICK', 'VACATION', 'LEAVE', 'TRAINING');
CREATE TYPE ot_type       AS ENUM ('PRE', 'POST');                                 -- OT ก่อน/หลังกะ
CREATE TYPE job_zone      AS ENUM ('IN_SHIFT', 'OT', 'OUT_SHIFT');                 -- จับ job ตามเวลากะ (JobByShift.gs)
CREATE TYPE sla_phase     AS ENUM ('CI', 'GATE', 'ARR', 'SUP');                    -- เช็คอิน/เกท/ขาเข้า/หัวหน้า
CREATE TYPE flight_dir    AS ENUM ('ARR', 'DEP', 'TURN');
CREATE TYPE service_type  AS ENUM ('WCHR', 'WCHS', 'WCHC', 'MAAS', 'AVIH', 'ETC'); -- Porter / Pre-WC
CREATE TYPE porter_status AS ENUM ('COMPLETED', 'ON_PROCESS', 'STANDBY');

-- ---------- Reference ----------
CREATE TABLE position_group (
  code        TEXT PRIMARY KEY,          -- PSS, SNR, PSA, Globlex, AdminD, Porter, Crewsign, DIR, MGR, Assist
  label_th    TEXT
);

CREATE TABLE team (
  code        TEXT PRIMARY KEY,          -- EY, EK, QR, ... PORTER, ADMIN DOC, PORTER CREWSIGN, WYWK, CHN, PVTLP
  label_th    TEXT,
  is_float    BOOLEAN NOT NULL DEFAULT FALSE,   -- ทีมพูล/สแตนด์บาย (PVT/LP · CHARTER) · slaIsFloatTeam_
  is_doc      BOOLEAN NOT NULL DEFAULT FALSE,   -- ADMIN DOC · งานเอกสาร ไม่ผูกเวลาไฟลท์
  skip_sla    BOOLEAN NOT NULL DEFAULT FALSE    -- ทีมที่ไม่คิด SLA/ซัพ (slaSkipTeam_)
);

CREATE TABLE airline (
  iata        TEXT PRIMARY KEY,          -- EY, QR, 6E, EK, SU ...
  name        TEXT,
  handling_team TEXT REFERENCES team(code),     -- ทีมที่ดูแลสายนี้ (DATA BASE ของ Pre-WC)
  ci_in_team  BOOLEAN NOT NULL DEFAULT FALSE    -- เช็คอินเฉพาะคนในทีม (EY/QR/EK) · SLA_CI_INTEAM
);

CREATE TABLE shift_code (
  code        TEXT PRIMARY KEY,          -- E10, P12, D8, N10 ...
  start_min   INT,                       -- นาทีจากเที่ยงคืน (เช่น 05:00 = 300)
  end_min     INT,                       -- อาจ > 1440 ถ้าข้ามเที่ยงคืน
  hours       NUMERIC(4,1)
);

-- ---------- Employees (master: Total + BKK Batch 1/2) ----------
-- ที่มา: MasterReader.gs · "Total" tab + ทุกแท็บ "BKK Batch N"
CREATE TABLE employee (
  emp_code    TEXT PRIMARY KEY,          -- รหัสตัวเลขล้วน (B2607384 → 2607384)
  name_th     TEXT,
  name_en     TEXT,
  team_code   TEXT REFERENCES team(code),
  department  dept,
  position    TEXT,                      -- ตำแหน่งดิบ
  pos_group   TEXT REFERENCES position_group(code),
  source      emp_source NOT NULL DEFAULT 'HKT',
  start_date  DATE,
  resign_date DATE,
  status      emp_status NOT NULL DEFAULT 'ACTIVE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_employee_team   ON employee(team_code);
CREATE INDEX ix_employee_source ON employee(source);

-- ---------- Duty: หนึ่งแถว = หนึ่งคน ในหนึ่งวัน ----------
-- ที่มา: RosterReader.gs (ชีตทีมรายวัน · ช่อง ON DUTY/SHIFT/OT/REMARK)
CREATE TABLE duty (
  id            BIGSERIAL PRIMARY KEY,
  work_date     DATE NOT NULL,
  emp_code      TEXT REFERENCES employee(emp_code),
  emp_name      TEXT,                    -- เก็บชื่อ ณ วันนั้น (เผื่อรหัสไม่อยู่ใน master)
  team_code     TEXT REFERENCES team(code),  -- ทีมที่ลงเวรวันนั้น (อาจต่างจาก home team)
  bucket        duty_bucket NOT NULL,
  shift_code    TEXT,                    -- ไม่ FK เข้ม (รหัสกะใหม่ ๆ มีได้)
  shift_start   INT,                     -- นาที (จากชีต/รหัสกะ)
  shift_end     INT,
  shift_hours   NUMERIC(4,1),
  re_sked       TEXT,                    -- RE-SKED (เวลาเข้างานที่เปลี่ยน)
  ot_hours      NUMERIC(4,1) NOT NULL DEFAULT 0,
  ot_type       ot_type,
  ot_spans      JSONB,                   -- ช่วง OT หลายช่วง [{a,b,type}] (EY ก่อน+หลังกะ)
  is_support    BOOLEAN NOT NULL DEFAULT FALSE,   -- แถวมาช่วยไฟลท์ทีมอื่น (ไม่นับ headcount ทีมรับ)
  support_from  TEXT,                    -- มาช่วยจากทีมไหน
  is_bkk        BOOLEAN NOT NULL DEFAULT FALSE,
  is_training   BOOLEAN NOT NULL DEFAULT FALSE,
  remark        TEXT,
  source_file   TEXT,                    -- ชื่อไฟล์เวร (เช่น 19SEP)
  UNIQUE (work_date, emp_code, team_code, is_support)
);
CREATE INDEX ix_duty_date      ON duty(work_date);
CREATE INDEX ix_duty_date_team ON duty(work_date, team_code);
CREATE INDEX ix_duty_emp       ON duty(emp_code);

-- ---------- Assignment: job/ไฟลท์ ต่อ duty ----------
-- ที่มา: RosterReader.gs (คอลัมน์งานในชีตทีม) + AssignCheck/JobByShift (โซนเวลา)
CREATE TABLE assignment (
  id            BIGSERIAL PRIMARY KEY,
  duty_id       BIGINT NOT NULL REFERENCES duty(id) ON DELETE CASCADE,
  flight_code   TEXT,                    -- "EY410" หรือ "EY410/EY411" (เก็บดิบ)
  flight_leg    TEXT,                    -- ขาแรก "EY410" (split('/')[0])
  airline_iata  TEXT,                    -- แยกจาก flight_code
  task          TEXT,                    -- รหัสงาน (Y1, GA, SOD, CI, PFD, ...)
  phase         sla_phase,               -- เฟสที่ตีความได้ (slaPhasesOf_)
  zone          job_zone,                -- ในกะ/OT/นอกกะ (JobByShift.gs)
  sta           TIME,                    -- STA/STD จากหัวตารางไฟลท์
  std           TIME,
  counter_open  TIME,
  counter_close TIME,
  win_lo        INT,                     -- ช่วงงาน (นาที) ที่ acFlightWin_ คำนวณ
  win_hi        INT,
  is_flight     BOOLEAN NOT NULL DEFAULT FALSE,   -- acIsFlight_ (รหัสไฟลท์จริง)
  is_activity   BOOLEAN NOT NULL DEFAULT FALSE,   -- อบรม/ประชุม
  is_support_out BOOLEAN NOT NULL DEFAULT FALSE,  -- ไปช่วยทีมอื่น (SUPPORT REQUEST)
  support_to    TEXT,                    -- ไปช่วยทีมไหน
  raw           TEXT                     -- ข้อความดิบในเซลล์
);
CREATE INDEX ix_assign_duty   ON assignment(duty_id);
CREATE INDEX ix_assign_flight ON assignment(flight_leg);

-- ---------- Flight schedule (ตารางบินสัปดาห์) ----------
-- ที่มา: WeeklyFlight.gs
CREATE TABLE flight_schedule (
  id            BIGSERIAL PRIMARY KEY,
  flight_date   DATE NOT NULL,
  flight_no     TEXT NOT NULL,
  airline_iata  TEXT REFERENCES airline(iata),
  direction     flight_dir,
  route         TEXT,
  sta           TIME,
  std           TIME,
  aircraft_type TEXT,
  counter_open  TIME,
  counter_close TIME,
  gate          TEXT,
  UNIQUE (flight_date, flight_no, direction)
);
CREATE INDEX ix_flight_date ON flight_schedule(flight_date);

-- ---------- SLA rules ----------
-- ที่มา: SLA.gs (AIRLINE_SYS, SLA_RQ, SLA_CI_INTEAM, SLA_TRANSIT_MIN, SLA_REST_MIN)
CREATE TABLE sla_rule (
  id            BIGSERIAL PRIMARY KEY,
  airline_iata  TEXT REFERENCES airline(iata),  -- NULL = ค่า default
  phase         sla_phase NOT NULL,
  required_staff INT,                    -- จำนวนคนขั้นต่ำต่อเฟส
  lead_min      INT,                     -- เปิดก่อน STA/STD กี่นาที
  close_min     INT,
  needs_system  BOOLEAN DEFAULT FALSE,   -- ต้องมีคนขึ้นระบบ (slaNeedSys_)
  UNIQUE (airline_iata, phase)
);
CREATE TABLE sla_config (                 -- ค่าคงที่ทั่วไป (key-value)
  key   TEXT PRIMARY KEY,                 -- transit_min, rest_min ...
  value INT
);

-- ---------- Airline support rules ----------
-- ที่มา: AirlineSupport.gs (ใครรับ/ไม่รับซัพ · เช็คอินเฉพาะทีม)
CREATE TABLE airline_support (
  airline_iata  TEXT PRIMARY KEY REFERENCES airline(iata),
  accepts_ci    BOOLEAN NOT NULL DEFAULT TRUE,    -- รับซัพเช็คอินข้ามทีมไหม
  accepts_gate  BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_arr   BOOLEAN NOT NULL DEFAULT TRUE,
  note          TEXT
);

-- ---------- Manning rules (กฎกำลังพลขั้นต่ำ) ----------
-- ที่มา: ManningRules.gs
CREATE TABLE manning_rule (
  id            BIGSERIAL PRIMARY KEY,
  team_code     TEXT REFERENCES team(code),
  pos_group     TEXT REFERENCES position_group(code),
  shift_band    TEXT,                    -- M/A/N หรือช่วงเวลา
  min_staff     INT NOT NULL DEFAULT 0
);

-- ---------- Porter case log (ข้อมูลจริง) ----------
-- ที่มา: Porter.gs · ไฟล์ "SEP 2026 PORTER SUMMARY" (แท็บรายวัน)
CREATE TABLE porter_job (
  id            BIGSERIAL PRIMARY KEY,
  work_date     DATE NOT NULL,
  seq_no        INT,                     -- ที่ (running)
  airline_iata  TEXT,
  flight_no     TEXT,
  porter_names  TEXT,                    -- "A, B, C" (หลายคนต่อเคส)
  status        porter_status,
  eta           TIME,
  etd           TIME,
  gate          TEXT,
  notified_at   TIME,                    -- ได้รับแจ้งเคส
  pickup_at     TIME,                    -- รับเคส
  delivered_at  TIME,                    -- ส่งเคส
  service       service_type,
  is_arrival    BOOLEAN,
  is_departure  BOOLEAN,
  wait_dur      INTERVAL,                -- ระยะเวลารอ (ล่าช้า)
  seat          TEXT,
  remark        TEXT
);
CREATE INDEX ix_porter_job_date ON porter_job(work_date);

CREATE TABLE porter_staff_day (           -- STAFF RECORD (ชื่อ + จำนวนเคส/วัน)
  work_date     DATE NOT NULL,
  staff_no      INT,
  name          TEXT NOT NULL,
  cases         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (work_date, name)
);

-- ---------- Pre-book Wheelchair (จองล่วงหน้า) ----------
-- ที่มา: PreWheelchair.gs · ไฟล์ "SEP 2026 PRE-WHEELCHAIR" (แท็บรายวัน)
-- normalize: หนึ่งแถว = หนึ่งไฟลท์ + หนึ่งทิศ + หนึ่งชนิดรถเข็น + จำนวน
CREATE TABLE prewheelchair_booking (
  id            BIGSERIAL PRIMARY KEY,
  work_date     DATE NOT NULL,
  airline_iata  TEXT,
  flight_no     TEXT,                    -- "410/411"
  routing       TEXT,
  sta           TIME,
  std           TIME,
  ct_open       TIME,
  ct_close      TIME,
  direction     flight_dir NOT NULL,     -- ARR / DEP
  service       service_type NOT NULL,   -- WCHR/WCHS/WCHC/AVIH/MAAS
  qty           INT NOT NULL DEFAULT 0
);
CREATE INDEX ix_prewc_date ON prewheelchair_booking(work_date);

-- ---------- MANPOWER report (แบบฟอร์มที่ทีมกรอกเอง) ----------
-- ที่มา: rbReadManpower_ · แท็บ "แบบฟอร์มรายงานกำลังพลประจำวัน"
CREATE TABLE manpower_report (
  work_date     DATE NOT NULL,
  team_code     TEXT NOT NULL REFERENCES team(code),
  total_staff   INT,
  scheduled     INT,                     -- ทำงานตามตาราง
  sick          INT DEFAULT 0,
  personal      INT DEFAULT 0,           -- ลากิจ
  annual        INT DEFAULT 0,           -- ลาพักร้อน
  maternity     INT DEFAULT 0,
  other_leave   INT DEFAULT 0,
  training      INT DEFAULT 0,
  working_actual INT,                    -- ทำงานจริง (คน)
  ot_hours      NUMERIC(6,1) DEFAULT 0,
  ot_holiday    NUMERIC(6,1) DEFAULT 0,
  updated_at    TEXT,                    -- ข้อความเวลาอัปเดตดิบ (เช่น "18SEP26/15:00")
  updated_by    TEXT,
  PRIMARY KEY (work_date, team_code)
);

-- ---------- Support requests (คำขอซัพข้ามทีม) ----------
-- ที่มา: RosterReader/DutyImport · แท็บ "SUPPORT REQUEST"
CREATE TABLE support_request (
  id            BIGSERIAL PRIMARY KEY,
  work_date     DATE NOT NULL,
  req_team      TEXT REFERENCES team(code),   -- ทีมที่ขอ
  flight_code   TEXT,
  phase         sla_phase,
  need_count    INT NOT NULL DEFAULT 1,
  win_text      TEXT,                    -- เวลา/STBY
  assigned_names TEXT,                   -- ผู้ไปซัพ (คั่นด้วย ,)
  from_team     TEXT REFERENCES team(code),
  status        TEXT
);
CREATE INDEX ix_supreq_date ON support_request(work_date);

COMMIT;

-- =====================================================================
-- ตัวอย่าง VIEW: สรุปกำลังพลรายทีม/วัน (ใช้แทนการนับจากชีต)
-- =====================================================================
CREATE OR REPLACE VIEW v_team_daily AS
SELECT d.work_date,
       d.team_code,
       count(*) FILTER (WHERE d.bucket IN ('WORKING','OT_OFF') AND NOT d.is_training AND NOT d.is_support) AS working,
       count(*) FILTER (WHERE d.bucket = 'OFF')     AS off,
       count(*) FILTER (WHERE d.bucket = 'SICK')    AS sick,
       count(*) FILTER (WHERE d.bucket = 'TRAINING') AS training,
       round(sum(d.ot_hours)::numeric, 1)           AS ot_hours,
       count(*) FILTER (WHERE d.is_bkk)             AS bkk_count
FROM duty d
GROUP BY d.work_date, d.team_code;

-- แยกกลุ่ม HKT / BKK / Globex (การ์ด Dashboard)
CREATE OR REPLACE VIEW v_source_split AS
SELECT d.work_date,
       CASE WHEN d.is_bkk THEN 'BKK'
            WHEN e.pos_group = 'Globlex' THEN 'GLOBEX'
            ELSE 'HKT' END AS grp,
       count(*) FILTER (WHERE d.bucket IN ('WORKING','OT_OFF') AND NOT d.is_training) AS on_duty
FROM duty d
LEFT JOIN employee e ON e.emp_code = d.emp_code
GROUP BY d.work_date, grp;

-- ============================================================
-- Web app: session + OIDC login state (ใช้แทน in-memory เพื่อรองรับหลาย instance)
-- ============================================================
CREATE TABLE IF NOT EXISTS web_session (
  sid         TEXT PRIMARY KEY,
  sub         TEXT,
  email       TEXT,
  name        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_web_session_exp ON web_session(expires_at);

CREATE TABLE IF NOT EXISTS oidc_login (            -- state ระหว่าง flow (PKCE/nonce) · อายุสั้น
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
