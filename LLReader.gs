/**
 * LLReader.gs — LL (ติดตามสัมภาระ / baggage tracing) daily assignment reader
 * =============================================================================
 * The LL daily tab is sectioned by job area (SOD / CENTER / RUSH BAG /
 * FOUND PROPERTY / TRAINEE / ADMIN / LL PORTER). Each section repeats the
 * header: NO | NAME | POSITION | SCHEDULE | RESKED | REMARK | OT code | OT time
 * | job columns…
 *
 * Attendance for LL comes from SCHEDULE (there is no Onduty/Off REMARK):
 *   OFF / blank → off,  SL/SICK → sick,  VAC/BL → leave,  time range → working.
 *
 * Requires RosterReader.gs (reuses rrClean_, rrUp_, rrOtHours_, rrNewAgg_,
 * rrAddBucket_). Returns the same aggregate shape as readRosterFromSpreadsheet,
 * with `sections` in place of `teams`.
 */

function rrLLPosGroup_(pos) {
  var u = String(pos || '').toUpperCase().replace(/ACT\.?\s*/g, '').trim();
  if (u.indexOf('PSS') === 0 || u.indexOf('SUPERVISOR') >= 0) return 'PSS';
  if (u.indexOf('SNR') === 0 || u.indexOf('SENIOR') >= 0) return 'SNR';
  if (u.indexOf('TRAINEE') >= 0) return 'Trainee';
  if (u.indexOf('PORTER') >= 0) return 'Porter';
  if (u.indexOf('ADMIN') >= 0) return 'Admin';
  if (u.indexOf('PSA') === 0 || u.indexOf('AGENT') >= 0) return 'PSA';
  return 'PSA';
}

function rrLLClassify_(sched, remark) {
  var s = rrUp_(sched).trim();
  var rm = rrUp_(remark);
  if (s === 'SL' || s === 'SICK' || s === 'MC' || rm.indexOf('SICK') >= 0) return 'sick';
  if (s === 'VAC' || s === 'BL' || s === 'AL' || s.indexOf('VAC') >= 0) return 'vac';
  if (s === '' || s === 'OFF' || s === 'X' || s === 'XX' || s.indexOf('OFF') === 0) return 'off';
  return 'working';
}

/** Parse one LL daily tab → { sections, positions, totals }. */
function readLLFromTab(ss, tabName) {
  var ws = ss.getSheetByName(tabName);
  if (!ws) throw new Error('ไม่พบแท็บ LL: ' + tabName);
  var last = ws.getLastRow();
  var rows = ws.getRange(1, 1, last, Math.min(ws.getLastColumn(), 12)).getValues();

  var sections = {}, positions = {}, totals = rrNewAgg_();
  var section = '', seen = {};

  rows.forEach(function (r) {
    var c0 = rrClean_(r[0]);
    if (c0 && rrUp_(r[1]) === 'NO' && rrUp_(r[2]) === 'NAME') { section = c0.replace(/\n/g, ' '); return; }
    var no = rrClean_(r[1]), name = rrClean_(r[2]), pos = rrClean_(r[3]);
    if (!name || !pos || rrUp_(r[2]) === 'NAME') return;
    if (!/^\d+(\.\d+)?$/.test(no)) return;
    var key = name.toUpperCase();
    if (seen[key]) return;
    seen[key] = true;

    var sched = rrClean_(r[4]), resked = rrClean_(r[5]), remark = rrClean_(r[6]), ot = rrClean_(r[8]);
    var oth = rrOtHours_(ot);
    var srng = rrRangeStr_(resked || sched), orng = rrRangeStr_(ot);
    var rec = {
      section: section, name: name, pos: pos, posGroup: rrLLPosGroup_(pos), team: section,
      shift: resked || sched, shiftTime: rrFmtRange_(srng) || (resked || sched), shiftStart: srng[0],
      bucket: rrLLClassify_(sched, remark),
      ot: oth, otType: oth > 0 ? rrOtType_(srng, orng, false) : null, otTime: oth > 0 ? rrFmtRange_(orng) : '',
      assignments: [],
    };
    var sk = section || '(none)';
    if (!sections[sk]) { sections[sk] = rrNewAgg_(); sections[sk].records = []; }
    sections[sk].records.push(rec);
    rrAddBucket_(sections[sk], rec);
    if (!positions[rec.posGroup]) positions[rec.posGroup] = rrNewAgg_();
    rrAddBucket_(positions[rec.posGroup], rec);
    rrAddBucket_(totals, rec);
  });

  Object.keys(sections).forEach(function (s) { rrRoundAgg_(sections[s]); });
  Object.keys(positions).forEach(function (p) { rrRoundAgg_(positions[p]); });
  rrRoundAgg_(totals);
  delete totals.records;
  return { sections: sections, positions: positions, totals: totals };
}

