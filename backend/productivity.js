'use strict';
/* productivity.js — ยก Productivity/Gantt จาก Apps Script มาเป็น query/โมดูลบน DB
 *   Util% ต่อคน = เวลาที่ติดงาน (union ของช่วงงาน) ÷ เวลากะ · รายชั่วโมง on-duty vs on-flight
 *   หน้าต่างงานประมาณจาก เคาน์เตอร์ OP–CL / ขาออก gate→STD / ขาเข้า STA+buffer
 *   (win_lo/win_hi ยังไม่ถูก export จากชีต → ประมาณจากเวลาที่มี · พอร์ตเต็มเมื่อ exporter ส่ง win มา) */
const db = require('./db');

const DEP_LEAD = 60;   // ขาออก: ยุ่งก่อน STD กี่นาที
const ARR_TAIL = 45;   // ขาเข้า: ยุ่งหลัง STA กี่นาที
const DEF_JOB  = 45;   // งานที่ไม่มีเวลา → ประมาณกี่นาที

function t2m(t) { if (!t) return null; const m = String(t).match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }

// ช่วงเวลา [lo,hi] (นาที) ที่ assignment ทำให้ "ติดงาน" · null = ประมาณไม่ได้
function winOf(a) {
  const op = t2m(a.counter_open), cl = t2m(a.counter_close), sta = t2m(a.sta), std = t2m(a.std);
  if (op != null && cl != null) return [op, cl < op ? cl + 1440 : cl];         // เคาน์เตอร์เช็คอิน
  if (std != null) return [Math.max(0, std - DEP_LEAD), std];                   // ขาออก
  if (sta != null) return [sta, sta + ARR_TAIL];                               // ขาเข้า
  if (op != null) return [op, op + DEF_JOB];
  return null;
}
// รวมช่วงที่ซ้อนกัน → ผลรวมนาทีจริง (ไม่นับซ้ำ)
function mergeMinutes(iv) {
  if (!iv.length) return 0;
  iv = iv.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, [lo, hi] = iv[0];
  for (let i = 1; i < iv.length; i++) {
    if (iv[i][0] <= hi) hi = Math.max(hi, iv[i][1]);
    else { total += hi - lo; [lo, hi] = iv[i]; }
  }
  return total + (hi - lo);
}
function clampIv(iv, lo, hi) {
  const out = [];
  for (const [a, b] of iv) { const x = Math.max(a, lo), y = Math.min(b, hi); if (y > x) out.push([x, y]); }
  return out;
}

