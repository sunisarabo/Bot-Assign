/**
 * RosterReader.gs — unified roster reader for Google Apps Script
 * =============================================================================
 * Replaces the brittle, sheet-NAME based routing of the previous assignment
 * script. Parsing is now HEADER-DRIVEN, which is the real fix: team layouts
 * drift between days (e.g. TR is the standard ID/Position/NAME layout on
 * 01–03 JUN but switches to the NO/ID/NAME/TIME/SHIFT/OT variant on 04 JUN;
 * AK/CHN/KE used to have bespoke layouts and are now standard). Routing by name
 * silently mis-read those teams.
 *
 * What it reads correctly for EVERY team:
 *   • headcount  : working / OT-off / off / sick / leave(personal+vacation)
 *   • OT         : number of people on OT + total OT hours
 *   • flights    : per-team flight count, and per-employee flight assignments
 *                  with shift code and flight OP/CL & STA/STD times
 *
 * GROUND-TRUTH RULE (most important): attendance comes from the REMARK column,
 * never from the shift code. A row can show shift "X9" (00:00-09:00) yet REMARK
 * says "OFF" / "OFF (NO RQ OT)" / "OT OFF" — that person is not working.
 *
 * Entry points:
 *   readRosterFromSpreadsheet(ss) -> { teams:{...}, totals:{...} }
 *   debugDumpRoster(ssId)         -> logs the per-team summary
 * The Drive-navigation / monthly-file / Chat plumbing from the original script
 * can call readRosterFromSpreadsheet() in place of detectAndParse().
 */

var SKIP_SHEETS_RR = ['MANPOWER', 'ROSTER', 'SUMMARY', 'MASTER SMART SHIFT', 'SHIFTDB', 'CODE'];

// ─── cell helpers ───────────────────────────────────────────────────────────
function rrClean_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    var h = v.getHours(), m = v.getMinutes();
    return (h || m) ? (('0' + h).slice(-2) + ':' + ('0' + m).slice(-2)) : '';
  }
  var s = String(v).trim();
  return s.replace(/\.0+$/, '');
}
function rrUp_(v) { return rrClean_(v).toUpperCase(); }

// ─── attendance classification (REMARK first, shift only as fallback) ───────
function rrClassify_(shift, remark) {
  var rm = rrUp_(remark).trim();
  var sh = rrUp_(shift).trim();
  var core = rm.replace(/\(.*?\)/g, '').trim();            // strip "(NO RQ OT)" notes

  if (core.indexOf('SICK') === 0 || core === 'SL' || core === 'MC'
      || sh === 'SICK' || sh === 'SL' || sh === 'MC') return 'sick';
  if (core.indexOf('VAC') === 0 || core === 'BL' || core === 'AL' || core === 'VACATION') return 'vac';
  if (core.indexOf('OT OFF') === 0 || core.indexOf('OT-OFF') === 0) return 'ot_off';
  if (core.indexOf('ONDUTY') === 0 || core.indexOf('ON DUTY') === 0) return 'working';
  if (core.indexOf('OFF') === 0 || core === 'X') return 'off';
  if (core === '') {                                       // no REMARK -> use shift
    if (sh.indexOf('VAC') >= 0 || sh === 'BL') return 'vac';
    if (sh === 'SL' || sh === 'SICK' || sh === 'MC') return 'sick';
    if (sh === '' || sh === 'X' || sh === 'XX' || sh === 'OFF' || sh === '-'
        || sh.indexOf('OFF') === 0) return 'off';
    return 'working';
  }
  return 'working';
}

