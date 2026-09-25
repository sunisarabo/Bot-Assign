'use strict';
/* parseDay.js — แปลงข้อมูลชีต (จาก Microsoft Graph) ของไฟล์เวรรายวัน → โครง duty/assignment/manpower
 *   input: { sheets: [{ name, rows:[[cell,...],...] }, ...] }  (rows = usedRange.values จาก Graph)
 *   output: { date, sourceFile, teams:{TEAM:[people]}, manpower:[...] }  (รูปแบบเดียวกับ db/import.js)
 *
 * พอร์ตจาก powerplatform/tools/parse_daily_workbook.py — แม่นกว่าเพราะ Graph ให้ "ชื่อแท็บจริง"
 * (เดิมอ่านจาก Google export ชื่อแท็บหาย ต้องเดาจากลำดับ)
 */
const DEP_LEAD = 60, ARR_TAIL = 45, DEF_JOB = 45;

const S = (v) => (v == null ? '' : String(v)).trim();
function tmin(t) { const m = S(t).match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function isFlight(code) { const u = S(code).toUpperCase().replace(/\s/g, ''); return /^[A-Z]{1,2}\d{2,4}/.test(u) && !u.includes('BRIEF') && !u.includes('BREIF'); }
function num(v) { const n = parseFloat(S(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; }

function bucketOf(status, remark) {
  const s = S(status).toUpperCase(), r = S(remark).toUpperCase(), txt = r || s;
  if (txt.includes('SICK') || txt === 'SL' || txt === 'MC') return { bucket: 'sick', training: false };
  if (txt.includes('VAC') || ['AL', 'BL', 'VL', 'ML', 'PL'].includes(txt)) return { bucket: 'vac', training: false };
  if (txt.includes('OT OFF') || txt.includes('OT-OFF')) return { bucket: 'ot_off', training: false };
  if (txt.startsWith('OFF') || txt === 'X') return { bucket: 'off', training: false };
  const training = /TRAIN|อบรม|BRIEF|COURSE|MEETING|ประชุม|สัมมนา|OJT|E-?LEARN/.test(r + ' ' + s);
  return { bucket: 'working', training };
}

// ชีตทีม = มีแถวหัวที่มี NAME+SHIFT+STATUS + คำว่า JOB
function findKeyRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const up = rows[i].map((x) => S(x).toUpperCase());
    if (up.includes('NAME') && up.includes('SHIFT') && up.includes('STATUS') && up.some((x) => x.includes('JOB'))) return i;
  }
  return -1;
}
function headerByCol18(rows, label) {
  for (const r of rows) if (S(r[18]).toUpperCase().startsWith(label)) return r;
  return null;
}

function parseTeamSheet(code, rows) {
  const k = findKeyRow(rows);
  if (k < 0) return null;
  const flRow = headerByCol18(rows, 'FLIGHT'), staRow = headerByCol18(rows, 'STA'), opRow = headerByCol18(rows, 'OP');
  const flights = [];
  if (flRow) {
    for (let base = 19; base < flRow.length; base += 4) {
      const codeF = S(flRow[base]);
      if (!codeF || (codeF === 'หมายเลขไฟลท์') || !/\d|BRE?IF|GOM/.test(codeF)) continue;
      let sta = '', std = '', op = '', cl = '';
      if (staRow) { const a = S(staRow[base]).match(/(\d{1,2}[:.]\d{2})/), d = S(staRow[base + 2]).match(/(\d{1,2}[:.]\d{2})/); sta = a ? a[1] : ''; std = d ? d[1] : ''; }
      if (opRow) { const o = S(opRow[base]).match(/(\d{1,2}[:.]\d{2})/), c = S(opRow[base + 2]).match(/(\d{1,2}[:.]\d{2})/); op = o ? o[1] : ''; cl = c ? c[1] : ''; }
      flights.push({ base, code: codeF, STA: sta, STD: std, OP: op, CL: cl });
    }
  }
  const people = [];
  for (let i = k + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 18) continue;
    const name = S(r[2]); const id = S(r[0]).replace(/\D/g, '');
    if (!name || name.startsWith('Ex.') || name.includes('ตัวอย่าง')) continue;
    const total = num(r[6]); const { bucket, training } = bucketOf(r[16], r[17]); const remark = S(r[17]);
    const asg = [];
    for (const f of flights) {
      const jobs = [0, 1, 2, 3].map((n) => S(r[f.base + n])).filter((x) => x && x !== 'JOB →');
      if (jobs.length) asg.push({ flight: f.code, task: jobs.join(' ').slice(0, 30), STA: f.STA, STD: f.STD, OP: f.OP, CL: f.CL, isFlight: isFlight(f.code) });
    }
    people.push({ id, name, shift: S(r[3]), shiftStart: tmin(r[4]), shiftHrs: total || 0, bucket, ot: 0,
      support: remark.includes('ซัพ') || remark.toUpperCase().includes('SUPP'), training, remark, assignments: asg });
  }
  return people;
}

function parseManpower(rows) {
  const out = [];
  for (const r of rows) {
    const m = S(r[0]).match(/Team\s*\((.+?)\)/); if (!m) continue;
    out.push({ team: m[1].trim(), total: num(r[1]), scheduled: num(r[2]), sick: num(r[3]), personal: num(r[4]),
      annual: num(r[5]), maternity: num(r[6]), other: num(r[7]), training: num(r[8]), working: num(r[9]),
      otHours: num(r[10]), otHoliday: num(r[11]), updatedAt: S(r[12]) || null, updatedBy: S(r[13]) || null });
  }
  return out;
}

/** parse ทั้งไฟล์ · sheets = [{name, rows}] จาก Graph */
function parseDay(iso, sourceFile, sheets) {
  const teams = {}; let manpower = [];
  for (const sh of sheets) {
    const nm = S(sh.name);
    if (nm.toUpperCase() === 'MANPOWER') { manpower = parseManpower(sh.rows); continue; }
    const ppl = parseTeamSheet(nm, sh.rows);      // ชื่อแท็บจริง = รหัสทีม
    if (ppl && ppl.length) teams[nm] = ppl;
  }
  return { date: iso, sourceFile: sourceFile || iso, teams, manpower };
}

module.exports = { parseDay, parseTeamSheet, parseManpower };
