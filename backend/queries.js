'use strict';
// Query layer — อ่านจาก DB อย่างเดียว (แยกจาก HTTP · ทดสอบ/นำไปใช้ซ้ำได้)
const db = require('./db');

async function health() {
  const r = await db.query('SELECT version() AS v');
  return { ok: true, db: r.rows[0].v.split(' ').slice(0, 2).join(' ') };
}

// สรุปรายวัน: KPI + รายทีม + แยกกลุ่ม + ไฟลท์ + porter
async function summary(date) {
  const [teams, split, fl, po, mp] = await Promise.all([
    db.query('SELECT * FROM v_team_daily WHERE work_date=$1 ORDER BY team_code', [date]),
    db.query('SELECT * FROM v_source_split WHERE work_date=$1 ORDER BY grp', [date]),
    db.query('SELECT count(*)::int AS flights FROM flight_schedule WHERE flight_date=$1', [date]),
    db.query(`SELECT (SELECT count(*)::int FROM porter_job WHERE work_date=$1) AS cases,
                     (SELECT count(*)::int FROM porter_staff_day WHERE work_date=$1 AND cases>0) AS active`, [date]),
    db.query('SELECT count(*)::int AS teams, sum(working_actual)::int AS working FROM manpower_report WHERE work_date=$1', [date]),
  ]);
  const t = teams.rows;
  const kpi = {
    working: t.reduce((s, x) => s + (+x.working || 0), 0),
    ot_hours: Math.round(t.reduce((s, x) => s + (+x.ot_hours || 0), 0) * 10) / 10,
    bkk: t.reduce((s, x) => s + (+x.bkk_count || 0), 0),
    teams: t.length,
    flights: fl.rows[0].flights,
    porter_cases: po.rows[0].cases,
    porter_active: po.rows[0].active,
  };
  return { date, kpi, teams: t, split: split.rows, manpower: mp.rows[0] };
}

// Timetable: รายคน + งานที่ได้รับ (สำหรับ gantt/รายการ)
async function timetable(date) {
  const r = await db.query(`
    SELECT d.emp_code, d.emp_name, d.team_code, d.bucket, d.shift_code,
           d.shift_start, d.shift_end, d.ot_hours, d.is_bkk, d.is_support,
           COALESCE(json_agg(json_build_object('flight',a.flight_leg,'task',a.task,'sta',a.sta,'std',a.std,'is_flight',a.is_flight)
                    ORDER BY a.sta) FILTER (WHERE a.id IS NOT NULL), '[]') AS assignments
    FROM duty d LEFT JOIN assignment a ON a.duty_id = d.id
    WHERE d.work_date=$1
    GROUP BY d.id
    ORDER BY d.team_code, d.shift_start NULLS LAST, d.emp_name`, [date]);
  return { date, people: r.rows };
}

async function flights(date) {
  const r = await db.query('SELECT flight_no,airline_iata,direction,sta,std,aircraft_type FROM flight_schedule WHERE flight_date=$1 ORDER BY std NULLS LAST, sta', [date]);
  return { date, flights: r.rows };
}

async function porter(date) {
  const [jobs, byair, staff] = await Promise.all([
    db.query('SELECT airline_iata,flight_no,porter_names,service,is_arrival,is_departure,pickup_at,delivered_at,wait_dur FROM porter_job WHERE work_date=$1 ORDER BY pickup_at', [date]),
    db.query('SELECT airline_iata, count(*)::int AS n FROM porter_job WHERE work_date=$1 GROUP BY airline_iata ORDER BY n DESC', [date]),
    db.query('SELECT name,cases FROM porter_staff_day WHERE work_date=$1 ORDER BY cases DESC', [date]),
  ]);
  return { date, jobs: jobs.rows, byAirline: byair.rows, staff: staff.rows };
}

// Pre-book wheelchair — จองล่วงหน้า (ดูวันอนาคตได้)
async function prewc(date) {
  const [rows, byType, byAir] = await Promise.all([
    db.query(`SELECT airline_iata,flight_no,routing,sta,std,ct_open,ct_close,direction,service,qty
              FROM prewheelchair_booking WHERE work_date=$1
              ORDER BY direction, COALESCE(sta,std), flight_no`, [date]),
    db.query(`SELECT service, sum(qty)::int AS qty FROM prewheelchair_booking WHERE work_date=$1 GROUP BY service ORDER BY service`, [date]),
    db.query(`SELECT airline_iata, sum(qty)::int AS qty FROM prewheelchair_booking WHERE work_date=$1 GROUP BY airline_iata ORDER BY qty DESC`, [date]),
  ]);
  const total = rows.rows.reduce((s, x) => s + (+x.qty || 0), 0);
  return { date, total, byType: byType.rows, byAirline: byAir.rows, rows: rows.rows };
}

// วันที่ที่มีข้อมูล (ให้ UI เลือก) — รวม duty + จองล่วงหน้า (อนาคต)
async function dates() {
  const r = await db.query(`
    SELECT work_date FROM (
      SELECT work_date FROM duty
      UNION SELECT work_date FROM prewheelchair_booking
    ) x ORDER BY work_date DESC LIMIT 90`);
  return r.rows.map(x => (x.work_date instanceof Date ? x.work_date.toISOString().slice(0, 10) : x.work_date));
}

module.exports = { health, summary, timetable, flights, porter, prewc, dates };
