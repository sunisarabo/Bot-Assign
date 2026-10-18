'use strict';
/* compute.js — คำนวณ dashboard จากผล parseDay (Excel) โดยตรง (ไม่ผ่าน DB)
 *   ยก logic Util/Gantt/รายชั่วโมง จาก backend/productivity.js มาทำงานบนโครง {teams, manpower}
 */
const DEP_LEAD = 60, ARR_TAIL = 45, DEF_JOB = 45, HN = 24;
const t2m = (t) => { const m = String(t || '').match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };

function winOf(a) {
  const op = t2m(a.OP), cl = t2m(a.CL), sta = t2m(a.STA), std = t2m(a.STD);
  if (op != null && cl != null) return [op, cl < op ? cl + 1440 : cl];
  if (std != null) return [Math.max(0, std - DEP_LEAD), std];
  if (sta != null) return [sta, sta + ARR_TAIL];
  if (op != null) return [op, op + DEF_JOB];
  return null;
}
function merge(iv) {
  if (!iv.length) return 0;
  iv = iv.slice().sort((a, b) => a[0] - b[0]);
  let tot = 0, lo = iv[0][0], hi = iv[0][1];
  for (let i = 1; i < iv.length; i++) { if (iv[i][0] <= hi) hi = Math.max(hi, iv[i][1]); else { tot += hi - lo; lo = iv[i][0]; hi = iv[i][1]; } }
  return tot + (hi - lo);
}
const clamp = (iv, lo, hi) => iv.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b > a);
const overlap = (lo, hi, a, b) => Math.min(hi, b) > Math.max(lo, a);
const overlapDay = (ds, de, a, b) => overlap(ds, de, a, b) || overlap(ds, de, a + 1440, b + 1440);

function compute(day) {
  const hOnDuty = Array(HN).fill(0), hOnFlight = Array(HN).fill(0), hFlights = Array(HN).fill(0);
  const people = [], gantt = [], teamMap = new Map();
  let sumUtil = 0, nUtil = 0, sumIdle = 0, totFlt = 0, working = 0;

  for (const team of Object.keys(day.teams)) {
    for (const p of day.teams[team]) {
      const isWork = (p.bucket === 'working' || p.bucket === 'ot_off') && !p.training;
      const tm = teamMap.get(team) || { team, ppl: 0, working: 0, sumUtil: 0, nUtil: 0, idleMin: 0, nFlt: 0 };
      tm.ppl++; teamMap.set(team, tm);
      if (!isWork) { continue; }
      working++; tm.working++;
      let ds = p.shiftStart, de = (ds != null && p.shiftHrs) ? Math.round(ds + p.shiftHrs * 60) : null;
      if (ds != null && de != null && de <= ds) de += 1440;
      const dutyMin = (ds != null && de != null) ? de - ds : 0;
      const raw = (p.assignments || []).map(winOf).filter(Boolean);
      const nFlt = (p.assignments || []).filter((a) => a.isFlight).length;
      totFlt += nFlt; tm.nFlt += nFlt;
      const busyIv = dutyMin > 0 ? clamp(raw, ds, de) : raw;
      const busyMin = merge(busyIv);
      const util = dutyMin > 0 ? Math.min(100, Math.round(busyMin / dutyMin * 100)) : null;
      const idleMin = dutyMin > 0 ? Math.max(0, dutyMin - busyMin) : 0;
      if (util != null) { sumUtil += util; nUtil++; sumIdle += idleMin; tm.sumUtil += util; tm.nUtil++; tm.idleMin += idleMin; }
      if (dutyMin > 0) for (let h = 0; h < HN; h++) { const a = h * 60; if (overlapDay(ds, de, a, a + 60)) hOnDuty[h]++; }
      for (const [lo, hi] of busyIv) for (let h = 0; h < HN; h++) { const a = h * 60; if (overlap(lo, hi, a, a + 60) || overlap(lo, hi, a + 1440, a + 1500)) { hOnFlight[h]++; break; } }
      for (const [lo] of raw) { const h = Math.floor((lo % 1440) / 60); if (h >= 0 && h < HN) hFlights[h]++; }
      people.push({ name: p.name, team, shift: p.shift, dutyMin, busyMin, idleMin, util, nFlt, support: p.support });
      gantt.push({ name: p.name, team, shift_start: ds, shift_end: de,
        bars: busyIv.length ? (p.assignments || []).map((a) => { const w = winOf(a); return w ? { lo: w[0], hi: w[1], label: a.flight || a.task || '', is_flight: a.isFlight } : null; }).filter(Boolean) : [] });
    }
  }

  const teams = [...teamMap.values()].map((t) => ({ team: t.team, ppl: t.ppl, working: t.working,
    util: t.nUtil ? Math.round(t.sumUtil / t.nUtil) : null, idle_hours: +(t.idleMin / 60).toFixed(1), flights: t.nFlt }))
    .sort((a, b) => a.team.localeCompare(b.team));
  const hourly = Array.from({ length: HN }, (_, h) => ({ h, onDuty: hOnDuty[h], onFlight: hOnFlight[h], flights: hFlights[h] }));
  const withU = people.filter((p) => p.util != null);
  const kpi = { people: working, avg_util: nUtil ? Math.round(sumUtil / nUtil) : null, idle_hours: +(sumIdle / 60).toFixed(1),
    flights: totFlt, teams: teams.length, peak_on_duty: Math.max(0, ...hOnDuty), peak_on_flight: Math.max(0, ...hOnFlight) };

  return {
    date: day.date, sourceFile: day.sourceFile, kpi, teams, hourly, manpower: day.manpower || [],
    people: people.sort((a, b) => (b.util ?? -1) - (a.util ?? -1)),
    low_util: withU.slice().sort((a, b) => a.util - b.util).slice(0, 8),
    gantt: gantt.sort((a, b) => a.team.localeCompare(b.team) || (a.shift_start ?? 9999) - (b.shift_start ?? 9999)),
    timetable: Object.keys(day.teams).flatMap((tc) => day.teams[tc].map((p) => ({ name: p.name, team: tc, shift: p.shift, bucket: p.bucket, assignments: p.assignments }))),
  };
}

module.exports = { compute };