/** Find the LL daily tab for a date. Handles "06JUN26" and "6 JUN 2569" forms. */
function findLLTab_(ss, date) {
  var d = date.getDate();
  var dPad = ('0' + d).slice(-2);
  var mon = MON_RB[date.getMonth()];               // from RosterBot.gs
  var yr2 = String(date.getFullYear()).slice(2);
  var be = date.getFullYear() + 543;
  var pats = [
    new RegExp('^' + dPad + '\\s*' + mon + yr2 + '$', 'i'),       // 06JUN26
    new RegExp('^' + dPad + '\\s*' + mon + '$', 'i'),            // 06JUN
    new RegExp('^' + d + '\\s*' + mon + '\\s*' + be + '$', 'i'),  // 6 JUN 2569
    new RegExp('^' + d + '\\s*' + mon + yr2 + '$', 'i'),         // 6JUN26
    new RegExp('^' + d + '\\s*' + mon + '$', 'i'),               // 6 JUN
  ];
  var sheets = ss.getSheets();
  for (var p = 0; p < pats.length; p++) {
    for (var i = 0; i < sheets.length; i++) {
      if (pats[p].test(sheets[i].getName().trim())) return sheets[i].getName();
    }
  }
  return null;
}

/** Open the LL file (by id) and read the tab for the given date. */
function readLLForDate(llFileId, date) {
  var ss = SpreadsheetApp.openById(llFileId);
  var tab = findLLTab_(ss, date);
  if (!tab) throw new Error('ไม่พบแท็บ LL สำหรับวันที่ ' + date.getDate());
  var res = readLLFromTab(ss, tab);
  res.tabName = tab;
  return res;
}

function debugDumpLL(llFileId, y, m, d) {
  var date = (y && m && d) ? new Date(y, m - 1, d) : new Date();
  var res = readLLForDate(llFileId, date);
  var lines = ['LL tab: ' + res.tabName, '', 'BY POSITION  staff work off sick leave otppl oth'];
  ['PSS', 'SNR', 'PSA', 'Porter', 'Admin', 'Trainee'].forEach(function (p) {
    var b = res.positions[p]; if (!b) return;
    lines.push((p + '         ').slice(0, 9) +
      [b.staff, b.working, b.off, b.sick, b.leave, b.otPeople, b.otHours].map(function (n) { return ('    ' + n).slice(-5); }).join(''));
  });
  var T = res.totals;
  lines.push('TOTAL    ' + [T.staff, T.working, T.off, T.sick, T.leave, T.otPeople, T.otHours].map(function (n) { return ('    ' + n).slice(-5); }).join(''));
  Logger.log(lines.join('\n'));
  return res;
}