async function productivity(date) {
  const r = await db.query(`
    SELECT d.id, d.emp_code, d.emp_name, d.team_code, d.bucket, d.shift_start, d.shift_end, d.is_bkk, d.is_support,
           COALESCE(json_agg(json_build_object('sta',a.sta,'std',a.std,'counter_open',a.counter_open,'counter_close',a.counter_close,'is_flight',a.is_flight)
                    ) FILTER (WHERE a.id IS NOT NULL), '[]') AS asg
    FROM duty d LEFT JOIN assignment a ON a.duty_id=d.id
    WHERE d.work_date=$1 AND d.bucket IN ('WORKING','OT_OFF') AND NOT d.is_training
    GROUP BY d.id ORDER BY d.team_code, d.emp_name`, [date]);

  const HN = 24;
  const hOnDuty = new Array(HN).fill(0), hOnFlight = new Array(HN).fill(0), hFlights = new Array(HN).fill(0);
  const people = [], teamMap = new Map();
  let sumUtil = 0, nUtil = 0, sumIdle = 0, totFlt = 0;

  for (const p of r.rows) {
    let ds = p.shift_start, de = p.shift_end;
    if (ds != null && de != null && de <= ds) de += 1440;               // ข้ามเที่ยงคืน
    const dutyMin = (ds != null && de != null) ? de - ds : 0;
    const raw = (p.asg || []).map(winOf).filter(Boolean);
    const nFlt = (p.asg || []).filter(a => a.is_flight).length;
    totFlt += nFlt;
    const busyIv = dutyMin > 0 ? clampIv(raw, ds, de) : raw;
    const busyMin = mergeMinutes(busyIv);
    const util = dutyMin > 0 ? Math.min(100, Math.round(busyMin / dutyMin * 100)) : null;
    const idleMin = dutyMin > 0 ? Math.max(0, dutyMin - busyMin) : 0;
    if (util != null) { sumUtil += util; nUtil++; sumIdle += idleMin; }

    // hourly on-duty (จากช่วงกะ) + on-flight (จากช่วงงาน)
    if (dutyMin > 0) for (let h = 0; h < HN; h++) { const a = h * 60, b = a + 60; if (overlapDay(ds, de, a, b)) hOnDuty[h]++; }
    for (const [lo, hi] of busyIv) for (let h = 0; h < HN; h++) { const a = h * 60, b = a + 60; if (overlap(lo, hi, a, b) || overlap(lo, hi, a + 1440, b + 1440)) { hOnFlight[h]++; break; } }
    for (const [lo] of raw) { const h = Math.floor((lo % 1440) / 60); if (h >= 0 && h < HN) hFlights[h]++; }

    people.push({ emp_code: p.emp_code, emp_name: p.emp_name, team_code: p.team_code, is_bkk: p.is_bkk, is_support: p.is_support, dutyMin, busyMin, idleMin, util, nFlt });
    const tk = p.team_code || '—';
    const tm = teamMap.get(tk) || { team_code: tk, n: 0, sumUtil: 0, nUtil: 0, idleMin: 0, nFlt: 0 };
    tm.n++; tm.idleMin += idleMin; tm.nFlt += nFlt; if (util != null) { tm.sumUtil += util; tm.nUtil++; }
    teamMap.set(tk, tm);
  }

  const teams = [...teamMap.values()].map(t => ({ team_code: t.team_code, n: t.n, util: t.nUtil ? Math.round(t.sumUtil / t.nUtil) : null, idle_hours: +(t.idleMin / 60).toFixed(1), flights: t.nFlt })).sort((a, b) => a.team_code.localeCompare(b.team_code));
  const hourly = Array.from({ length: HN }, (_, h) => ({ h, onDuty: hOnDuty[h], onFlight: hOnFlight[h], flights: hFlights[h] }));
  const kpi = { people: people.length, avg_util: nUtil ? Math.round(sumUtil / nUtil) : null, idle_hours: +(sumIdle / 60).toFixed(1), flights: totFlt,
                peak_on_duty: Math.max(0, ...hOnDuty), peak_on_flight: Math.max(0, ...hOnFlight) };
  // จัดอันดับ util น้อยสุด/มากสุด (คนที่มีกะ)
  const withUtil = people.filter(p => p.util != null);
  return { date, kpi, hourly, teams, people: people.sort((a, b) => (b.util ?? -1) - (a.util ?? -1)),
           low_util: withUtil.slice().sort((a, b) => a.util - b.util).slice(0, 5),
           high_util: withUtil.slice().sort((a, b) => b.util - a.util).slice(0, 5) };
}

// gantt: ต่อคน = ช่วงกะ + ช่วงงาน (นาที) สำหรับวาดแท่ง 0..24h
async function gantt(date) {
  const r = await db.query(`
    SELECT d.emp_name, d.team_code, d.shift_start, d.shift_end, d.bucket, d.is_support,
           COALESCE(json_agg(json_build_object('flight',a.flight_leg,'task',a.task,'sta',a.sta,'std',a.std,'counter_open',a.counter_open,'counter_close',a.counter_close,'is_flight',a.is_flight)
                    ORDER BY a.sta) FILTER (WHERE a.id IS NOT NULL), '[]') AS asg
    FROM duty d LEFT JOIN assignment a ON a.duty_id=d.id
    WHERE d.work_date=$1 AND d.bucket IN ('WORKING','OT_OFF') AND NOT d.is_training
    GROUP BY d.id ORDER BY d.team_code, d.shift_start NULLS LAST, d.emp_name`, [date]);
  const rows = r.rows.map(p => {
    let ds = p.shift_start, de = p.shift_end; if (ds != null && de != null && de <= ds) de += 1440;
    const bars = (p.asg || []).map(a => { const w = winOf(a); return w ? { lo: w[0], hi: w[1], label: a.flight || a.task || '', is_flight: a.is_flight } : null; }).filter(Boolean);
    return { emp_name: p.emp_name, team_code: p.team_code, shift_start: ds, shift_end: de, bars };
  });
  return { date, rows };
}

function overlap(lo, hi, a, b) { return Math.min(hi, b) > Math.max(lo, a); }
function overlapDay(ds, de, a, b) { return overlap(ds, de, a, b) || overlap(ds, de, a + 1440, b + 1440); }

module.exports = { productivity, gantt };