// ─── time / OT helpers ──────────────────────────────────────────────────────
function rrTimePair_(s) {
  var m = rrClean_(s).match(/(\d{1,2})[:.]?(\d{2})/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}
function rrRangeHours_(s) {
  var str = rrClean_(s).replace(/\./g, ':');
  var m = str.match(/^(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
  if (!m) return 0;
  var a = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  var b = parseInt(m[3], 10) * 60 + (m[4] ? parseInt(m[4], 10) : 0);
  if (b <= a) b += 1440;
  return Math.round((b - a) / 60 * 10) / 10;
}
function rrOtHours_(v) {
  var s = rrUp_(v);
  if (!s || s === '-' || s === 'NO OT' || s === 'VAC' || s === 'X') return 0;
  var m = s.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);          // duration H:MM[:SS]
  if (m) {
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    return h <= 14 ? Math.round((h + mi / 60) * 10) / 10 : 0;  // >14 = clock time
  }
  if (/^\d+(\.\d+)?$/.test(s)) { var f = parseFloat(s); return (f > 0 && f <= 14) ? f : 0; }
  return rrRangeHours_(s);
}

// ── OT pre/post (ก่อนกะ / หลังกะ) classification ────────────────────────────
function rrMin_(v) {
  var s = rrClean_(v); if (!s) return null;
  var m = s.match(/^(\d{1,2})[:.](\d{2})/); if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(\d{2})(\d{2})$/); if (m) return +m[1] * 60 + +m[2];
  return null;
}
/** [start,end] minutes from a 'HH-HH' range string, else [null,null]. */
function rrRangeStr_(s) {
  s = rrClean_(s);
  var m = s.match(/(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
  if (m) return [(+m[1]) * 60 + (m[2] ? +m[2] : 0), (+m[3]) * 60 + (m[4] ? +m[4] : 0)];
  return [null, null];
}
/** [start,end] minutes from a clock-in cell (+ next col), or a range cell. */
function rrRangeCells_(row, col) {
  if (col < 0 || col >= row.length) return [null, null];
  var r = rrRangeStr_(row[col]);
  if (r[0] != null) return r;
  return [rrMin_(row[col]), col + 1 < row.length ? rrMin_(row[col + 1]) : null];
}
function rrFmtMin_(m) {
  if (m == null) return '';
  var h = Math.floor(m / 60) % 24, mm = ((m % 60) + 60) % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + mm).slice(-2);
}
function rrFmtRange_(r) { return (r[0] != null && r[1] != null) ? (rrFmtMin_(r[0]) + '-' + rrFmtMin_(r[1])) : ''; }

/** 'PRE' (OT before shift) or 'POST' (OT after shift). Defaults POST. */
function rrOtType_(srng, orng, isOff) {
  if (isOff) return 'POST';
  var si = srng[0], so = srng[1], oi = orng[0], oo = orng[1];
  if (oi == null) return 'POST';
  if (so != null && si != null && so <= si) so += 1440;
  if (oo != null && oo <= oi) oo += 1440;
  var TOL = 30;
  if (si != null && oo != null && oo <= si + TOL) return 'PRE';
  if (so != null && oi >= so - TOL) return 'POST';
  if (si != null && oi < si) return 'PRE';
  return 'POST';
}

// ─── header detection (standard + TR NO/ID/NAME/TIME/SHIFT/OT variant) ──────
function rrFindHeader_(rows) {
  for (var r = 0; r < Math.min(8, rows.length); r++) {
    var u = rows[r].map(rrUp_);
    if (u.indexOf('NAME') < 0) continue;
    var idIdx = u.indexOf('ID');
    if (idIdx < 0) idIdx = u.indexOf('NO');
    if (idIdx < 0) idIdx = u.indexOf('NO.');
    if (idIdx < 0) continue;

    var cm = { hdr: r, name: u.indexOf('NAME'), id: idIdx };
    cm.shift  = u.indexOf('SHIFT');
    cm.time   = u.indexOf('TIME');
    cm.pos    = u.indexOf('POSITION') >= 0 ? u.indexOf('POSITION') : u.indexOf('POS.');
    cm.remark = u.indexOf('REMARK');
    cm.re     = u.indexOf('RE');
    cm.resked = u.indexOf('RE-SKED');
    if (cm.resked < 0) cm.resked = u.indexOf('RESKED');
    if (cm.resked < 0) cm.resked = u.indexOf('RE-SKED.');
    cm.ot     = u.indexOf('OT');
    cm.ottot  = -1;
    for (var c = 0; c < u.length; c++) {
      var h = u[c].replace(/\./g, '').replace(/\s+/g, ' ').trim();
      if (h.indexOf('TOTAL') === 0 && cm.ot >= 0 && (c - cm.ot) > 0 && (c - cm.ot) <= 3) cm.ottot = c;
    }
    cm.flt = u.indexOf('FLIGHT') >= 0 ? u.indexOf('FLIGHT') + 1 : -1;
    return cm;
  }
  return null;
}

// ─── parsers ────────────────────────────────────────────────────────────────
function rrParseStandard_(rows, team) {
  var cm = rrFindHeader_(rows);
  if (!cm) return null;
  var hi = cm.hdr;

  var flights = {}, fltcols = [];
  if (cm.flt >= 0) {
    var hdr = rows[hi];
    for (var c = cm.flt; c < hdr.length; c++) {
      var nm = rrClean_(hdr[c]);
      var nu = nm.toUpperCase();
      if (nm && nm.charAt(0) !== '=' && nu !== 'STA / STD' && nu !== 'OP / CL'
          && nu !== 'REMARK' && nu !== 'RE' && nu !== 'OT' && nu !== 'COUNTER') {
        fltcols.push({ col: c, name: nm });
      }
    }
    var sta = rows[hi + 1] || [], opn = rows[hi + 2] || [];
    for (var fi = 0; fi < fltcols.length; fi++) {
      var c0 = fltcols[fi].col;
      var c1 = (fi + 1 < fltcols.length) ? fltcols[fi + 1].col : hdr.length;
      fltcols[fi].end = c1;                                  // flight occupies cols c0..c1-1
      var st = [], oc = [];
      for (var cc = c0; cc < c1; cc++) {
        var tv = rrTimePair_(sta[cc]); if (tv) st.push(tv);
        var ov = rrTimePair_(opn[cc]); if (ov) oc.push(ov);
      }
      flights[fltcols[fi].name] = { STA: st[0] || '', STD: st[1] || '', OP: oc[0] || '', CL: oc[1] || '' };
    }
  }

  var recs = [], seen = {};
  for (var rr = hi + 1; rr < rows.length; rr++) {
    var row = rows[rr];
    var idd = (cm.id < row.length ? rrClean_(row[cm.id]) : '').replace(/\D/g, '');
    if (idd.length < 6 && cm.id + 1 < row.length) {          // WY leading seq column
      var rawNext = rrClean_(row[cm.id + 1]).replace(/\.0+$/, '');
      if (/^\d{6,8}$/.test(rawNext)) idd = rawNext;           // only a PURE numeric id (not a flight code like PG251/252)
    }
    var name = cm.name < row.length ? rrClean_(row[cm.name]) : '';
    if (!name || idd.length < 6 || idd.length > 8) continue;
    var nU = name.toUpperCase();
    if (nU === 'NAME' || nU === 'REMARK' || nU === 'SUPPORT' || nU === 'JAIDEE' || seen[idd]) continue;
    if (rrUp_(row[cm.id]).indexOf('EX') === 0) continue;     // template "Ex. 212121" sample row
    seen[idd] = true;

    var shift  = (cm.shift  >= 0 && cm.shift  < row.length) ? rrClean_(row[cm.shift])  : '';
    var timev  = (cm.time   >= 0 && cm.time   < row.length) ? rrClean_(row[cm.time])   : '';
    var remark = (cm.remark >= 0 && cm.remark < row.length) ? rrClean_(row[cm.remark]) : '';
    var otv    = (cm.ottot  >= 0 && cm.ottot  < row.length) ? rrClean_(row[cm.ottot])  : '';

    var assigns = [];
    fltcols.forEach(function (fc) {
      var tasks = [];
      for (var cc = fc.col; cc < (fc.end || fc.col + 1); cc++) {
        var v = cc < row.length ? rrClean_(row[cc]) : '';
        if (v) tasks.push(v);
      }
      if (tasks.length) {
        var info = flights[fc.name] || {};
        assigns.push({ flight: fc.name, task: tasks.join('/'),
                       STA: info.STA || '', STD: info.STD || '', OP: info.OP || '', CL: info.CL || '' });
      }
    });

    var oth = rrOtHours_(otv);
    var bkt = rrClassify_(shift || timev, remark);
    var srng = cm.time >= 0 ? rrRangeCells_(row, cm.time) : [null, null];
    // Re-Sked overrides the shift time when filled (เปลี่ยนเวลาเข้างาน)
    var reTime = '';
    if (cm.resked >= 0) {
      var rs = rrRangeCells_(row, cm.resked);
      if (rs[0] != null) { srng = rs; reTime = rrFmtRange_(rs); }
    }
    var orng = cm.ot >= 0 ? rrRangeCells_(row, cm.ot) : [null, null];
    var otType = oth > 0 ? rrOtType_(srng, orng, bkt === 'ot_off') : null;
    recs.push({
      team: team, id: idd, name: name,
      pos: cm.pos >= 0 ? rrClean_(row[cm.pos]) : '',
      re: reTime || ((cm.re >= 0 && cm.re < row.length) ? rrClean_(row[cm.re]) : ''),
      shift: shift || timev,
      shiftTime: rrFmtRange_(srng) || (shift || timev),
      shiftStart: srng[0],
      shiftHrs: (srng[0] != null && srng[1] != null) ? Math.round((((srng[1] <= srng[0] ? srng[1] + 1440 : srng[1]) - srng[0]) / 60) * 10) / 10 : 0,
      bucket: bkt, ot: oth, otType: otType, otTime: oth > 0 ? rrFmtRange_(orng) : '',
      assignments: assigns,
    });
  }
  return recs;
}

function rrParsePorter_(rows, team) {
  var recs = [];
  for (var r = 2; r < rows.length; r++) {
    var row = rows[r];
    [0, 6].forEach(function (base) {
      if (base + 4 >= row.length) return;
      var nm = rrClean_(row[base]), sched = rrClean_(row[base + 3]), ot = rrClean_(row[base + 4]);
      var nU = nm.toUpperCase();
      if (!nm || nm.length < 2 || /^\d/.test(nm) || nU === 'NAME' || nU === '(INTER)'
          || nU === '(DOM)' || nU.indexOf('STBY') >= 0) return;
      recs.push({ team: team, id: '', name: nm, pos: 'PORTER', shift: sched,
                  bucket: rrClassify_(sched, ''), ot: rrOtHours_(ot), assignments: [] });
    });
  }
  return recs;
}

function rrParseAdminDoc_(rows, team) {
  var recs = [];
  for (var r = 2; r < rows.length; r++) {
    var row = rows[r];
    var nm = rrClean_(row[0]), sched = row.length > 1 ? rrClean_(row[1]) : '';
    var nU = nm.toUpperCase();
    if (!nm || nm.length < 2 || nU === 'NAME' || nU === 'SCHEDULE') continue;
    var flts = [];
    for (var c = 2; c < row.length; c++) { var v = rrClean_(row[c]); if (v) flts.push({ flight: v, task: '' }); }
    recs.push({ team: team, id: '', name: nm, pos: 'ADMINDOC', shift: sched,
                bucket: (!sched || sched.toUpperCase() === 'OFF') ? 'off' : 'working',
                ot: 0, assignments: flts });
  }
  return recs;
}

function rrParseCrewsign_(rows, team) {
  var recs = [], hi = -1;
  for (var r = 0; r < Math.min(20, rows.length); r++) {
    var u = rows[r].map(rrUp_);
    if (u.indexOf('STAFF NAME') >= 0 || (u.indexOf('SHIFT') >= 0 && u.indexOf('REMARK') >= 0)) { hi = r; break; }
  }
  if (hi < 0) return recs;
  var seen = {};
  for (var rr = hi + 1; rr < rows.length; rr++) {
    var row = rows[rr];
    var shift = rrClean_(row[0]), name = row.length > 1 ? rrClean_(row[1]) : '';
    var flt = row.length > 3 ? rrClean_(row[3]) : '';
    var nU = name.toUpperCase();
    if (!name || name.length < 2 || nU === 'STAFF NAME' || nU === 'NAME') continue;
    var key = nU.replace(/[\s\.]+/g, '');
    if (seen[key]) continue;                                  // dedup roster vs assignment blocks
    seen[key] = true;
    var actual = shift.indexOf('/') >= 0 ? shift.split('/').pop().trim() : shift;
    // block has SHIFT (assignment) → classify by shift; roster block (no shift) → REMARK col
    var bkt = shift ? rrClassify_(actual, '') : rrClassify_('', flt);
    recs.push({ team: team, id: '', name: name, pos: 'CREWSIGN', shift: shift,
                bucket: bkt, ot: 0,
                assignments: (flt && rrUp_(flt) !== 'OFF') ? [{ flight: flt, task: '' }] : [] });
  }
  return recs;
}

/**
 * SU has a bespoke 3-section template (rolls out for SU specifically):
 *   1) CHECK-IN COUNTER rotation  — staff sit a long stretch ("check-in
 *      common") rotating across time slots, covering MANY flights.
 *   2) ARRIVAL & DEPARTURE GATE   — per-flight gate roles.
 *   3) JOB DETAIL                 — per-flight job roles (SOD/OB/RF/...).
 * A staff member therefore gets ONE long CHECK-IN block plus per-flight
 * gate/job assignments — matching how SU actually schedules.
 */
function rrIsSuName_(raw) {
  var n = String(raw || '').trim();
  // strip a trailing borrowed-team / status suffix (e.g. "TANADON PVT", "ANUTTRI JQ")
  n = n.replace(/\s+(WK|TRN|EK|WY|QR|JQ|KC|ZF|FC|BOGO|PVT|ZF)\b.*$/i, '').trim();
  if (!n || n.length < 2 || n === '-') return null;
  var u = n.toUpperCase();
  if (/\d/.test(u)) return null;                              // flight codes (SU637)
  if (u.indexOf('PORTER') >= 0) return null;
  var stop = ['SPVR', 'SOD', 'OB', 'ONBOARD', 'RF', 'CS', 'ARR', 'PSC', 'STBY',
              'SCAN', 'FILE', 'MONITOR', 'BRIEF', 'NIL', 'REMARK', 'GATE', 'AGENT', 'PREPARED'];
  for (var i = 0; i < stop.length; i++) if (u === stop[i]) return null;
  return n;
}

function rrParseSU_(rows, team) {
  var staff = {};
  function get(raw) {
    var n = rrIsSuName_(raw);
    if (!n) return null;
    if (!staff[n]) staff[n] = { counter: [], flights: [] };
    return n;
  }
  function split(v) { return rrClean_(v).split(/[,\/]/); }

  var ci = -1, ga = -1, jb = -1;
  for (var r = 0; r < Math.min(40, rows.length); r++) {
    var row = rows[r];
    var c1 = rrUp_(row[1]), c2 = rrUp_(row[2]), c3 = rrUp_(row[3]), c5 = rrUp_(row[5]);
    if (ci < 0 && c1 === 'FLT' && (c2 === 'TIME' || c2 === 'SCHEDULE')) ci = r;
    else if (ga < 0 && c1 === 'FLT' && c3.indexOf('GATE') >= 0) ga = r;
    else if (jb < 0 && c1 === 'FLT' && c5.indexOf('SOD') >= 0) jb = r;
  }
  var info = {};

  // 1) counter rotation
  if (ci >= 0) {
    var curflt = '';
    for (var r1 = ci + 1; r1 < rows.length; r1++) {
      var row1 = rows[r1];
      var f = rrClean_(row1[1]), slot = rrClean_(row1[2]);
      if (rrUp_(row1[1]).indexOf('ARRIVAL') === 0 || rrUp_(row1[1]) === 'FLT') break;
      if (!slot) continue;
      if (f) curflt = f.replace(/\n/g, ' ');
      for (var c = 3; c < row1.length; c++) {
        split(row1[c]).forEach(function (p) {
          var nm = get(p); if (nm) staff[nm].counter.push({ flts: curflt, time: slot });
        });
      }
    }
  }
  // 2) gate per-flight
  if (ga >= 0) {
    var groles = rows[ga].slice(3).map(rrClean_);
    for (var r2 = ga + 1; r2 < rows.length; r2++) {
      var row2 = rows[r2], flt2 = rrClean_(row2[1]);
      if (!/SU\d/i.test(flt2)) continue;
      var sta = rrClean_(row2[2]);
      info[flt2] = info[flt2] || {};
      info[flt2].STA = sta.split('/')[0] || ''; info[flt2].STD = sta.indexOf('/') >= 0 ? sta.split('/')[1] : '';
      for (var c2 = 3; c2 < row2.length; c2++) {
        var role2 = groles[c2 - 3] || 'GATE';
        split(row2[c2]).forEach(function (p) {
          if (rrUp_(p) === 'SPVR') return;
          var nm = get(p);
          if (nm) staff[nm].flights.push({ flight: flt2, task: role2, STA: info[flt2].STA, STD: info[flt2].STD, OP: '', CL: '' });
        });
      }
    }
  }
  // 3) job detail
  if (jb >= 0) {
    var jroles = rows[jb].slice(5).map(rrClean_);
    for (var r3 = jb + 1; r3 < rows.length; r3++) {
      var row3 = rows[r3], flt3 = rrClean_(row3[1]);
      if (!/SU\d/i.test(flt3)) continue;
      var opcls = rrClean_(row3[4]);
      info[flt3] = info[flt3] || {};
      if (opcls.indexOf('/') >= 0) { info[flt3].OP = opcls.split('/')[0]; info[flt3].CL = opcls.split('/')[1]; }
      for (var c3 = 5; c3 < row3.length; c3++) {
        var role3 = jroles[c3 - 5] || '';
        split(row3[c3]).forEach(function (p) {
          if (rrUp_(p) === 'PORTER CS') return;
          var nm = get(p);
          if (nm) staff[nm].flights.push({ flight: flt3, task: role3,
            STA: info[flt3].STA || '', STD: info[flt3].STD || '', OP: info[flt3].OP || '', CL: info[flt3].CL || '' });
        });
      }
    }
  }

  var recs = [];
  Object.keys(staff).forEach(function (nm) {
    var d = staff[nm], shift = '';
    if (d.counter.length) {
      var ts = d.counter.map(function (s) { return s.time; }).filter(function (t) { return /[-–:]/.test(t); });
      if (ts.length) {
        var first = ts[0].split(/[-–]/)[0].trim();
        var last = ts[ts.length - 1].split(/[-–]/).pop().trim();
        shift = first + '-' + last;
      }
    }
    var assigns = d.flights.slice();
    if (d.counter.length) {
      var fset = {};
      d.counter.forEach(function (s) { (s.flts.match(/SU\d+(?:\/\d+)?/ig) || []).forEach(function (x) { fset[x] = 1; }); });
      assigns.unshift({ flight: 'CHECK-IN COMMON', task: Object.keys(fset).join(' '),
        STA: '', STD: '', OP: d.counter[0].time, CL: d.counter[d.counter.length - 1].time });
    }
    recs.push({ team: team, id: '', name: nm, pos: '', shift: shift,
      bucket: (assigns.length || shift) ? 'working' : 'off', ot: 0, assignments: assigns });
  });
  return recs;
}

function rrParseSheet_(ws) {
  var name = ws.getName();
  var n = name.trim().toUpperCase();
  for (var i = 0; i < SKIP_SHEETS_RR.length; i++) if (n.indexOf(SKIP_SHEETS_RR[i]) >= 0) return null;
  var last = ws.getLastRow();
  if (last < 3) return null;
  var rows = ws.getRange(1, 1, last, Math.min(ws.getLastColumn(), 60)).getValues();
  if (n.indexOf('PORTER') >= 0 && n.indexOf('CREW') >= 0) return rrParseCrewsign_(rows, name);
  if (n === 'PORTER') {
    // New PORTER sheets use the standard ID/REMARK layout; old ones are a
    // 2-column name list. Prefer standard; fall back to the 2-column parser.
    var pstd = rrParseStandard_(rows, name);
    if (pstd && pstd.length) return pstd;
    return rrParsePorter_(rows, name);
  }
  if (n.indexOf('ADMIN') >= 0 && n.indexOf('DOC') >= 0) return rrParseAdminDoc_(rows, name);
  if (n === 'SU' || n.indexOf('SU ') === 0) {
    // New SU template (effective 08 JUN) is a standard ID/REMARK staff table
    // (with inline Counter/Gate sections); the old SU sheet is a counter-rotation
    // grid with no ID column. Prefer the standard reader; fall back to the grid.
    var std = rrParseStandard_(rows, name);
    if (std && std.length) return std;
    return rrParseSU_(rows, name);
  }
  return rrParseStandard_(rows, name);
}

// When both a base sheet and its REV version exist, keep the REV one.
function rrFilterRev_(sheets) {
  var names = sheets.map(function (s) { return s.getName(); });
  var skip = {};
  names.forEach(function (nm) {
    if (nm.toUpperCase().indexOf('REV') < 0) return;
    var base = nm.replace(/REV\.?\d*/ig, '').replace(/[\s._]+/g, '').toUpperCase();
    names.forEach(function (o) {
      if (o === nm || o.toUpperCase().indexOf('REV') >= 0) return;
      if (o.replace(/\s+/g, '').toUpperCase() === base) skip[o] = true;
    });
  });
  return sheets.filter(function (s) { return !skip[s.getName()]; });
}

// ─── public entry point ─────────────────────────────────────────────────────
// Map a roster Position + team to an operational position group (exact, from
// the assignment file — no master/manpower lookup needed).
function rrPosGroup_(pos, team) {
  var t = String(team || '').toUpperCase();
  if (t.indexOf('CREW') >= 0) return 'Crewsign';
  if (t.indexOf('PORTER') >= 0) return 'Porter';
  if (t.indexOf('ADMIN') >= 0 && t.indexOf('DOC') >= 0) return 'AdminD';
  if (t.indexOf('GLOB') >= 0) return 'Globlex';
  var c = String(pos || '').toUpperCase().replace(/ACT\.?\s*/g, '').trim();
  if (c.indexOf('DIRECTOR') >= 0) return 'DIR';
  if (c.indexOf('ASSIST') >= 0 && c.indexOf('MANAGER') >= 0) return 'Assist';
  if (c.indexOf('MANAGER') >= 0) return 'MGR';
  if (c.indexOf('SUP') >= 0 || c === 'PSS') return 'PSS';
  if (c.indexOf('SNR') >= 0 || c.indexOf('SENIOR') >= 0) return 'SNR';
  if (c.indexOf('ADMIN') >= 0) return 'AdminD';
  if (c.indexOf('PORTER') >= 0) return 'Porter';
  return 'PSA';                                              // Agent / blank default
}

function rrAddBucket_(agg, r) {
  if (r.bucket === 'working') agg.working++;
  else if (r.bucket === 'ot_off') agg.ot_off++;
  else if (r.bucket === 'off') agg.off++;
  else if (r.bucket === 'sick') agg.sick++;
  else if (r.bucket === 'vac') agg.leave++;
  if (r.ot > 0) {
    agg.otPeople++; agg.otHours += r.ot;
    if (r.bucket === 'ot_off') { agg.otOffHrs += r.ot; }       // OT OFF hours (count = ot_off)
    else if (r.otType === 'PRE') { agg.otPre++; agg.otPreHrs += r.ot; }
    else { agg.otPost++; agg.otPostHrs += r.ot; }
  }
  agg.flights += (r.assignments ? r.assignments.length : 0);
  agg.staff++;
}
function rrNewAgg_() {
  return { staff: 0, working: 0, ot_off: 0, off: 0, sick: 0, leave: 0, otPeople: 0, otHours: 0,
           otPre: 0, otPreHrs: 0, otPost: 0, otPostHrs: 0, otOffHrs: 0, flights: 0 };
}
function rrRoundAgg_(a) {
  a.otHours = Math.round(a.otHours * 10) / 10; a.otPreHrs = Math.round(a.otPreHrs * 10) / 10;
  a.otPostHrs = Math.round(a.otPostHrs * 10) / 10; a.otOffHrs = Math.round(a.otOffHrs * 10) / 10; return a;
}

function readRosterFromSpreadsheet(ss) {
  var teams = {};
  var positions = {};                                        // exact per-position-group rollup
  var totals = rrNewAgg_();
  rrFilterRev_(ss.getSheets()).forEach(function (ws) {
    var recs = rrParseSheet_(ws);
    if (!recs || !recs.length) return;
    var t = rrNewAgg_();
    t.records = recs;
    recs.forEach(function (r) {
      r.posGroup = rrPosGroup_(r.pos, ws.getName());
      rrAddBucket_(t, r);
      if (!positions[r.posGroup]) positions[r.posGroup] = rrNewAgg_();
      rrAddBucket_(positions[r.posGroup], r);
      rrAddBucket_(totals, r);
    });
    rrRoundAgg_(t);
    teams[ws.getName().trim()] = t;
  });
  Object.keys(positions).forEach(function (p) { rrRoundAgg_(positions[p]); });
  rrRoundAgg_(totals);
  delete totals.records;
  return { teams: teams, positions: positions, totals: totals };
}

// ─── debug ──────────────────────────────────────────────────────────────────
function debugDumpRoster(ssId) {
  var ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.getActiveSpreadsheet();
  var res = readRosterFromSpreadsheet(ss);
  var lines = ['TEAM              staff work otoff off sick leave otppl   oth  flts'];
  Object.keys(res.teams).forEach(function (t) {
    var b = res.teams[t];
    lines.push((t + '                  ').slice(0, 18) +
      [b.staff, b.working, b.ot_off, b.off, b.sick, b.leave, b.otPeople, b.otHours, b.flights]
        .map(function (n) { return ('     ' + n).slice(-6); }).join(''));
  });
  var T = res.totals;
  lines.push('TOTAL             ' +
    [T.staff, T.working, T.ot_off, T.off, T.sick, T.leave, T.otPeople, T.otHours, T.flights]
      .map(function (n) { return ('     ' + n).slice(-6); }).join(''));
  lines.push('');
  lines.push('BY POSITION       staff work otoff off sick leave otppl   oth  flts');
  ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign', 'DIR', 'MGR', 'Assist'].forEach(function (p) {
    var b = res.positions[p]; if (!b) return;
    lines.push((p + '                  ').slice(0, 18) +
      [b.staff, b.working, b.ot_off, b.off, b.sick, b.leave, b.otPeople, b.otHours, b.flights]
        .map(function (n) { return ('     ' + n).slice(-6); }).join(''));
  });
  Logger.log(lines.join('\n'));
  return res;
}