// ─── COUNTER CHECK (ท่าอากาศยานจัดเคาน์เตอร์เช็คอิน) ─────────────────────────
// อ่านไฟล์ "COUNTER CHECK" ของท่า → จำนวนเคาน์เตอร์ต่อไฟลท์ (คอลัมน์ NO. OF COUNTER)
// ใช้ตัดเพดาน "เช็คอิน" ของ SLA: ถ้าท่าให้เคาน์เตอร์น้อยกว่าที่ SLA ต้องการ → ส่งคนได้เท่าเคาน์เตอร์
/** หา tab ของวันที่ในไฟล์ counter (ชื่อแบบ "16 MAY26" / "6JUL26") — ใช้แพตเทิร์นเดียวกับ LL */
function findCounterTab_(ss, date) { return findLLTab_(ss, date); }
/** parse ชีต counter หนึ่งแท็บ → { "EY411":10, "KC564":5, ... } · คืน null ถ้าไม่ใช่รูปแบบ counter */
function counterParseSheet_(sh) {
  if (!sh) return null;
  var last = sh.getLastRow(); if (last < 3) return null;
  var rows = sh.getRange(1, 1, last, Math.min(sh.getLastColumn(), 10)).getValues();
  var hi = -1, cAir = 0, cFlt = 1, cCtr = -1;
  for (var r = 0; r < Math.min(rows.length, 6); r++) {
    var line = rows[r].map(function (v) { return String(v || '').toUpperCase(); });
    if (line.some(function (v) { return v.indexOf('FLIGHT') >= 0; }) && line.some(function (v) { return /NO\.?\s*OF/.test(v); })) {
      hi = r; cAir = 0; cFlt = 1; cCtr = -1;
      line.forEach(function (v, i) {
        if (v.indexOf('AIRLINE') >= 0) cAir = i;
        else if (v.indexOf('FLIGHT') >= 0) cFlt = i;
        else if (/NO\.?\s*OF/.test(v)) cCtr = i;                    // "NO. OF COUNTER" (จำนวน) — ไม่ใช่ "COUNTER NO." (ป้ายเลขเคาน์เตอร์)
      });
      break;
    }
  }
  if (hi < 0 || cCtr < 0) return null;                             // ไม่พบคอลัมน์จำนวนเคาน์เตอร์ → ไม่ใช่ชีต counter
  var map = {}, curAir = '', nEntry = 0;
  for (var i = hi + 1; i < rows.length; i++) {
    var air = String(rows[i][cAir] || '').trim().toUpperCase();
    if (air) curAir = air;
    var flt = String(rows[i][cFlt] || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!flt) continue;
    var n = parseInt(String(rows[i][cCtr] || '').replace(/[^0-9.]/g, ''), 10);
    if (!(n > 0)) continue;
    map[flt] = n; nEntry++;                                         // "EY411"
    var mm = flt.match(/^([0-9A-Z]{2})?(\d{2,4})/);                 // เลขไฟลท์
    if (mm) { var a = mm[1] || curAir; if (a) map[a + mm[2]] = n; map['#' + mm[2]] = n; }
  }
  return nEntry ? map : null;
}
/** อ่านจากไฟล์เคาน์เตอร์แยก (COUNTER_FILE_ID):
 *  1) แท็บตามวันที่ (ไฟล์ของท่าที่มีแท็บรายวัน) — ต้องแชร์ไฟล์ให้บัญชีที่รัน
 *  2) ถ้าไม่มีแท็บวันที่ → แท็บ "COUNTER" แท็บเดียว (ไฟล์ bridge ที่ IMPORTRANGE ของวันนี้เข้ามา) */
function counterReadForDate(fileId, date) {
  if (!fileId) return null;
  var ss = SpreadsheetApp.openById(fileId);
  var tab = findCounterTab_(ss, date);
  if (tab) { var m = counterParseSheet_(ss.getSheetByName(tab)); if (m) return m; }
  return counterReadFromRoster_(ss);                               // ไฟล์ bridge แท็บเดียว "COUNTER"
}
/** วิธีที่ไม่ต้องแชร์ไฟล์ท่า: อ่านแท็บ "COUNTER" ที่ก๊อปวางในไฟล์ตารางเวรของวันนั้นเอง */
function counterReadFromRoster_(ss) {
  if (!ss) return null;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toUpperCase().indexOf('COUNTER') >= 0) {
      var m = counterParseSheet_(sheets[i]); if (m) return m;
    }
  }
  return null;
}
/** จำนวนเคาน์เตอร์ที่ท่าจัดให้ไฟลท์นี้ (roster flight อาจเป็นคู่ "EY410/EY411") → null ถ้าไม่มี */
function counterForFlight_(map, flight) {
  if (!map) return null;
  var s = String(flight || '').toUpperCase().replace(/\s+/g, '');
  if (map[s] != null) return map[s];
  var air = (typeof slaAirlineOf_ === 'function') ? slaAirlineOf_(flight) : '';
  var nums = s.match(/\d{2,4}/g) || [];
  for (var i = 0; i < nums.length; i++) {
    if (air && map[air + nums[i]] != null) return map[air + nums[i]];
    if (map['#' + nums[i]] != null) return map['#' + nums[i]];
  }
  return null;
}
