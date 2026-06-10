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

function rrRangeStr_(s) {
  s = rrClean_(s);
  var m = s.match(/(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
  if (m) return [(+m[1]) * 60 + (m[2] ? +m[2] : 0), (+m[3]) * 60 + (m[4] ? +m[4] : 0)];
  return [null, null];
}

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
    if (cm.flt < 0) {
      // บางวันชีต (เช่น WY) ไม่มีหัว "FLIGHT" — รหัสไฟลท์อยู่ในหัวตารางตรง ๆ
      var after = Math.max(cm.remark, cm.ot, cm.ottot, cm.time, cm.shift, cm.name, cm.id);
      for (var fc = after + 1; fc < u.length; fc++) {
        if (rrIsFlightHdr_(u[fc])) { cm.flt = fc; break; }
      }
    }
    return cm;
  }
  return null;
}

function rrIsFlightHdr_(h) {
  return /(?:^|[\s\/])(?:[A-Z]{1,3}\s?\d{2,4}|\d[A-Z]\d{2,4})/.test(String(h || ''));
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
          && nu !== 'REMARK' && nu !== 'RE' && nu !== 'OT' && nu !== 'COUNTER'
          && nu !== 'NIL' && nu !== '-' && nu !== 'N/A' && nu !== 'NA') {   // NIL = placeholder "ไม่มีไฟลท์" — ไม่นับ
        fltcols.push({ col: c, name: nm });
      }
    }
    var sta = rows[hi + 1] || [], opn = rows[hi + 2] || [];
    for (var fi = 0; fi < fltcols.length; fi++) {
      var c0 = fltcols[fi].col;
      var c1 = (fi + 1 < fltcols.length) ? fltcols[fi + 1].col : hdr.length;
      fltcols[fi].end = c1;                                  // flight occupies cols c0..c1-1
      // ใช้ป้าย A:/D: (STA/STD) และ O:/C: (OP/CL) ถ้ามี (กัน STA ว่างแล้ว STD เลื่อนมาผิดช่อง)
      var staV = '', stdV = '', opV = '', clV = '', posS = [], posO = [];
      for (var cc = c0; cc < c1; cc++) {
        var sc = rrClean_(sta[cc]), tv = rrTimePair_(sc);
        if (tv) { if (/^\s*D/i.test(sc)) stdV = tv; else if (/^\s*A/i.test(sc)) staV = tv; else posS.push(tv); }
        var ocs = rrClean_(opn[cc]), ov = rrTimePair_(ocs);
        if (ov) { if (/^\s*C/i.test(ocs)) clV = ov; else if (/^\s*O/i.test(ocs)) opV = ov; else posO.push(ov); }
      }
      if (!staV && posS.length) staV = posS.shift();
      if (!stdV && posS.length) stdV = posS.shift();
      if (!opV && posO.length) opV = posO.shift();
      if (!clV && posO.length) clV = posO.shift();
      flights[fltcols[fi].name] = { STA: staV, STD: stdV, OP: opV, CL: clV };
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
    // OT ชั่วโมง: ปกติอยู่คอลัมน์ TOTAL หลัง OT; ถ้าไม่มี → ใช้ค่าในคอลัมน์ OT เอง (เช่น "14-20")
    var otCol = cm.ottot >= 0 ? cm.ottot : cm.ot;
    var otv   = (otCol >= 0 && otCol < row.length) ? rrClean_(row[otCol]) : '';

    var assigns = [];
    fltcols.forEach(function (fc) {
      var tasks = [], times = [];
      for (var cc = fc.col; cc < (fc.end || fc.col + 1); cc++) {
        var v = cc < row.length ? rrClean_(row[cc]) : '';
        if (!v) continue;
        if (/^\d{1,2}[:.]\d{2}/.test(v)) times.push(v); else tasks.push(v);   // SU: เวลาในเซลล์เคาน์เตอร์
      }
      if (tasks.length || times.length) {
        var info = flights[fc.name] || {};
        var op = info.OP || '', cl = info.CL || '';
        if (times.length && !op && !cl) { op = times[0]; cl = times[times.length - 1]; }   // ใช้เวลาในเซลล์เป็น OP/CL
        assigns.push({ flight: fc.name, task: tasks.join('/'),
                       STA: info.STA || '', STD: info.STD || '', OP: op, CL: cl });
      }
    });
    // บางเทมเพลต (เช่น REV.01 TK) เขียนไฟลท์เป็นข้อความในคอลัมน์ "FLIGHT" (เช่น VJ808/OD543)
    // → เพิ่มรหัสไฟลท์ที่ยังไม่มี (กันนับซ้ำด้วยเลขไฟลท์)
    if (cm.flt - 1 >= 0 && cm.flt - 1 < row.length) {
      var label = rrClean_(row[cm.flt - 1]);
      if (label && !/^(OFF|VAC|SICK|SL|BL|X|ONDUTY|SUPPORT|PASSENGER|NIL)/i.test(label)) {
        var nums = {};
        assigns.forEach(function (a) { (a.flight.match(/\d{2,4}/g) || []).forEach(function (n) { nums[n] = 1; }); });
        (label.match(/[A-Z0-9]{1,3}\s?\d{2,4}(?:\s?\/\s?\d{2,4})?/gi) || []).forEach(function (code) {
          code = code.trim();
          var cn = code.match(/\d{2,4}/g) || [];
          var allDup = cn.length && cn.every(function (n) { return nums[n]; });
          if (cn.length && !allDup && acIsFlight_(code)) {
            assigns.push({ flight: code, task: '', STA: '', STD: '', OP: '', CL: '' });
            cn.forEach(function (n) { nums[n] = 1; });
          }
        });
      }
    }

    var oth = rrOtHours_(otv);
    var bkt = rrClassify_(shift || timev, remark);
    if (bkt === 'off' && oth > 0) bkt = 'ot_off';            // SHIFT=X แต่มี OT (เช่น 14-20) = ทำ OT วันหยุด
    // เวลากะ: ปกติอยู่คอลัมน์ TIME; ถ้าไม่มี → อ่านช่วงเวลาจากคอลัมน์ SHIFT เอง (เช่น "09-17")
    var srng = cm.time >= 0 ? rrRangeCells_(row, cm.time) : rrRangeStr_(shift);
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

// เมื่อชีตทีมเดียวกันมีหลายเวอร์ชัน (เช่น AK, REV01 AK, REV02 AK) → เก็บ REV ล่าสุด
// (เลขสูงสุด) ทิ้งตัวเดิมและ REV เก่ากว่า. base = -1, REV ไม่มีเลข = 0, REVnn = nn
function rrRevNo_(nm) {
  var u = String(nm).toUpperCase();
  var m = u.match(/REV\.?\s*0*(\d+)/);
  if (m) return parseInt(m[1], 10);
  return /REV/.test(u) ? 0 : -1;
}
function rrTeamBase_(nm) {
  return String(nm).replace(/REV\.?\s*\d*/ig, '').replace(/[\s._\-]+/g, '').toUpperCase();
}
function rrFilterRev_(sheets) {
  var maxRev = {};
  sheets.forEach(function (s) {
    var b = rrTeamBase_(s.getName()), rv = rrRevNo_(s.getName());
    if (maxRev[b] === undefined || rv > maxRev[b]) maxRev[b] = rv;
  });
  var taken = {};
  return sheets.filter(function (s) {
    var b = rrTeamBase_(s.getName());
    if (rrRevNo_(s.getName()) !== maxRev[b]) return false;   // ไม่ใช่เวอร์ชันล่าสุด → ทิ้ง
    if (taken[b]) return false;                              // กันชื่อซ้ำเป๊ะ
    taken[b] = true; return true;
  });
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

// ใส่ ID ไฟล์ Pax Manpower ถ้าบัญชีที่รันมีสิทธิ์เข้า (เว้นว่าง = ข้าม ไม่แสดงจำนวนพนักงานรวม)
// ของเดิม: '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8'
var MASTER_FILE_ID_RB = '';
var DEPT_PSA_TH = 'การโดยสาร';
var DEPT_LL_TH  = 'ติดตามสัมภาระ';

function readMasterHeadcount(masterFileId) {
  try {
    var ss = SpreadsheetApp.openById(masterFileId || MASTER_FILE_ID_RB);
    var ws = ss.getSheetByName('Total');
    if (!ws) { Logger.log('⚠️ Master: ไม่พบชีต "Total" → ข้าม'); return null; }
    var data = ws.getDataRange().getValues();

    var hc = { PSA: { total: 0, byPos: {} }, LL: { total: 0, byPos: {} }, active: 0 };
    var now = new Date();

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var idStr = String(row[1] == null ? '' : row[1]).replace(/\.0*$/, '').trim();
      if (!/^\d{6,8}$/.test(idStr.replace(/\D/g, ''))) continue;

      var status = String(row[13] || '').trim();
      if (status === 'Resigned') continue;
      if (status !== 'Active') {
        var rd = row[12];
        if (rd instanceof Date && rd < now) continue;        // already left
      }

      var dept = String(row[6] || '');
      var deptKey = dept.indexOf(DEPT_PSA_TH) >= 0 ? 'PSA' : (dept.indexOf(DEPT_LL_TH) >= 0 ? 'LL' : null);
      if (!deptKey) continue;

      var team = String(row[2] || '');
      var grp = (deptKey === 'LL') ? rrLLPosGroup_(row[7]) : rrPosGroup_(row[7], team);
      hc[deptKey].total++;
      hc[deptKey].byPos[grp] = (hc[deptKey].byPos[grp] || 0) + 1;
      hc.active++;
    }
    return hc;
  } catch (e) {
    Logger.log('⚠️ Master: เข้าไฟล์ไม่ได้ (' + e.message + ') → ข้าม (รายงานยังออกได้)');
    return null;
  }
}

function debugDumpMaster(masterFileId) {
  var hc = readMasterHeadcount(masterFileId);
  Logger.log('Active: %s  |  PSA %s  LL %s  รวม %s',
    hc.active, hc.PSA.total, hc.LL.total, hc.PSA.total + hc.LL.total);
  Logger.log('PSA byPos: %s', JSON.stringify(hc.PSA.byPos));
  Logger.log('LL  byPos: %s', JSON.stringify(hc.LL.byPos));
  return hc;
}

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

// ── Airline SLA: timing offsets (รอบ STD) + required headcount per role/phase ──
// roles: [name, count, code, phase]  · phase = ALL(SUP) / CI / ARR / GATE
// ci/cc = check-in open/close (นาที รอบ STD) · go = gate · brief/post = ก่อน/หลัง
var SLA_DB = {
  'SQ': {ci:-240,cc:-40,go:-75,lc:-45,brief:60,post:30,total:13,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'SOD/FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',4,'CT/G','CI'],['GATE AGENT',2,'GATE','GATE'],['BOARDING',4,'B','GATE']]},
  'CX': {ci:-240,cc:-60,go:-60,lc:-45,brief:60,post:30,total:15,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'SOD/FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',5,'CT/G','CI'],['GATE AGENT',2,'GATE','GATE'],['BOARDING',5,'B','GATE']]},
  'LY': {ci:-240,cc:-60,go:-75,lc:-45,brief:60,post:30,total:13,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',7,'CT','CI'],['GATE AGENT',1,'GATE','GATE'],['BOARDING',3,'B','GATE']]},
  'QR': {ci:-240,cc:-45,go:-75,lc:-45,brief:60,post:30,total:20,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CONTROLLER',1,'FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',10,'CT/G','CI'],['ARRIVAL',3,'ARR/G','ARR'],['GATE/MONITOR',4,'GM/PFD','GATE']]},
  'MH': {ci:-240,cc:-60,go:-75,lc:-45,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN GK',1,'CT1/GK','CI'],['CHECK-IN',3,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/BIR',2,'G/BIR','GATE'],['GATE/MAAS',1,'G/MAAS','GATE']]},
  'DE': {ci:-240,cc:-45,go:-75,lc:-45,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE/MONITOR',4,'GM/PFD','GATE']]},
  'PG': {ci:-45,cc:-15,go:-45,lc:-15,brief:60,post:20,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['GATE MONITOR',2,'GM','GATE'],['GATE INT',1,'GM(INT)','GATE'],
           ['DEPARTURE',1,'D','GATE'],['GATE AGENT',3,'G','GATE'],['ARRIVAL',2,'ARR','ARR']]},
  'AK': {ci:-180,cc:-60,go:-50,lc:-10,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SPVR G','ALL'],['FLIGHT CTRL',1,'CF/C','CI'],['CHECK-IN',2,'C','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/FLIGHT',1,'GC/F','GATE'],['GATE',2,'G','GATE']]},
  'QZ': {ci:-180,cc:-60,go:-50,lc:-10,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SPVR G','ALL'],['FLIGHT CTRL',1,'CF/C','CI'],['CHECK-IN',2,'C','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/FLIGHT',1,'GC/F','GATE'],['GATE',2,'G','GATE']]},
  'SU': {ci:-180,cc:-40,go:-60,lc:-40,brief:60,post:30,total:23,
    roles:[['SUPERVISOR',1,'SOD/CF','ALL'],['GATE MONITOR',1,'GM','GATE'],
           ['CHECK-IN',16,'CHECK-IN','CI'],['ARRIVAL',1,'ARR/G','ARR'],['GATE AGENT',4,'GATE AGENT','GATE']]},
  'B2': {ci:-180,cc:-40,go:-60,brief:60,post:30,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CI','CI']]},
  'W5': {ci:-180,cc:-40,go:-60,brief:60,post:30,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CI','CI']]},
  '3U': {ci:-180,cc:-60,go:-60,lc:-30,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/GK','CI'],['CHECK-IN',3,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/SOD',1,'SOD G','GATE'],['GATE',4,'GATE','GATE']]},
  'CA': {ci:-180,cc:-50,go:-60,lc:-30,brief:60,post:30,total:12,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/GK','CI'],['CHECK-IN',5,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',2,'GM','GATE'],['GATE',2,'GATE','GATE']]},
  'MU': {ci:-180,cc:-50,go:-60,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'CZ': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'FM': {ci:-180,cc:-50,go:-60,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'HO': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'GM','GATE']]},
  'HU': {ci:-180,cc:-50,go:-60,brief:60,post:30,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'AQ': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GM','GATE']]},
  'HX': {ci:-240,cc:-50,go:-60,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'EY': {ci:-180,cc:-60,go:-60,lc:-45,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/CTR','CI'],['SOD/CTR',1,'SOD/CTR','CI'],
           ['J-CLASS',2,'J','CI'],['BOARDING',5,'B','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'AY': {ci:-180,cc:-60,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'DV': {ci:-180,cc:-60,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'KE': {ci:-240,cc:-45,go:-60,lc:-45,brief:60,post:30,total:8,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['ASST GC',1,'ASST GC','CI'],
           ['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'KC': {ci:-240,cc:-45,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CI GK',1,'FC/C1','CI'],['CHECK-IN',5,'C','CI'],
           ['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'OZ': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'NO': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'AF': {ci:-240,cc:-45,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',5,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',2,'ARR','ARR']]},
  'LJ': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'OV': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'WY': {ci:-180,cc:-60,go:-45,lc:-30,brief:60,post:20,total:15,
    roles:[['SUPERVISOR 1',1,'SPVR/FC','ALL'],['SUPERVISOR 2',1,'SM','ALL'],
           ['CHECK-IN',6,'C','CI'],['ARRIVAL',1,'RF','ARR'],['GATE',6,'GATE','GATE']]},
  'G9': {ci:-180,cc:-60,go:-45,brief:60,post:20,total:6,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'DK': {ci:-180,cc:-60,go:-45,brief:60,post:20,total:6,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['ARRIVAL',1,'ARR','ARR']]},
  '9C': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',1,'GATE','GATE']]},
  'EK': {ci:-240,cc:-60,go:-60,lc:-45,brief:60,post:30,total:16,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['FLIGHT CTRL',1,'FC','CI'],['SOD/DOCUMENT',1,'SOD','CI'],
           ['CHECK-IN GK',1,'CT/GK','CI'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',4,'ARR','ARR'],
           ['GATE/BIR',2,'GK/BIR','GATE'],['GATE/MAAS',1,'GM/MAAS','GATE'],
           ['CREW ASSIGN',1,'CREW','GATE'],['CF',1,'CF','GATE']]},
  'UO': {ci:-180,cc:-45,go:-60,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'FY': {ci:-144,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  '6B': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'BY': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'AI': {ci:-180,cc:-45,go:-70,lc:-45,brief:60,post:20,total:12,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FC/CTR-BC',2,'FC/CT-BC','CI'],['SOD',1,'SOD','CI'],
           ['ARRIVAL',2,'ARR','ARR'],['FC/PFD',1,'FC/PFD','GATE'],['GATE',4,'G','GATE']]},
  'IX': {ci:-180,cc:-45,go:-60,brief:60,post:20,total:5,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD',1,'SOD','CI'],['CI GK',1,'CT/GK','CI'],['CHECK-IN',2,'CT/G','CI']]},
  'JQ': {ci:-180,cc:-60,go:-90,lc:-45,brief:60,post:20,total:15,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD/GTE',1,'SOD*GTE','CI'],['SOD/CTR',1,'SOD*CTR','CI'],
           ['FC/CTR-BC',2,'FC/CT-BC','CI'],['SD',1,'SD','CI'],['FC/PFD',1,'FC/PFD','GATE'],
           ['ARRIVAL',3,'ARR','ARR'],['GATE',5,'G','GATE']]},
  'IT': {ci:-180,cc:-45,go:-60,lc:-30,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD',1,'SOD','CI'],['CHECK-IN GK',1,'CT/GK','CI'],
           ['CHECK-IN',2,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'N0': {ci:-180,cc:-45,go:-60,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'G','GATE']]},
  'TK': {ci:-180,cc:-60,go:-60,lc:-45,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD',1,'SOD','CI'],['GATE MONITOR',1,'GM','GATE'],
           ['FLIGHT CTRL',1,'FC','CI'],['CREW SIGN',1,'CS','ALL'],['ARRIVAL',2,'ARR','ARR'],
           ['BOGO',1,'BOGO','GATE'],['Y-CLASS',2,'Y','GATE'],['CHECK-IN',1,'PSM','CI']]},
  'VJ': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:5,
    roles:[['SOD',1,'SOD','ALL'],['GATE MONITOR',1,'GM','GATE'],['FLIGHT CTRL',1,'FC','CI'],
           ['CREW SIGN',1,'CS','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'OD': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:5,
    roles:[['SOD',1,'SOD','ALL'],['GATE MONITOR',1,'GM','GATE'],['FLIGHT CTRL',1,'FC','CI'],
           ['ARRIVAL',1,'ARR','ARR']]},
  'SG': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'G','GATE']]},
  'HY': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'G','GATE']]},
  'TR': {ci:-150,cc:-60,go:-45,lc:-30,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['SOD',1,'SOD','CI'],
           ['CHECK-IN GK',1,'CT/GK','CI'],['CHECK-IN',2,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  '6E': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'QP': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'SV': {ci:-240,cc:-45,go:-45,brief:60,post:30,total:14,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['MONITOR',1,'MONITOR','ALL'],
           ['CHECK-IN',7,'C','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'G','GATE']]},
  'WK': {ci:-198,cc:-45,go:-45,brief:60,post:30,total:14,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['MONITOR',1,'MONITOR','ALL'],
           ['CHECK-IN',7,'C','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'G','GATE']]},
  'KA': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',5,'C','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'G','GATE']]},
  'ZF': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/GK','CI'],['CHECK-IN',4,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'HH': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'LO': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'EO': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'S7': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'PRIVATE': {ci:-60,cc:-20,go:-20,brief:20,post:20,total:3,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',1,'CT/G','CI'],['GATE',1,'GATE','GATE']]},
  'CHARTER': {ci:-120,cc:-30,go:-30,brief:30,post:20,total:5,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',2,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',1,'GATE','GATE']]},
  'DEFAULT': {ci:-180,cc:-45,go:-45,lc:-30,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]}
};
var SLA_ALIAS = { '8M':'QZ','VN':'HY','3K':'JQ','HB':'HX','WZ':'ZF','N4':'EO','C6':'LO','G2':'LO','H4':'LO',
  'ZH':'CA','PN':'CA','OQ':'CA','GX':'CA','KX':'CA','8H':'CA','9H':'CA','BK':'CA','PVT':'PRIVATE' };

// ── จำนวนคนที่ต้องการต่อสายการบิน [SUP, CI, ARR, GATE(controller), TTL] ──────
// จาก Manpower Meeting (ตัดชนิดเครื่องบินออก = ใช้แถวลำใหญ่สุด) · TTL = จำนวนคนจริง
// · gate agent มาจาก check-in (ไม่นับซ้ำใน per-phase) · total ใช้ TTL
var SLA_RQ = {
  'KE':[1,8,1,1,12],'LJ':[1,4,1,1,7],'OV':[1,4,1,1,7],'KC':[1,5,1,1,8],'AK':[1,3,1,1,7],'8M':[1,3,1,1,7],
  '6E':[1,5,1,1,12],'TR':[1,6,1,1,9],'3K':[1,4,1,1,7],'CA':[1,6,1,1,10],'MU':[1,4,1,1,8],'CZ':[1,6,1,1,10],
  'OQ':[1,4,1,1,8],'HU':[1,6,1,1,10],'FM':[1,4,1,1,8],'3U':[1,4,1,1,8],'KY':[1,4,1,1,7],'AQ':[1,3,1,1,7],
  'PG':[1,0,1,2,8],'QR':[1,11,2,1,21],'MH':[1,4,1,1,6],'OM':[1,4,1,1,6],'SU':[1,8,1,1,12],'W5':[1,7,1,1,10],
  'WK':[1,6,1,1,10],'SQ':[1,5,1,1,7],'CX':[1,6,2,1,10],'LY':[1,8,1,1,12],'WY':[2,7,1,1,12],'9C':[1,5,1,1,8],
  'DK':[1,7,1,1,10],'JQ':[1,7,1,1,12],'IT':[1,4,1,1,8],'HO':[1,4,1,1,8],'EY':[1,9,1,1,13],'DV':[1,4,1,1,8],
  'AY':[1,5,1,1,9],'TK':[1,8,4,1,12],'VJ':[1,5,1,1,9],'OD':[1,5,1,1,9],'ZF':[1,6,1,1,10],'HH':[1,4,1,1,8],
  'EO':[1,6,1,1,10],'N4':[1,6,1,1,10],'WZ':[1,6,1,1,10],'LO':[1,6,1,1,10],'HX':[1,5,1,1,9],'G2':[1,6,1,1,10],
  'EK':[1,7,3,1,12],'UO':[1,4,2,1,8],'6B':[1,5,2,1,8],'BY':[1,5,2,1,8],'FY':[1,4,1,1,7],'AI':[1,6,1,1,10],
  'G9':[1,4,1,1,8],'ZH':[1,4,1,1,8],'HY':[1,5,1,1,9],'NO':[1,6,1,1,10],'SG':[1,4,1,1,8],'U6':[1,4,1,1,8],
  'G8':[1,4,1,1,8],'OZ':[1,6,1,1,9],'S7':[1,4,1,1,8],'PN':[1,4,1,1,8],'8L':[1,4,1,1,8],'9H':[1,4,1,1,8],
  'DE':[1,6,2,1,9],'AF':[1,9,1,1,11],'N0':[1,5,1,1,11],'C6':[1,4,1,1,8],'QZ':[1,3,1,1,7],
};

// ── Airline → check-in SYSTEM (ตารางทางการ) ─────────────────────────────────
var AIRLINE_SYS = {
  'AI':'Altea','IX':'Gonow','JQ':'Gonow','IT':'iPort',
  'AK':'Gonow','QZ':'Gonow','8M':'iPort',
  'SQ':'Altea','CX':'Altea','LY':'Altea',
  'HH':'iPort','LO':'iPort','G2':'iPort','H4':'iPort','C6':'iPort',
  'ZF':'Astra','WZ':'Astra','EO':'Lydia DCS','N4':'Lydia DCS','HB':'TravelSky','S7':'TWD',
  'EK':'AS Connect','6B':'iPort','BY':'iPort','FY':'Gonow','UO':'Gonow',
  'QR':'Altea','MH':'Altea','DE':'Altea','OM':'iPort',
  'CA':'TravelSky','3U':'TravelSky','HU':'TravelSky','FM':'TravelSky','MU':'TravelSky','CZ':'TravelSky',
  'HO':'TravelSky','AQ':'TravelSky','ZH':'TravelSky','PN':'TravelSky','OQ':'TravelSky','GX':'TravelSky',
  'KX':'TravelSky','8H':'TravelSky','9H':'TravelSky','BK':'TravelSky','HX':'TravelSky',
  'KE':'Altea','KC':'Altea','AF':'Altea','LJ':'iFlyRes','OV':'iPort','NO':'iPort','OZ':'Altea',
  'TR':'Gonow','6E':'Gonow','QP':'Gonow','3K':'Gonow',
  'WY':'Sabre','G9':'Altea','DK':'Altea','9C':'TravelSky','PG':'Altea',
  'W5':'AVIA','SU':'ASTRA','B2':'ASTRA',
  'TK':'TOYA','HY':'Altea','SG':'Gonow','N0':'Gonow','VJ':'iPort','OD':'Sabre','VN':'Gonow',
  'AY':'Altea','EY':'Altea','DV':'TWD',
  'SV':'Altea','WK':'Altea','KA':'iPort',
};
// iPort = ระบบที่ทุกคนทำได้ (ไฟลท์ iPort ใครว่างก็ช่วยเช็คอินได้)
var SLA_UNIVERSAL_SYS_NORM = 'iport';
function slaSysNorm_(s) { return String(s || '').toLowerCase().replace(/[\s.]+/g, ''); }   // Astra=ASTRA, iPort=iport
function slaSystemOf_(airline) { return AIRLINE_SYS[String(airline || '').toUpperCase()] || ''; }

function slaNeedSys_(airline, ph) {
  if (ph !== 'CI' && ph !== 'SUP') return '';
  var s = slaSystemOf_(airline);
  return (s && slaSysNorm_(s) !== SLA_UNIVERSAL_SYS_NORM) ? s : '';
}

// Official establishment requirement per team (SUP/SNR/PSA) from the AOTGA
// Manpower Meeting file — the FULL roster needed, not the daily on-duty count.
// (Used for HR headcount planning vs the master active headcount, not the daily
// flight SLA above.)
var TEAM_SLA_RQ = {
  'SQ':{SUP:8,SNR:8,PSA:46,total:62}, 'QR':{SUP:8,SNR:8,PSA:92,total:108}, 'PG':{SUP:4,SNR:4,PSA:28,total:36},
  'AK':{SUP:7,SNR:6,PSA:27,total:40}, 'SU':{SUP:10,SNR:10,PSA:44,total:64}, 'KE':{SUP:7,SNR:9,PSA:63,total:79},
  'EY':{SUP:5,SNR:5,PSA:51,total:61}, 'JQ':{SUP:6,SNR:7,PSA:32,total:45}, 'TK':{SUP:6,SNR:7,PSA:30,total:43},
  'TR':{SUP:9,SNR:12,PSA:38,total:59}, 'WY':{SUP:9,SNR:12,PSA:36,total:57}, 'EK':{SUP:7,SNR:7,PSA:39,total:53},
  'WK':{SUP:4,SNR:6,PSA:30,total:40}, 'CHN':{SUP:11,SNR:10,PSA:58,total:79},
};

function slaGet_(airline) {
  var c = String(airline || '').trim().toUpperCase();
  if (SLA_DB[c]) return SLA_DB[c];
  if (SLA_ALIAS[c] && SLA_DB[SLA_ALIAS[c]]) return SLA_DB[SLA_ALIAS[c]];
  return SLA_DB.DEFAULT;
}

function slaIsSupportFlight_(name) { return /SUU?PP?ORT/i.test(String(name || '')); }
function slaAirlineOf_(flight) {
  var s = String(flight || '').trim().toUpperCase();
  var m = s.match(/^([0-9A-Z]{2})\s*\d/);                   // 2-char IATA code (EK, 6E, G9, C6) + flight no.
  if (m) return m[1];
  var m2 = s.match(/([A-Z]{1,3})\s*\d/);
  return m2 ? m2[1] : 'DEFAULT';
}

function slaReq_(airline) {
  var c = String(airline || '').toUpperCase();
  var rq = SLA_RQ[c] || (SLA_ALIAS[c] && SLA_RQ[SLA_ALIAS[c]]);
  if (rq) return { SUP: rq[0], CI: rq[1], ARR: rq[2], GATE: rq[3], total: rq[4] };
  var db = slaGet_(airline);
  var req = { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: db.total || 0 };
  (db.roles || []).forEach(function (r) {
    var ph = r[3] === 'ALL' ? 'SUP' : r[3];
    if (req[ph] === undefined) ph = 'CI';
    req[ph] += r[1];
  });
  return req;
}

function slaPhaseOf_(task) {
  var u = String(task || '').toUpperCase();
  if (!u) return 'CI';
  if (/SUP|SPVR|^SOD|SM\b|MONITOR|CREW|^CS\b|CRW/.test(u)) return 'SUP';
  if (/ARR|MEET|^AC\b|^RF\b|ESCORT|BIR/.test(u)) return 'ARR';
  if (/GATE|^G[\b\/CM-]|^GM|^GC|BOARD|^B\b|BGO|BOCO|MAAS|PFD|GBD|^D\b|DEPART/.test(u)) return 'GATE';
  return 'CI';   // check-in default (CT, C, Y, J, W, F, WEB, KIOSK, PSM, FC, GK, SD...)
}

function slaSkipTeam_(team) {
  var t = String(team || '').toUpperCase();
  return t.indexOf('PORTER') >= 0 || t.indexOf('CREWSIGN') >= 0 || t.indexOf('CREW SIGN') >= 0 ||
         (t.indexOf('ADMIN') >= 0 && t.indexOf('DOC') >= 0);
}

function slaCollectFlights_(res, ll) {
  var flights = {};
  function add(team, rec) {
    (rec.assignments || []).forEach(function (a) {
      var key = String(a.flight || '').trim();
      if (!key) return;
      if (slaIsSupportFlight_(key)) return;                  // SUPPORT/SUUPORT = งานซัพพอร์ต ไม่ใช่ไฟลท์จริง → ข้าม
      if (!flights[key]) {
        flights[key] = { flight: key, airline: slaAirlineOf_(key), teams: {},
          STA: a.STA || '', STD: a.STD || '', OP: a.OP || '', CL: a.CL || '',
          assigned: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 }, staff: [] };
      }
      var f = flights[key];
      f.teams[team] = true;
      if (!f.STA && a.STA) f.STA = a.STA; if (!f.STD && a.STD) f.STD = a.STD;
      if (!f.OP && a.OP) f.OP = a.OP; if (!f.CL && a.CL) f.CL = a.CL;
      var ph = slaPhaseOf_(a.task);
      f.assigned[ph]++; f.assigned.total++;
      f.staff.push({ name: rec.name, pos: rec.pos, team: team, task: a.task, phase: ph });
    });
  }
  Object.keys(res.teams).forEach(function (t) {
    if (slaSkipTeam_(t)) return;                              // ข้าม Porter / Crewsign / Admin Doc
    res.teams[t].records.forEach(function (r) { if (r.bucket === 'working' || r.bucket === 'ot_off') add(t, r); });
  });
  if (ll && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) { if (r.bucket === 'working' || r.bucket === 'ot_off') add('LL·' + s, r); });
    });
  }
  // compute requirement + shortages per flight
  return Object.keys(flights).map(function (k) {
    var f = flights[k];
    f.req = slaReq_(f.airline);
    f.short = {};
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      var d = f.req[ph] - f.assigned[ph];
      if (d > 0) f.short[ph] = d;
    });
    f.shortTotal = Math.max(0, f.req.total - f.assigned.total);
    f.ok = Object.keys(f.short).length === 0 && f.shortTotal === 0;
    f.teamList = Object.keys(f.teams).join(',');
    return f;
  }).sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });
}

var SLA_PH_TH = { SUP: 'SUP', CI: 'Check-in', GATE: 'Gate', ARR: 'Arrival' };
function slaShortText_(f) {
  var parts = [];
  ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) { if (f.short[ph]) parts.push(SLA_PH_TH[ph] + ' ขาด ' + f.short[ph]); });
  return parts.length ? parts.join(' · ') : (f.shortTotal ? ('ขาดรวม ' + f.shortTotal) : '');
}

// ── SUPPORT FINDER: ใครว่าง + รู้ระบบเช็คอิน มาช่วยไฟลท์ที่ขาดได้ ──────────────

function slaTeamSystems_(res, ll) {
  var sys = {};
  function add(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    (r.assignments || []).forEach(function (a) {
      var s = slaSystemOf_(slaAirlineOf_(a.flight));
      if (s) { (sys[team] = sys[team] || {})[slaSysNorm_(s)] = true; }   // เก็บเป็น normalized
    });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { add(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { add('LL·' + s, r); }); });
  return sys;
}

function slaSupportPool_(res, ll, teamSys) {
  var pool = [];
  function add(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    if (slaSkipTeam_(team)) return;                          // Porter / Crewsign / Admin Doc ไม่เป็นคนช่วย
    var d = acDuty_(r);
    if (d.ds == null || d.de == null) return;
    var busy = [];
    (r.assignments || []).forEach(function (a) { var w = acFlightWin_(a); if (w) busy.push(w); });
    var flts = (r.assignments || []).filter(function (a) { return acIsFlight_(a.flight); })
      .map(function (a) {
        var tm = (a.STA || a.STD) ? (' ' + (a.STA || '–') + '-' + (a.STD || '–'))
               : ((a.OP || a.CL) ? (' ' + (a.OP || '–') + '-' + (a.CL || '–')) : '');
        return a.flight + tm;
      });
    pool.push({ name: r.name, id: r.id || '', team: team, pos: r.pos || '', posGroup: r.posGroup || '',
      ds: d.ds, de: d.de, busy: busy, sys: teamSys[team] || {}, nflt: flts.length,
      shiftDisp: r.bucket === 'ot_off' ? 'OFF (มา OT)' : ((r.shiftTime && r.shiftTime !== r.shift) ? (r.shift + ' ' + r.shiftTime) : (r.shift || r.shiftTime || '-')),
      otDisp: r.ot > 0 ? (r.ot + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) + (r.otTime ? ' ' + r.otTime : '')) : '-',
      hrs: Math.round(((r.shiftHrs || 0) + (r.ot || 0)) * 10) / 10, flts: flts });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { add(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { add('LL·' + s, r); }); });
  return pool;
}

function slaPhaseWindow_(f, ph) {
  var db = slaGet_(f.airline);
  var std = acMin_(f.STD), sta = acMin_(f.STA);
  if (ph === 'CI')  return std != null ? [std + db.ci, std + db.cc] : null;
  if (ph === 'GATE')return std != null ? [std + db.go, std + (db.post || 20)] : null;
  if (ph === 'ARR') return sta != null ? [sta - 20, sta + (db.post || 30)] : null;
  if (ph === 'SUP') return std != null ? [std + db.ci, std + (db.post || 30)] : (sta != null ? [sta - 20, sta + 30] : null);
  return null;
}

function slaCandidates_(f, ph, pool, max) {
  var win = slaPhaseWindow_(f, ph);
  var needSys = slaNeedSys_(f.airline, ph);                   // '' = iPort/ไม่จำกัด → ทุกคนช่วยได้
  var needNorm = needSys ? slaSysNorm_(needSys) : '';
  var cands = pool.filter(function (p) {
    if (f.teams[p.team]) return false;                       // คนทีมเดียวกับไฟลท์ ไม่นับเป็น support
    if (needNorm && !p.sys[needNorm]) return false;          // CI/SUP ต้องรู้ระบบสายการบินนั้น (ยกเว้น iPort)
    if (ph === 'SUP' && p.posGroup !== 'PSS') return false;  // Sup/Flight Controller ต้องเป็น Sup
    if (win) {
      if (!(p.ds <= win[0] + 30 && p.de >= win[1] - 30)) return false;   // เวลางานครอบช่วงนั้น
      for (var i = 0; i < p.busy.length; i++) {              // ต้องไม่ติดไฟลท์อื่นช่วงนั้น
        var b = p.busy[i];
        if (win[0] < b[1] - 10 && win[1] > b[0] + 10) return false;
      }
    }
    return true;
  });
  if (ph === 'SUP') {
    cands.sort(function (a, b) { return a.nflt - b.nflt || String(a.team).localeCompare(b.team); });
  } else {
    // CI / GATE / ARR: Agent → Senior → Sup ตามลำดับ แล้วคนงานน้อย/ว่างกว่าก่อน
    var PRI = { PSA: 0, SNR: 1, PSS: 2 };
    cands.sort(function (a, b) {
      return (PRI[a.posGroup] == null ? 3 : PRI[a.posGroup]) - (PRI[b.posGroup] == null ? 3 : PRI[b.posGroup]) || a.nflt - b.nflt;
    });
  }
  return max ? cands.slice(0, max) : cands;
}
function slaWinTxt_(f, ph) {
  var w = slaPhaseWindow_(f, ph);
  return w ? (rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440)) : '';
}

function rbWriteFlightSLA_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '✈️ Flights & SLA';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);

  var flights = slaCollectFlights_(res, ll);
  var W = 13;
  sh.getRange(1, 1, 1, W).merge().setValue('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน — ' + dateStr)
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  var head = ['Flight', 'สายการบิน', 'ทีม', 'STA', 'STD', 'OP', 'CL', 'ส่งไป(คน)', 'SLA ต้องการ', 'SUP', 'Check-in', 'Gate', 'Arrival'];
  sh.getRange(2, 1, 1, W).setValues([head]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  var body = [], status = [];
  flights.forEach(function (f) {
    function cell(ph) { return f.assigned[ph] + '/' + f.req[ph] + (f.short[ph] ? ' ⚠️-' + f.short[ph] : ' ✓'); }
    body.push([f.flight, f.airline, f.teamList, f.STA, f.STD, f.OP, f.CL,
               f.assigned.total, f.req.total, cell('SUP'), cell('CI'), cell('GATE'), cell('ARR')]);
    status.push(f.ok);
  });
  if (body.length) {
    sh.getRange(3, 1, body.length, W).setValues(body).setFontSize(9).setVerticalAlignment('middle');
    for (var i = 0; i < body.length; i++) {
      var bg = status[i] ? '#e8f5e9' : '#fff3cd';
      sh.getRange(3 + i, 1, 1, W).setBackground(i % 2 ? bg : bg);
      if (!status[i]) sh.getRange(3 + i, 1, 1, W).setBackground('#fde8e8');
    }
  }
  [110, 75, 90, 55, 55, 55, 55, 70, 80, 70, 80, 70, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
  return flights;
}

var SLA_MAX_CAND = 24;     // pool คนช่วยต่อ 1 ตำแหน่งที่ขาด (มีเผื่อไว้ดึงทดแทนข้ามทีม)
var SLA_PH_LB = { SUP: 'SUP', CI: 'Check-in', GATE: 'Gate', ARR: 'Arrival' };
function slaPosShort_(g) { return g === 'PSS' ? 'Sup' : (g === 'SNR' ? 'Snr' : (g === 'PSA' ? 'Agent' : (g || '-'))); }

function slaSupportRows_(res, ll) {
  var flights = slaCollectFlights_(res, ll).filter(function (f) { return !f.ok; });
  var teamSys = slaTeamSystems_(res, ll);
  var pool = slaSupportPool_(res, ll, teamSys);
  var rows = [];
  flights.forEach(function (f) {
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      if (!f.short[ph]) return;
      var cands = slaCandidates_(f, ph, pool, SLA_MAX_CAND);
      rows.push({
        flight: f.flight, airline: f.airline, system: slaSystemOf_(f.airline), team: f.teamList,
        STD: f.STD || f.STA || '', phase: SLA_PH_LB[ph], shortN: f.short[ph], win: slaWinTxt_(f, ph),
        needSys: slaNeedSys_(f.airline, ph),
        cands: cands.map(function (c) {
          return { name: c.name, pos: slaPosShort_(c.posGroup), team: c.team,
                   shift: c.shiftDisp, ot: c.otDisp, hrs: c.hrs, n: c.nflt, flts: c.flts };
        }),
        nCand: cands.length,
      });
    });
  });
  return rows;
}

function slaGroupCands_(cands) {
  var by = {}, order = [];
  cands.forEach(function (c) { if (!by[c.team]) { by[c.team] = []; order.push(c.team); } by[c.team].push(c); });
  return order.map(function (t) { return { team: t, people: by[t] }; });
}

function rbWriteSupport_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🆘 Support';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var rows = slaSupportRows_(res, ll);
  var W = 8;

  sh.getRange(1, 1, 1, W).merge().setValue('🆘 ไฟลท์ที่คนไม่ครบ + คนที่มาช่วยได้ (ว่าง & รู้ระบบเช็คอิน) — ' + dateStr)
    .setBackground('#b71c1c').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  sh.getRange(2, 1, 1, W).setValues([['Flight', 'สายการบิน', 'ระบบเช็คอิน', 'ทีม', 'STD', 'ตำแหน่งที่ขาด', 'ช่วงเวลา', 'คนที่มาช่วยได้ (ว่าง + ระบบตรง)']])
    .setBackground('#d32f2f').setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center');
  if (!rows.length) {
    sh.getRange(3, 1, 1, W).merge().setValue('✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA').setBackground('#e8f5e9')
      .setFontWeight('bold').setFontColor('#1b5e20').setHorizontalAlignment('center');
  } else {
    var body = rows.map(function (r) {
      var who = r.cands.length
        ? slaGroupCands_(r.cands).map(function (g) {
            return '[' + g.team + '] ' + g.people.map(function (p) { return p.name + '(' + p.pos + ')'; }).join(', ');
          }).join('   ·   ')
        : (r.needSys ? '— ไม่มีคนว่างที่รู้ระบบ ' + r.needSys : '— ไม่มีคนว่าง');
      return [r.flight, r.airline, r.system || '-', r.team, r.STD,
              r.phase + ' ขาด ' + r.shortN + (r.needSys ? ' (ต้องใช้ ' + r.needSys + ')' : ''), r.win, who];
    });
    sh.getRange(3, 1, body.length, W).setValues(body).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (var i = 0; i < rows.length; i++) {
      sh.getRange(3 + i, 1, 1, W).setBackground(rows[i].nCand ? '#fff8e1' : '#fdecec');
    }
  }
  [95, 70, 95, 90, 55, 150, 95, 360].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
}

var AC_COVER_TOL = 60;   // ผ่อนให้ "มาทันเคาน์เตอร์เปิด" = ครอบคลุม (บรีฟ 60 นาทีเป็นช่วงเตรียม)
var AC_GAP_MIN   = 180;
var AC_EDGE_MIN  = 240;

function acMin_(s) {
  var m = String(s == null ? '' : s).match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1] * 60 + +m[2]) : null;
}

function acIsFlight_(name) {
  var s = String(name || '').trim().toUpperCase();
  if (!s) return false;
  if (/^(COUNTER|GATE|CHECK|ZONE|BELT|PIER|STBY|STAND|POOL|OFFICE|BRIEF|NIL|OFF\b|LP\s+(MORNING|AFTERNOON|NIGHT|DAY))/.test(s)) return false;
  return /[A-Z]{1,3}\s*\d{2,4}/.test(s);
}

function acFlightWin_(a) {
  function m(x) { var v = acMin_(x); return v ? v : null; }   // 00:00 = placeholder → null
  var sta = m(a.STA), op = m(a.OP), cl = m(a.CL), std = m(a.STD);
  var db = (typeof slaGet_ === 'function') ? slaGet_(slaAirlineOf_(a.flight)) : null;
  var brief = (db && db.brief) || 60, ci = (db && db.ci) || -180, post = (db && db.post) || 30;
  var lo = null, hi = std;                                    // hi = STD
  var ciOpen = (op != null) ? op : (std != null ? std + ci : null);   // เวลาเปิดเคาน์เตอร์
  if (ciOpen != null) lo = ciOpen - brief;                    // เวลาบรีฟ
  if (hi == null && sta != null) { lo = sta - brief; hi = sta + post; }   // ขาเข้าล้วน → รอบ STA
  if (lo == null || hi == null) {                             // fallback: min-max ของเวลาที่มี
    var ts = [sta, op, cl, std].filter(function (x) { return x; });
    if (!ts.length) return null;
    lo = Math.min.apply(null, ts) - brief; hi = Math.max.apply(null, ts);
  }
  if (hi <= lo) hi += 1440;                                   // ข้ามเที่ยงคืน
  return [lo, hi];
}

function acDuty_(r) {
  var sr = rrRangeStr_(r.shiftTime || '');
  var ss = sr[0], se = sr[1];
  if (ss != null && se != null && se <= ss) se += 1440;
  if (ss == null && r.shiftStart != null && r.shiftHrs) {
    ss = r.shiftStart; se = ss + Math.round(r.shiftHrs * 60);
  }
  var orr = rrRangeStr_(r.otTime || '');
  var oi = orr[0], oo = orr[1];
  if (oi != null && oo != null && oo <= oi) oo += 1440;

  var ds = ss, de = se;
  if (r.bucket === 'ot_off') {
    // OT OFF = วันหยุดมาทำ OT — เวลางานจริง = ช่วง OT เท่านั้น (ไม่ใช่กะปกติที่ค้างอยู่)
    ds = oi; de = oo;
  } else if (oi != null) {
    if (ss != null) { while (oi < ss - 720) { oi += 1440; oo += 1440; } }  // จัด OT ให้อยู่ใกล้กะ
    ds = (ds == null) ? oi : Math.min(ds, oi);
    de = (de == null) ? oo : Math.max(de, oo);
  } else if (r.ot > 0 && ss != null) {
    if (r.otType === 'PRE') ds = ss - Math.round(r.ot * 60);
    else de = se + Math.round(r.ot * 60);
  }
  return { ss: ss, se: se, ds: ds, de: de };
}

function acAnalyzeRecord_(r) {
  var d = acDuty_(r);
  // เชื่อถือได้เมื่อมีเวลากะจริง (ss) หรือเป็น OT OFF (ทำเฉพาะ OT วันหยุด).
  // ถ้าเป็นคนทำงานแต่กะเป็นรหัสไม่มีเวลา (เช่น NN0 กะดึก) → อย่าเอาช่วง OT มาตัดสิน coverage
  var reliable = (d.ss != null) || (r.bucket === 'ot_off' && d.ds != null);
  var out = {
    hasWindow: reliable && d.ds != null && d.de != null,
    shiftStr: r.bucket === 'ot_off' ? 'OFF' : ((d.ss != null && d.se != null) ? (rrFmtMin_(d.ss) + '–' + rrFmtMin_(d.se)) : (r.shift || '-')),
    dutyStr: '', dutyMins: 0, ss: d.ss, se: d.se, ds: d.ds, de: d.de,
    flightN: 0, coveredN: 0, uncovered: [], gaps: [], wins: [],
    otVerdict: '', issues: [], status: 'ok',
  };
  if (out.hasWindow) {
    out.dutyStr = rrFmtMin_(d.ds) + '–' + rrFmtMin_(d.de);
    out.dutyMins = d.de - d.ds;
  }

  // หน้าต่างไฟลท์ (เฉพาะที่มีเวลา) — รอบแรกเก็บ window
  (r.assignments || []).forEach(function (a) {
    if (!a || !a.flight) return;
    var w = acFlightWin_(a);
    if (!w) return;                                          // ไฟลท์ไม่มีเวลา → ข้ามการเช็คครอบคลุม
    var lo = w[0], hi = w[1];
    if (d.ds != null && lo < d.ds - 720) { lo += 1440; hi += 1440; }
    out.wins.push({ flight: a.flight, lo: lo, hi: hi, coverable: acIsFlight_(a.flight) });
  });

  // OT OFF: เวลางาน = ครอบช่วง OT + ไฟลท์ที่ได้รับทั้งหมด (มาช่วยวันหยุด ทำเฉพาะที่ได้รับมอบหมาย)
  if (r.bucket === 'ot_off' && out.wins.length) {
    out.wins.forEach(function (w) {
      if (d.ds == null || w.lo < d.ds) d.ds = w.lo;
      if (d.de == null || w.hi > d.de) d.de = w.hi;
    });
    out.ds = d.ds; out.de = d.de; out.hasWindow = d.ds != null && d.de != null;
    if (out.hasWindow) { out.dutyStr = rrFmtMin_(d.ds) + '–' + rrFmtMin_(d.de); out.dutyMins = d.de - d.ds; }
  }

  // ครอบคลุมไฟลท์
  out.wins.forEach(function (w) {
    if (!w.coverable) return;
    out.flightN++;
    if (d.ds != null && d.de != null) {
      if (w.lo >= d.ds - AC_COVER_TOL && w.hi <= d.de + AC_COVER_TOL) out.coveredN++;
      else out.uncovered.push(w.flight + ' (' + rrFmtMin_(w.lo) + '–' + rrFmtMin_(w.hi) + ')');
    }
  });

  // ช่วงว่าง (gap) ภายในเวลางาน — union ของหน้าต่างไฟลท์ (แยก edge/internal)
  if (out.hasWindow && out.wins.length) {
    var iv = out.wins.map(function (w) { return [Math.max(w.lo, d.ds), Math.min(w.hi, d.de)]; })
      .filter(function (w) { return w[1] > w[0]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    iv.forEach(function (w) {
      var last = merged[merged.length - 1];
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
      else merged.push([w[0], w[1]]);
    });
    if (merged.length) {
      if (merged[0][0] - d.ds >= AC_EDGE_MIN) out.gaps.push({ a: d.ds, b: merged[0][0], kind: 'edge' });
      for (var gi = 0; gi < merged.length - 1; gi++) {
        if (merged[gi + 1][0] - merged[gi][1] >= AC_GAP_MIN) out.gaps.push({ a: merged[gi][1], b: merged[gi + 1][0], kind: 'mid' });
      }
      if (d.de - merged[merged.length - 1][1] >= AC_EDGE_MIN) out.gaps.push({ a: merged[merged.length - 1][1], b: d.de, kind: 'edge' });
    }
  }

  // สรุปคำตัดสิน OT + ปัญหา
  if (out.uncovered.length) {
    out.status = 'bad';
    out.issues.push('ไฟลท์นอกเวลางาน: ' + out.uncovered.join(', '));
    out.otVerdict = r.ot > 0 ? '🔴 OT ไม่พอครอบคลุมไฟลท์' : '🔴 ควรให้ OT/Re-Sked';
  } else if (r.ot > 0 && r.bucket !== 'ot_off') {
    // OT เกินจำเป็นไหม — ตรวจว่ามีไฟลท์เลยขอบกะจริงหรือไม่
    var justified = out.flightN === 0;                      // ไม่มีไฟลท์ → ตัดสินไม่ได้ ถือว่าผ่าน (อาจเป็นงาน support)
    out.wins.forEach(function (w) {
      if (r.otType === 'PRE'  && d.ss != null && w.lo <  d.ss - AC_COVER_TOL) justified = true;
      if (r.otType !== 'PRE'  && d.se != null && w.hi >  d.se + AC_COVER_TOL) justified = true;
    });
    if (!justified && out.flightN > 0) {
      out.status = 'warn';
      out.otVerdict = '🟡 OT อาจเกินจำเป็น (ไฟลท์อยู่ในเวลากะ)';
      out.issues.push(out.otVerdict);
    } else {
      out.otVerdict = '🟢 OT เหมาะสม';
    }
  } else if (r.bucket === 'ot_off') {
    out.otVerdict = '🟢 OT OFF (เข้าช่วยวันหยุด)';
  }

  // ช่วงว่างยาว
  if (out.gaps.length) {
    if (out.status === 'ok') out.status = 'warn';
    out.issues.push('ช่วงว่าง ' + out.gaps.map(function (g) {
      return rrFmtMin_(g.a) + '–' + rrFmtMin_(g.b) + ' (' + Math.round((g.b - g.a) / 6) / 10 + 'h' +
             (g.kind === 'mid' ? ' ระหว่างไฟลท์' : '') + ')';
    }).join(', '));
  }

  // ไม่มีไฟลท์เลย = นับเป็นข้อมูล (bench/standby/support) ไม่ flag เป็นปัญหา เพื่อไม่ให้ตารางรก
  out.noFlight = (out.flightN === 0 && out.wins.length === 0 && r.bucket === 'working');  // มีงานเคาน์เตอร์ (wins) = ไม่ใช่ว่าง
  return out;
}

function acOwnerTeams_(res, ll) {
  var cnt = {};
  function tally(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    if (slaSkipTeam_(team)) return;          // Porter/Crewsign/Admin Doc ไม่นับเป็นเจ้าของสายการบิน
    (r.assignments || []).forEach(function (a) {
      if (!acIsFlight_(a.flight)) return;
      var al = slaAirlineOf_(a.flight);
      (cnt[al] = cnt[al] || {})[team] = (cnt[al][team] || 0) + 1;
    });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { tally(t, r); }); });
  if (ll && ll.totals && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { tally('LL·' + s, r); }); });
  var owner = {};
  Object.keys(cnt).forEach(function (al) {
    var best = '', bn = -1;
    Object.keys(cnt[al]).forEach(function (t) { if (cnt[al][t] > bn) { bn = cnt[al][t]; best = t; } });
    owner[al] = best;
  });
  return owner;
}

function acAnalyze_(res, ll) {
  var rows = [];
  var owner = acOwnerTeams_(res, ll);
  var sum = { working: 0, checked: 0, bad: 0, warn: 0, otMuch: 0, gap: 0, noFlt: 0, noWin: 0, support: 0 };

  function consider(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    sum.working++;
    var a = acAnalyzeRecord_(r);
    if (!a.hasWindow) { sum.noWin++; return; }              // ไม่มีเวลากะระบุ → ตรวจครอบคลุมไม่ได้
    sum.checked++;
    // ไฟลท์ที่ทำ + ตั้ง flag ไฟลท์ "ซัพพอร์ตข้ามทีม" (สายการบินที่ทีมอื่นเป็นเจ้าของ)
    var nSupport = 0, skipT = slaSkipTeam_(team);
    var jobList = (r.assignments || []).filter(function (x) { return x.flight; })   // รวมเคาน์เตอร์/งานของ SU ด้วย
      .map(function (x) {
        var w = acFlightWin_(x);                          // ช่วงเวลา cover (บรีฟ→STD / เคาน์เตอร์)
        var tm = w ? ' ' + rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '–' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440) : ' (ไม่มีเวลา)';
        var jb = x.task ? ' [' + String(x.task).replace(/\s+/g, ' ').trim() + ']' : '';   // งาน/ตำแหน่งในไฟลท์นั้น
        var ow = acIsFlight_(x.flight) ? owner[slaAirlineOf_(x.flight)] : '';
        var sup = (!skipT && ow && ow !== team) ? ' ซัพพอร์ต' : '';
        if (sup) nSupport++;
        return x.flight + jb + tm + sup;
      });
    if (nSupport) sum.support++;
    if (a.status === 'bad') sum.bad++;
    if (a.status === 'warn') sum.warn++;
    if (a.otVerdict.indexOf('เกินจำเป็น') >= 0) sum.otMuch++;
    if (a.gaps.length) sum.gap++;
    if (a.noFlight) sum.noFlt++;
    if (a.status === 'bad' || a.status === 'warn') {
      rows.push({
        team: team, id: r.id || '', pos: r.pos || r.posGroup || '', name: r.name || '',
        job: jobList.join(', '),
        support: nSupport,
        shift: a.shiftStr, duty: a.dutyStr,
        ot: r.ot > 0 ? (r.ot + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) +
                        (r.otTime ? ' ' + r.otTime : '')) : '-',
        flights: a.flightN ? (a.coveredN + '/' + a.flightN + ' ครอบคลุม') : (a.wins.length ? a.wins.length + ' เคาน์เตอร์/งาน' : 'ไม่มี'),
        uncovered: a.uncovered.join('; '),
        gaps: a.gaps.map(function (g) { return rrFmtMin_(g.a) + '–' + rrFmtMin_(g.b); }).join(', '),
        otVerdict: a.otVerdict,
        issue: a.issues.join(' · '),
        status: a.status,
      });
    }
  }

  Object.keys(res.teams).forEach(function (t) {
    res.teams[t].records.forEach(function (r) { consider(t, r); });
  });
  if (ll && ll.totals && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) { consider('LL·' + s, r); });
    });
  }

  var order = { bad: 0, warn: 1 };
  rows.sort(function (x, y) {
    if (order[x.status] !== order[y.status]) return order[x.status] - order[y.status];
    return String(x.team).localeCompare(String(y.team));
  });
  return { rows: rows, summary: sum };
}

// ─── รายงานแท็บ "🧭 ตรวจ Assign" ────────────────────────────────────────────
function rbWriteAssignCheck_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🧭 ตรวจ Assign';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var an = acAnalyze_(res, ll);
  var W = 13;

  sh.getRange(1, 1, 1, W).merge()
    .setValue('🧭 ตรวจความเหมาะสมการ Assign — ' + dateStr)
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);

  var s = an.summary;
  sh.getRange(2, 1, 1, W).merge()
    .setValue('ตรวจ ' + s.checked + '/' + s.working + ' คนที่มาทำงาน  ·  🔴 ไฟลท์นอกเวลา/ขาด OT ' + s.bad +
              '  ·  🟡 ควรตรวจ ' + s.warn + '  ·  OT อาจเกิน ' + s.otMuch + '  ·  มีช่วงว่าง ' + s.gap +
              '  ·  ไม่มีไฟลท์ ' + s.noFlt + ' (bench/standby)' +
              (s.noWin ? '  ·  (ไม่มีเวลากะระบุ ' + s.noWin + ' — ข้าม)' : ''))
    .setBackground('#241c33').setFontColor('#f5c542').setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center');
  sh.setRowHeight(2, 22);

  var head = ['สถานะ', 'ทีม/ส่วน', 'รหัส', 'ตำแหน่ง', 'ชื่อ', 'กะ (เข้า-ออก)', 'OT', 'ไฟลท์', 'ไฟลท์ที่ทำ',
              'ไฟลท์นอกเวลา', 'ช่วงว่าง', 'OT เหมาะสม?', 'ปัญหา/คำแนะนำ'];
  sh.getRange(3, 1, 1, W).setValues([head]).setBackground('#1f4e79').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  var emo = { bad: '🔴', warn: '🟡', ok: '🟢' };
  var body = an.rows.map(function (r) {
    return [emo[r.status] || '', r.team, r.id, r.pos, r.name, r.shift, r.ot, r.flights, r.job || '',
            r.uncovered, r.gaps, r.otVerdict, r.issue];
  });
  if (body.length) {
    sh.getRange(4, 1, body.length, W).setValues(body).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (var i = 0; i < an.rows.length; i++) {
      if (an.rows[i].status === 'bad') sh.getRange(4 + i, 1, 1, W).setBackground('#fdecec');
      else if (i % 2) sh.getRange(4 + i, 1, 1, W).setBackground('#fff8e1');
    }
    sh.getRange(4, 5, body.length, 1).setFontWeight('bold');
  } else {
    sh.getRange(4, 1, 1, W).merge().setValue('✅ ไม่พบการ Assign ที่ผิดปกติ — ทุกคนเวลากะครอบคลุมไฟลท์และ OT เหมาะสม')
      .setHorizontalAlignment('center').setBackground('#e6f4ea').setFontColor('#1b5e20').setFontWeight('bold');
  }

  [44, 90, 80, 90, 140, 110, 110, 90, 240, 180, 120, 160, 230].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  return an.summary;
}

var AP_TOL = 30;   // ผ่อนเวลาเข้า/ออกงานรอบหน้าต่าง phase (นาที)

function apClonePool_(res, ll) {
  var teamSys = slaTeamSystems_(res, ll);
  var pool = slaSupportPool_(res, ll, teamSys);
  pool.forEach(function (p) {
    p.busy = (p.busy || []).map(function (b) { return [b[0], b[1]]; });   // clone กัน mutate ของจริง
    p.plan = 0;                                                           // จำนวนที่จัดให้ในแผนนี้
  });
  return pool;
}

function apFree_(p, win) {
  if (!win) return true;                                                  // ไม่มีเวลา → ไม่จำกัด
  if (!(p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL)) return false;
  for (var i = 0; i < p.busy.length; i++) {
    var b = p.busy[i];
    if (win[0] < b[1] - 10 && win[1] > b[0] + 10) return false;           // ซ้อนทับ
  }
  return true;
}

function apEligible_(p, f, ph, win, sameTeamOk) {
  if (!sameTeamOk && f.teams && f.teams[p.team]) return false;            // โหมดเสริม = ข้ามทีมเท่านั้น
  var needSys = slaNeedSys_(f.airline, ph);
  if (needSys && !p.sys[slaSysNorm_(needSys)]) return false;              // CI/SUP ต้องรู้ระบบ (ยกเว้น iPort)
  if (ph === 'SUP' && p.posGroup !== 'PSS') return false;                 // SUP/Flight Controller ต้องเป็น Sup
  return apFree_(p, win);
}

function apScore_(p, ph, homeTeam) {
  var s = 0;
  if (ph === 'SUP')      s += (p.posGroup === 'PSS' ? 0 : 6);
  else if (ph === 'CI')  s += (p.posGroup === 'PSA' ? 0 : (p.posGroup === 'SNR' ? 1 : 3));
  else                   s += (p.posGroup === 'PSA' ? 0 : (p.posGroup === 'SNR' ? 1 : 2));   // GATE/ARR
  if (homeTeam && p.team === homeTeam) s -= 3;                            // ลดการสลับข้ามทีม
  s += p.plan * 2;                                                        // กระจายงาน
  return s;
}

function apPick_(pool, f, ph, win, sameTeamOk, homeTeam) {
  var best = null, bs = 1e9;
  for (var i = 0; i < pool.length; i++) {
    var p = pool[i];
    if (!apEligible_(p, f, ph, win, sameTeamOk)) continue;
    var sc = apScore_(p, ph, homeTeam);
    if (sc < bs) { bs = sc; best = p; }
  }
  if (best) {
    if (win) best.busy.push([win[0], win[1]]);
    best.plan++;
  }
  return best;
}

var AP_PHASES = ['SUP', 'CI', 'ARR', 'GATE'];     // ลำดับจัด: ระบบ/หายากก่อน (SUP, CI) แล้วค่อย ARR/GATE

function apPersonView_(p) {
  return { name: p.name, pos: slaPosShort_(p.posGroup), team: p.team,
           shift: p.shiftDisp, ot: p.otDisp, hrs: p.hrs, n: p.nflt, flts: p.flts || [] };
}

function apFillGaps_(res, ll) {
  var flights = slaCollectFlights_(res, ll);
  var pool = apClonePool_(res, ll);
  var rows = [];
  flights.filter(function (f) { return acIsFlight_(f.flight) && !f.ok; }).forEach(function (f) {
    AP_PHASES.forEach(function (ph) {
      var need = f.short[ph]; if (!need) return;
      var win = slaPhaseWindow_(f, ph);
      var picked = [];
      for (var k = 0; k < need; k++) {
        var p = apPick_(pool, f, ph, win, false, null);                   // ข้ามทีม
        if (!p) break;
        picked.push(apPersonView_(p));
      }
      rows.push({
        flight: f.flight, airline: f.airline, std: f.STD || f.STA || '',
        phase: SLA_PH_LB[ph], need: need, win: slaWinTxt_(f, ph),
        needSys: slaNeedSys_(f.airline, ph),
        picked: picked, remain: need - picked.length,
      });
    });
  });
  return rows;
}

function apReplan_(res, ll) {
  var flights = slaCollectFlights_(res, ll);
  var owner = acOwnerTeams_(res, ll);
  var pool = apClonePool_(res, ll);
  pool.forEach(function (p) { p.busy = []; p.plan = 0; });                // จัดใหม่ → ล้างงานเดิมทั้งหมด

  var fl = flights.filter(function (f) { return acIsFlight_(f.flight); }).sort(function (a, b) {
    return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz'));
  });

  var plan = [];
  fl.forEach(function (f) {
    var home = owner[f.airline] || (f.teamList || '').split(',')[0] || '';
    var assign = { SUP: [], CI: [], ARR: [], GATE: [] };
    var shortx = {};
    var phaseReq = { SUP: f.req.SUP, CI: f.req.CI, ARR: f.req.ARR, GATE: f.req.GATE };
    // TTL เกินผลรวม phase = พนักงานเสริม (เกท "จากเช็คอิน") → ปกติลงเป็น Check-in agent
    // แต่สายการบินที่ "ไม่มีเช็คอิน" (เช่น PG: CI=0 ตาม SLA) ให้ลงเป็น Gate agent แทน
    var sumPh = f.req.SUP + f.req.CI + f.req.ARR + f.req.GATE;
    var extra = Math.max(0, (f.req.total || 0) - sumPh);
    if (f.req.CI > 0) phaseReq.CI += extra; else phaseReq.GATE += extra;
    AP_PHASES.forEach(function (ph) {
      if (!phaseReq[ph]) return;                                         // ไม่ต้องการ phase นี้ (เช่น PG ไม่มีเช็คอิน)
      var win = slaPhaseWindow_(f, ph);
      for (var k = 0; k < phaseReq[ph]; k++) {
        var p = apPick_(pool, f, ph, win, true, home);                   // จัดใหม่ = ทีมเดียวกันได้
        if (p) assign[ph].push(apPersonView_(p));
        else { shortx[ph] = phaseReq[ph] - k; break; }
      }
    });
    var totAssigned = assign.SUP.length + assign.CI.length + assign.ARR.length + assign.GATE.length;
    plan.push({ flight: f.flight, airline: f.airline, system: slaSystemOf_(f.airline),
      std: f.STD || '', sta: f.STA || '', home: home, req: f.req, phaseReq: phaseReq,
      assign: assign, shortx: shortx, totReq: phaseReq.SUP + phaseReq.CI + phaseReq.ARR + phaseReq.GATE,
      totAssigned: totAssigned });
  });

  var bench = pool.filter(function (p) { return p.plan === 0; })
    .map(function (p) { return { name: p.name, pos: slaPosShort_(p.posGroup), team: p.team, shift: p.shiftDisp, sys: p.sys }; });
  return { plan: plan, bench: bench, nPeople: pool.length,
    nAssigned: pool.filter(function (p) { return p.plan > 0; }).length,
    nFlights: plan.length };
}

function apNames_(arr) {
  if (!arr.length) return '';
  var by = {}, order = [];
  arr.forEach(function (p) { if (!by[p.team]) { by[p.team] = []; order.push(p.team); } by[p.team].push(p.name + '(' + p.pos + ')'); });
  return order.map(function (t) { return '[' + t + '] ' + by[t].join(', '); }).join('  ·  ');
}

// ─── แท็บ 1: "🤖 เติม Assign เดิม" (โหมด A) ──────────────────────────────────
function rbWriteFillPlan_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🤖 เติม Assign เดิม';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var W = 9;

  var gaps = apFillGaps_(res, ll);
  var filledN = 0, remainN = 0;
  gaps.forEach(function (g) { filledN += g.picked.length; remainN += g.remain; });

  sh.getRange(1, 1, 1, W).merge()
    .setValue('🤖 เติมจาก Assign เดิม — จัดคนว่างข้ามทีมมาเสริมไฟลท์ที่ขาด (ข้อเสนอ แก้ชื่อในเซลล์ได้) — ' + dateStr)
    .setBackground('#1b3a2b').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  sh.getRange(2, 1, 1, W).merge()
    .setValue('เสริม ' + filledN + ' คน' + (remainN ? ('  ·  ยังขาดอีก ' + remainN + ' คน (ไม่มีคนว่าง/ระบบตรง)') : '  ·  เติมครบทุกตำแหน่ง ✅'))
    .setBackground('#2e5d3e').setFontColor('#fff').setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
  sh.setRowHeight(2, 22);
  var headA = ['Flight', 'สายการบิน', 'STD/STA', 'ตำแหน่งที่ขาด', 'จำนวน', 'ช่วงเวลา', 'ระบบที่ต้องใช้', 'คนที่จัดให้ (ข้ามทีม + งาน/OT/ไฟลท์)', 'สถานะ'];
  sh.getRange(3, 1, 1, W).setValues([headA]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  if (!gaps.length) {
    sh.getRange(4, 1, 1, W).merge().setValue('✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA แล้ว — ไม่ต้องเสริม')
      .setBackground('#e8f5e9').setFontColor('#1b5e20').setFontWeight('bold').setHorizontalAlignment('center');
  } else {
    var bodyA = gaps.map(function (g) {
      var who = g.picked.length ? apNamesFull_(g.picked) : (g.needSys ? '— ไม่มีคนว่างที่รู้ระบบ ' + g.needSys : '— ไม่มีคนว่าง');
      var st = g.remain === 0 ? '✅ เติมครบ' : (g.picked.length ? ('⚠️ ยังขาด ' + g.remain) : '🔴 ขาด ' + g.remain);
      return [g.flight, g.airline, g.std, g.phase + (g.needSys ? ' (' + g.needSys + ')' : ''), g.need, g.win, g.needSys || 'iPort/ใดก็ได้', who, st];
    });
    sh.getRange(4, 1, bodyA.length, W).setValues(bodyA).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (var i = 0; i < gaps.length; i++) {
      sh.getRange(4 + i, 1, 1, W).setBackground(gaps[i].remain === 0 ? '#f1f8e9' : (gaps[i].picked.length ? '#fff8e1' : '#fdecec'));
    }
  }
  [110, 70, 80, 130, 55, 95, 110, 340, 90].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  return { gapFilled: filledN, gapRemain: remainN };
}

// ─── แท็บ 2: "🤖 Auto Assign" (โหมด B) ──────────────────────────────────────
function rbWriteAutoAssign_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🤖 Auto Assign';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var W = 9;

  var rp = apReplan_(res, ll);
  var shortF = 0;
  rp.plan.forEach(function (p) { if (Object.keys(p.shortx).length) shortF++; });

  sh.getRange(1, 1, 1, W).merge()
    .setValue('🤖 Auto Assign — จัดเวรใหม่ทั้งหมดตาม SLA (ข้อเสนอ แก้ชื่อในเซลล์ได้) — ' + dateStr)
    .setBackground('#1b3a2b').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  sh.getRange(2, 1, 1, W).merge()
    .setValue('จัดคน ' + rp.nAssigned + '/' + rp.nPeople + ' คน ลง ' + rp.nFlights + ' ไฟลท์  ·  พัก/สำรอง ' + rp.bench.length +
              ' คน' + (shortF ? ('  ·  ' + shortF + ' ไฟลท์ยังขาด') : '  ·  ครบทุกไฟลท์ ✅'))
    .setBackground('#2e5d3e').setFontColor('#fff').setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
  sh.setRowHeight(2, 22);
  var headB = ['Flight', 'สายการบิน', 'ระบบ', 'STA', 'STD', 'SUP', 'Check-in', 'Gate', 'Arrival'];
  sh.getRange(3, 1, 1, W).setValues([headB]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  function phCell(arr, req, shortN) {
    if (!req) return '— ไม่มี';                                          // เช่น PG ไม่มีเช็คอิน
    var t = apNamesFull_(arr) || '—';
    return arr.length + '/' + req + (shortN ? ' ⚠️ขาด' + shortN : ' ✓') + (arr.length ? '\n' + t : '');
  }
  var bodyB = rp.plan.map(function (p) {
    return [p.flight, p.airline, p.system || 'iPort', p.sta, p.std,
            phCell(p.assign.SUP, p.phaseReq.SUP, p.shortx.SUP),
            phCell(p.assign.CI, p.phaseReq.CI, p.shortx.CI),
            phCell(p.assign.GATE, p.phaseReq.GATE, p.shortx.GATE),
            phCell(p.assign.ARR, p.phaseReq.ARR, p.shortx.ARR)];
  });
  var row = 4;
  if (bodyB.length) {
    sh.getRange(row, 1, bodyB.length, W).setValues(bodyB).setFontSize(8).setVerticalAlignment('top').setWrap(true);
    for (var j = 0; j < rp.plan.length; j++) {
      var ok = Object.keys(rp.plan[j].shortx).length === 0;
      sh.getRange(row + j, 1, 1, W).setBackground(ok ? (j % 2 ? '#f1f8e9' : '#fff') : '#fff3cd');
    }
    row += bodyB.length;
  }
  row++;
  sh.getRange(row, 1, 1, W).merge()
    .setValue('คนพัก/สำรอง (ยังไม่ถูกจัด) — ' + rp.bench.length + ' คน')
    .setBackground('#37474f').setFontColor('#fff').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  row++;
  if (rp.bench.length) {
    var byTeam = {}, ord = [];
    rp.bench.forEach(function (b) { if (!byTeam[b.team]) { byTeam[b.team] = []; ord.push(b.team); } byTeam[b.team].push(b.name + '(' + b.pos + ')'); });
    var benchTxt = ord.map(function (t) { return '[' + t + '] ' + byTeam[t].join(', '); }).join('   ·   ');
    sh.getRange(row, 1, 1, W).merge().setValue(benchTxt).setFontSize(9).setVerticalAlignment('top').setWrap(true).setBackground('#eceff1');
    sh.setRowHeight(row, Math.min(300, 20 + Math.ceil(benchTxt.length / 140) * 16));
  }
  [110, 70, 90, 55, 55, 190, 240, 220, 190].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  return { replanAssigned: rp.nAssigned, bench: rp.bench.length, shortFlights: shortF };
}

function apNamesFull_(arr) {
  if (!arr.length) return '';
  var by = {}, order = [];
  arr.forEach(function (p) { if (!by[p.team]) { by[p.team] = []; order.push(p.team); } by[p.team].push(p); });
  return order.map(function (t) {
    return '[' + t + '] ' + by[t].map(function (p) {
      var fl = (p.flts && p.flts.length) ? ' {' + p.flts.join(', ') + '}' : '';
      var ot = (p.ot && p.ot !== '-') ? ' OT:' + p.ot : '';
      return p.name + '(' + p.pos + ' · กะ ' + (p.shift || '-') + ot + fl + ')';
    }).join(', ');
  }).join('\n');
}

var ADV_ROSTER_ID = '1varvj0xmFPbyB7zMYCisTDOwmYGcWAoKHPVkIuC_9I0';
var ADV_FLIGHT_ID = '1Y3ft-vkHQ5Rm2LVmq1Zz_2j8n5T8wLgCJtdBKhqfBAA';
var ADV_EMP_ID    = '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8';
function advCfg_(key, dflt) {
  try { var v = PropertiesService.getScriptProperties().getProperty(key); return v || dflt; } catch (e) { return dflt; }
}

var ADV_MAX_OPT = 40;   // จำกัดตัวเลือกในแต่ละ dropdown

function advShiftTime_(code) {
  code = String(code || '').toUpperCase().trim();
  if (!code) return null;
  var m = code.match(/^([A-Z])(\d{1,2})$/);          // อักษรเดี่ยว + จำนวนชั่วโมง
  if (m) {
    var start = m[1].charCodeAt(0) - 64;             // A=1 → 01:00
    var len = +m[2];
    if (start >= 1 && start <= 23 && len >= 4 && len <= 14) {
      var s = start * 60, e = (start + len) * 60;
      return [s, e > 1440 ? 1440 : e];
    }
  }
  return null;                                        // OPS / อักษรซ้ำ / ดึก → แปลงเวลาไม่ได้
}

var ADV_TH_MON = { 'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12 };
function advParseDate_(v) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]')
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  var s = String(v).trim();
  var m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);                 // D/M/YYYY
  if (m1) return { y: +m1[3], m: +m1[2], d: +m1[1] };
  var m2 = s.match(/^(\d{1,2})\s+([ก-๙.]+)\s+(\d{4})/);              // D เดือนไทย YYYY
  if (m2 && ADV_TH_MON[m2[2]]) { var y = +m2[3]; return { y: y > 2400 ? y - 543 : y, m: ADV_TH_MON[m2[2]], d: +m2[1] }; }
  return null;
}
function advSameDate_(v, tgt) {
  var p = advParseDate_(v);
  return p && p.y === tgt.y && p.m === tgt.m && p.d === tgt.d;
}
function advHHMM_(v) {
  var s = String(v == null ? '' : v).replace(/[^\d:]/g, '');
  if (!s) return '';
  var m = s.match(/^(\d{1,2}):?(\d{2})$/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}

function advReadEmployees_() {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_EMP_ID', ADV_EMP_ID));
  var sh = ss.getSheetByName('Total') || ss.getSheets()[0];
  var data = sh.getDataRange().getValues();
  var emp = {}, col = null;
  data.forEach(function (row) {
    var c = row.map(function (x) { return String(x == null ? '' : x).trim(); });
    var idIdx = c.indexOf('รหัสพนักงาน');
    if (idIdx >= 0) {                                                  // แถวหัวตาราง (มีหลายบล็อกตามทีม)
      col = { id: idIdx, team: c.indexOf('ทีม'), pos: c.indexOf('ตำแหน่ง'),
              name: c.indexOf('Name'), sur: c.indexOf('Surname'), status: c.indexOf('สถานะ') };
      return;
    }
    if (!col) return;
    var id = (c[col.id] || '').replace(/\D/g, '');
    if (id.length < 6) return;
    var status = col.status >= 0 ? c[col.status] : 'Active';
    var nm = ((col.name >= 0 ? c[col.name] : '') + ' ' + (col.sur >= 0 ? c[col.sur] : '')).trim();
    emp[id] = { id: id, team: col.team >= 0 ? c[col.team] : '', pos: col.pos >= 0 ? c[col.pos] : '',
                name: nm || id, active: !/resign|terminat|inactive|พ้น|ลาออก/i.test(status) };
  });
  return emp;
}

function advReadRoster_(tgt) {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_ROSTER_ID', ADV_ROSTER_ID));
  var sh = ss.getSheets()[0];                                          // แท็บแรก = ปฏิทินกะ
  var data = sh.getDataRange().getValues();
  var hi = -1, dateCol = -1;
  for (var i = 0; i < data.length && i < 40; i++) {
    var r = data[i].map(function (x) { return String(x == null ? '' : x).trim(); });
    if (r.indexOf('รหัส') >= 0 && r.join('|').indexOf('ชื่อพนักงาน') >= 0) {
      hi = i;
      for (var col = 2; col < data[i].length; col++) { if (advSameDate_(data[i][col], tgt)) { dateCol = col; break; } }
      break;
    }
  }
  if (hi < 0 || dateCol < 0) return { rows: [], found: dateCol >= 0, hi: hi };
  var out = [];
  for (var r2 = hi + 1; r2 < data.length; r2++) {
    var row = data[r2];
    var id = String(row[0] || '').replace(/\D/g, '');
    if (id.length < 6) continue;
    var shift = String(row[dateCol] || '').trim();
    var dayType = String(row[dateCol + 1] || '').trim();
    var off = /(^|\b)0?3\b|วันหยุดพนักงาน/.test(dayType) || /^(OFF|X|VL|SL|VAC|ลา|พักร้อน)/i.test(shift) || !shift;
    out.push({ id: id, name: String(row[1] || '').trim(), shift: shift, dayType: dayType, off: off });
  }
  return { rows: out, found: true, hi: hi, dateCol: dateCol };
}

function advReadFlights_(tgt) {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_FLIGHT_ID', ADV_FLIGHT_ID));
  var out = [], seen = {};
  ss.getSheets().forEach(function (sh) {
    var data = sh.getDataRange().getValues();
    data.forEach(function (row) {
      if (!advSameDate_(row[0], tgt)) return;
      var airline = String(row[1] || '').trim().toUpperCase();
      var fltno = String(row[2] || '').trim();
      if (!airline || !fltno || /cancel/i.test(String(row[20] || ''))) return;   // ข้ามไฟลท์ยกเลิก
      var flight = airline + fltno;
      if (seen[flight]) return; seen[flight] = 1;
      out.push({ flight: flight, airline: airline, STA: advHHMM_(row[4]), STD: advHHMM_(row[5]), OP: '', CL: '' });
    });
  });
  return out;
}

var ADV_EN_MON = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };

function advHdrDay_(s) { var m = String(s || '').match(/\d{1,2}/); return m ? +m[0] : null; }

function advBlockAirlines_(s) {
  s = String(s || '');
  var m = s.match(/\d{4}\s*\/?\s*(.+)$/);                      // เอาส่วนหลังปี
  var tail = (m ? m[1] : s).replace(/\/(NO|POS|ID|NAME)\s*$/i, '');
  return (tail.match(/[A-Z0-9]{2,3}/g) || []).filter(function (c) { return !/^\d+$/.test(c); });
}

function advReadRosterFrontline_(tgt) {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_ROSTER_ID', ADV_ROSTER_ID));
  var sheets = ss.getSheets();
  var out = [];
  sheets.forEach(function (sh) {
    var data = sh.getDataRange().getValues();
    advScanFrontlineRows_(data, tgt, out);
  });
  return out;
}

function advScanFrontlineRows_(data, tgt, out) {
  var cur = null;                                              // {timeCol, airlines} ของบล็อกปัจจุบัน
  for (var i = 0; i < data.length; i++) {
    var row = data[i].map(function (x) { return String(x == null ? '' : x).trim(); });
    // แถวหัวบล็อก = มีคอลัมน์ลงท้าย "TIME" และถัดไปเป็น "CODE"
    var timeCols = [];
    for (var c = 0; c < row.length; c++) {
      if (/(^|\/)TIME$/i.test(row[c]) && /(^|\/)CODE$/i.test(row[c + 1] || '')) timeCols.push(c);
    }
    if (timeCols.length) {
      var title = '';
      for (var t = 0; t < Math.min(6, row.length); t++) if (/\d{4}/.test(row[t])) { title = row[t]; break; }
      var monMatch = title.match(/[A-Za-z]{3,}/);
      var blkMon = monMatch ? ADV_EN_MON[monMatch[0].slice(0, 3).toUpperCase()] : null;
      cur = null;
      if (blkMon == null || blkMon === tgt.m) {                // เดือนตรง (หรือไม่ระบุ)
        // เลขวันอาจอยู่ในเซลล์หัวเอง หรือแถวเหนือขึ้นไป (กรณี merge)
        for (var k = 0; k < timeCols.length; k++) {
          var col = timeCols[k];
          var day = advHdrDay_(row[col]);
          for (var up = 1; up <= 3 && day == null; up++) if (i - up >= 0) day = advHdrDay_(String(data[i - up][col] == null ? '' : data[i - up][col]));
          if (day === tgt.d) { cur = { timeCol: col, airlines: advBlockAirlines_(title) }; break; }
        }
      }
      continue;
    }
    if (!cur) continue;
    var id = (row[2] || '').replace(/\D/g, '');
    if (id.length < 6 || id.length > 8) continue;              // แถวคน: ID 6-8 หลักที่คอลัมน์ 3
    var pos = row[1] || '', name = ((row[3] || '') + ' ' + (row[4] || '')).trim();
    var rng = row[cur.timeCol] || '';
    var off = /^(OFF|X|VL|SL|VAC|ลา|พักร้อน)/i.test(rng) || !rng || /^\s*-\s*$/.test(rng);
    out.push({ id: id, name: name, pos: pos, team: cur.airlines.join('/'), airlines: cur.airlines, range: rng, off: off });
  }
}

function advFlightDates_() {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_FLIGHT_ID', ADV_FLIGHT_ID));
  var set = {}, out = [];
  ss.getSheets().forEach(function (sh) {
    sh.getDataRange().getValues().forEach(function (row) {
      var p = advParseDate_(row[0]);
      if (p) { var k = p.y + '-' + ('0' + p.m).slice(-2) + '-' + ('0' + p.d).slice(-2); if (!set[k]) { set[k] = 1; out.push(k); } }
    });
  });
  return out.sort();
}

function advNearestFlightDate_(iso, dates) {
  dates = dates || advFlightDates_();
  if (!dates.length) return null;
  if (dates.indexOf(iso) >= 0) return iso;
  var t = new Date(iso).getTime();
  return dates.slice().sort(function (a, b) {
    return Math.abs(new Date(a).getTime() - t) - Math.abs(new Date(b).getTime() - t) || (a < b ? 1 : -1);
  })[0];
}

function advSaveProposal(dateStr, rowsJson) {
  var rows = JSON.parse(rowsJson || '[]');
  var ss = SpreadsheetApp.create('Advance Plan ' + dateStr);
  var sh = ss.getSheets()[0];
  sh.setName(('Plan ' + dateStr).slice(0, 30));
  var head = ['Flight', 'สายการบิน', 'STA', 'STD', 'SUP', 'Check-in', 'Gate', 'Arrival'];
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff').setHorizontalAlignment('center');
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows).setWrap(true).setVerticalAlignment('top').setFontSize(9);
  sh.setFrozenRows(1);
  [110, 80, 55, 55, 210, 250, 210, 190].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return ss.getUrl();
}

function advSysForTeam_(teamStr) {
  var sys = {};
  String(teamStr || '').split(/[\/,\s]+/).forEach(function (code) {
    if (!code) return;
    var s = slaSystemOf_(code.toUpperCase());
    if (s) sys[slaSysNorm_(s)] = true;
  });
  return sys;
}

function advBuildPool_(tgt) {
  var emp = advReadEmployees_();
  var ros = advReadRosterFrontline_(tgt);
  var airlineTeams = {};
  ros.forEach(function (p) { (p.airlines || []).forEach(function (a) { (airlineTeams[a] = airlineTeams[a] || {})[p.team] = true; }); });
  var pool = [], seen = {};
  ros.forEach(function (p) {
    if (p.off || seen[p.id]) return;
    var rr = rrRangeStr_(p.range);
    if (rr[0] == null || rr[1] == null) return;                        // ไม่มีช่วงเวลา → ไม่จัด
    var ds = rr[0], de = rr[1]; if (de <= ds) de += 1440;
    var e = emp[p.id] || {};
    if (e.active === false) return;                                    // ลาออก/พ้นสภาพ → ข้าม
    seen[p.id] = 1;
    var sys = {};
    p.airlines.forEach(function (a) { var s = slaSystemOf_(a); if (s) sys[slaSysNorm_(s)] = true; });
    pool.push({
      id: p.id, name: e.name || p.name, team: p.team || (e.team || ''), pos: p.pos || e.pos || '',
      posGroup: rrPosGroup_(p.pos || e.pos || '', ''),
      ds: ds, de: de, busy: [], plan: 0, nflt: 0, sys: sys, airlines: p.airlines || [],
      shiftDisp: rrFmtMin_(rr[0]) + '-' + rrFmtMin_(((de) % 1440 + 1440) % 1440),
      otDisp: '-', hrs: Math.round((de - ds) / 6) / 10, flts: [],
    });
  });
  return { pool: pool, airlineTeams: airlineTeams };
}

function advPickSlot_(pool, f, ph, win) {
  var needSys = slaNeedSys_(f.airline, ph), nn = needSys ? slaSysNorm_(needSys) : '';
  var best = null, bs = 1e9;
  for (var i = 0; i < pool.length; i++) {
    var p = pool[i];
    if (nn && !p.sys[nn]) continue;                                    // CI/SUP ต้องรู้ระบบ (ยกเว้น iPort)
    if (ph === 'SUP' && p.posGroup !== 'PSS') continue;                // SUP ต้องเป็น Sup
    if (!apFree_(p, win)) continue;
    var sc = apScore_(p, ph, null) + (f.homeTeam[p.team] ? 0 : 8);     // ทีมเจ้าของไฟลท์มาก่อนเสมอ
    if (sc < bs) { bs = sc; best = p; }
  }
  if (best) {
    if (win) best.busy.push([win[0], win[1]]);
    best.plan++; best.nflt = best.plan;
    (best.flts = best.flts || []).push(f.flight + ' ' + (SLA_PH_LB[ph] || ph));
  }
  return best;
}

function advSlotCandidates_(pool, f, ph, win) {
  var needSys = slaNeedSys_(f.airline, ph), nn = needSys ? slaSysNorm_(needSys) : '';
  return pool.filter(function (p) {
    if (nn && !p.sys[nn]) return false;
    if (ph === 'SUP' && p.posGroup !== 'PSS') return false;
    if (win && !(p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL)) return false;
    return true;
  }).sort(function (a, b) {
    return (f.homeTeam[a.team] ? 0 : 1) - (f.homeTeam[b.team] ? 0 : 1) || a.plan - b.plan || String(a.name).localeCompare(b.name);
  });
}

function advPlan_(tgt) {
  var built = advBuildPool_(tgt);
  var pool = built.pool, airlineTeams = built.airlineTeams;            // สายการบิน → ทีมที่ดูแล (รวมคนหยุด)
  var flights = advReadFlights_(tgt).filter(function (f) { return acIsFlight_(f.flight); });
  flights.forEach(function (f) {
    f.airline = slaAirlineOf_(f.flight);
    f.system = slaSystemOf_(f.airline);
    f.homeTeam = airlineTeams[f.airline] || {};
    f.teams = {};
    f.req = slaReq_(f.airline);
  });
  flights.sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });

  var plan = [];
  flights.forEach(function (f) {
    var assign = { SUP: [], CI: [], ARR: [], GATE: [] }, shortx = {}, win = {};
    var phaseReq = { SUP: f.req.SUP, CI: f.req.CI, ARR: f.req.ARR, GATE: f.req.GATE };
    var sumPh = f.req.SUP + f.req.CI + f.req.ARR + f.req.GATE;
    var extra = Math.max(0, (f.req.total || 0) - sumPh);
    if (f.req.CI > 0) phaseReq.CI += extra; else phaseReq.GATE += extra;   // PG (CI=0) → ส่วนเกินไปเกท
    AP_PHASES.forEach(function (ph) {
      if (!phaseReq[ph]) return;
      win[ph] = slaPhaseWindow_(f, ph);
      for (var k = 0; k < phaseReq[ph]; k++) {
        var p = advPickSlot_(pool, f, ph, win[ph]);
        if (p) assign[ph].push(p);                                     // เก็บ ref ไว้ก่อน (nflt อัปเดตท้ายสุด)
        else { shortx[ph] = phaseReq[ph] - k; break; }
      }
    });
    plan.push({ flight: f.flight, airline: f.airline, system: f.system || '', team: Object.keys(f.homeTeam).join('/'),
      homeTeam: f.homeTeam, sta: f.STA || '', std: f.STD || '', req: f.req, phaseReq: phaseReq,
      assign: assign, shortx: shortx, win: win, _f: f });
  });

  // nflt สรุปครบแล้ว → แปลง ref เป็นวิว + สร้างรายชื่อสำรองของแต่ละสลอต
  plan.forEach(function (row) {
    AP_PHASES.forEach(function (ph) {
      if (!row.phaseReq[ph]) return;
      row.assign[ph] = row.assign[ph].map(apPersonView_);
      row['cand' + ph] = advSlotCandidates_(pool, row._f, ph, row.win[ph]);
    });
    delete row._f; delete row.win;
  });

  var bench = pool.filter(function (p) { return p.plan === 0; })
    .map(function (p) { return { id: p.id, name: p.name, pos: slaPosShort_(p.posGroup), team: p.team, shift: p.shiftDisp }; });
  return { plan: plan, bench: bench, pool: pool, nPeople: pool.length,
    nAssigned: pool.filter(function (p) { return p.plan > 0; }).length, nFlights: plan.length };
}

function advActiveNames_() {
  var emp = advReadEmployees_(), names = {};
  Object.keys(emp).forEach(function (id) { var e = emp[id]; if (e.active !== false && e.name) names[e.name] = 1; });
  return Object.keys(names).sort();
}

function advBuildSelect_(chosen, cands, home) {
  var inT = [], ot = [], found = false;
  (cands || []).forEach(function (c) { if (c.name === chosen.name) found = true; (home[c.team] ? inT : ot).push(c); });
  function opt(c) {
    return '<option value="' + rbAttr_(c.name) + '"' + (c.name === chosen.name ? ' selected' : '') + '>' +
      rbEsc_(c.name + ' · ' + slaPosShort_(c.posGroup) + ' · ' + (c.team || '-') + ' · ' + (c.shiftDisp || '') + ' · ' + (c.nflt || 0) + ' ไฟลท์') + '</option>';
  }
  var h = '<select class="namepick" oninput="this.classList.add(\'edited\')">';
  if (!found) h += '<option value="' + rbAttr_(chosen.name) + '" selected>' +
    rbEsc_(chosen.name + ' · ' + (chosen.pos || '') + ' · ' + (chosen.team || '') + ' · ' + (chosen.shift || '') + ' · ' + (chosen.n || 0) + ' ไฟลท์') + '</option>';
  if (inT.length) h += '<optgroup label="● ทีมเจ้าของไฟลท์ (' + inT.length + ')">' + inT.map(opt).join('') + '</optgroup>';
  if (ot.length) h += '<optgroup label="○ ข้ามทีม · ระบบตรง (' + ot.length + ')">' + ot.slice(0, 30).map(opt).join('') + '</optgroup>';
  return h + '</select>';
}

function rbAdvanceHtml(iso) {
  try {
    var reqIso = iso, switched = false, allDates = [];
    try { allDates = advFlightDates_(); } catch (e0) {}
    if (allDates.length && allDates.indexOf(iso) < 0) {              // วันที่ขอไม่มีไฟลท์ → เด้งไปวันใกล้สุด
      var near = advNearestFlightDate_(iso, allDates);
      if (near) { iso = near; switched = true; }
    }
    var date = (typeof rbDateFromIso_ === 'function') ? rbDateFromIso_(iso) : new Date(iso);
    var tgt = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
    var dstr = tgt.d + '/' + tgt.m + '/' + tgt.y;
    var datebar = '<div class="sectionlabel" style="background:#eef6ff;border-left:4px solid #1f4e79;padding:8px 12px;border-radius:8px">' +
      '📅 <b>จัดเวรล่วงหน้า</b> (ลิงก์ ROSTER · FLIGHT · รายชื่อจริง) — เลือกวันที่: ' +
      '<input type="date" value="' + iso + '" onchange="advGo(this.value)" style="font-family:inherit;padding:3px 6px;border-radius:6px;border:1px solid #b9c6da">' +
      ' <button class="btn btn--accent" onclick="advSave()" style="margin-left:8px">💾 บันทึกลงชีต</button>' +
      ' <span id="advsavemsg" class="okk" style="margin-left:6px"></span>' +
      (switched ? ' <span class="badd" style="margin-left:6px">ℹ️ วันที่ ' + reqIso + ' ไม่มีไฟลท์ → แสดงวันใกล้สุด ' + dstr + '</span>' : '') +
      ' <span class="muted">· คลิกช่องชื่อเพื่อเลือก/แก้ (autocomplete จากพนักงานทั้งหมด) · บันทึกเป็นชีตใหม่ ไม่เขียนทับไฟล์จริง</span></div>';

    var plan = advPlan_(tgt);
    if (!plan.nFlights) {                                              // ไม่มีไฟลท์วันนี้ → บอกวันที่ที่มีไฟลท์ + โชว์คนขึ้นเวร
      var avail = '';
      try {
        avail = advFlightDates_().map(function (k) {
          var p = k.split('-');
          return '<button class="supteam" onclick="advGo(\'' + k + '\')">' + (+p[2]) + '/' + (+p[1]) + '/' + p[0] + '</button>';
        }).join(' ');
      } catch (e2) {}
      var benchHtml0 = plan.nPeople ? ('<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>👥 คนขึ้นเวรวันนี้ (' + dstr + ') — ' + plan.nPeople + ' คน</h3></div><div style="padding:10px 14px">' +
        plan.bench.map(function (b) { return '<span class="chip">' + rbEsc_(b.name) + ' <span class="muted">' + rbEsc_(b.pos) + ' · ' + rbEsc_(b.shift) + '</span></span>'; }).join('') + '</div></div>') : '';
      return datebar + '<div class="panel" style="padding:20px;text-align:center">ยังไม่มี<b>ไฟลท์</b>สำหรับวันที่ ' + dstr +
        ' — จึงยังจัด assignment ไม่ได้' +
        (avail ? '<div style="margin-top:10px">📅 วันที่ที่มีไฟลท์ในตาราง (คลิกเพื่อจัด): <div class="supbar" style="justify-content:center">' + avail + '</div></div>'
               : '<div class="muted" style="margin-top:6px">— ตรวจว่าไฟล์ FLIGHT มีข้อมูลของวันนี้</div>') + '</div>' + benchHtml0;
    }
    var shortF = 0;
    plan.plan.forEach(function (p) { if (Object.keys(p.shortx).length) shortF++; });
    var hd = '<div class="sectionlabel">วันที่ ' + dstr + ' · ไฟลท์ <b>' + plan.nFlights + '</b> · คนขึ้นเวร <b>' + plan.nPeople +
      '</b> · จัดแล้ว <b>' + plan.nAssigned + '</b> · พัก ' + plan.bench.length + ' · ' +
      (shortF ? '<b class="badd">' + shortF + ' ไฟลท์ยังขาด</b>' : 'ครบทุกไฟลท์ ✅') + '</div>';

    function cell(arr, req, shortN, cands, home) {
      if (!req) return '<span class="muted">— ไม่มี</span>';
      var picks = (arr || []).map(function (v) { return advBuildSelect_(v, cands, home); }).join('');
      return '<div><b>' + (arr ? arr.length : 0) + '/' + req + '</b> ' + (shortN ? '<span class="badd">⚠️-' + shortN + '</span>' : '<span class="okk">✓</span>') +
        '</div>' + (arr && arr.length ? '<div class="pickwrap">' + picks + '</div>' : '');
    }
    var body = plan.plan.map(function (p) {
      var ok = Object.keys(p.shortx).length === 0, hm = p.homeTeam || {};
      return '<tr class="' + (ok ? '' : 'rowbad') + '" data-team="' + rbEsc_(p.airline) + '"><td class="b">' + rbEsc_(p.flight) +
        '</td><td>' + rbEsc_(p.airline) + (p.team ? '<div class="muted" style="font-size:10px">ทีม ' + rbEsc_(p.team) + '</div>' : '<div class="badd" style="font-size:10px">ไม่มีทีม</div>') +
        '</td><td>' + rbEsc_(p.system || 'iPort') + '</td><td class="tnum">' + rbEsc_(p.sta) + '</td><td class="tnum">' + rbEsc_(p.std) +
        '</td><td>' + cell(p.assign.SUP, p.phaseReq.SUP, p.shortx.SUP, p.candSUP, hm) + '</td><td>' + cell(p.assign.CI, p.phaseReq.CI, p.shortx.CI, p.candCI, hm) +
        '</td><td>' + cell(p.assign.GATE, p.phaseReq.GATE, p.shortx.GATE, p.candGATE, hm) + '</td><td>' + cell(p.assign.ARR, p.phaseReq.ARR, p.shortx.ARR, p.candARR, hm) + '</td></tr>';
    }).join('');
    var tbl = rbTblCard_('📅 จัด Assignment ล่วงหน้าตาม SLA (จัดคนในทีมก่อน) — ' + dstr,
      '<tr><th>Flight</th><th>สายการบิน / ทีม</th><th>ระบบ</th><th>STA</th><th>STD</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th></tr>',
      body, rbCtrls_('view-adv', true));

    var benchHtml = '';
    if (plan.bench.length) {
      benchHtml = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>😴 คนขึ้นเวรที่ยังไม่ถูกจัด — ' + plan.bench.length + ' คน</h3></div>' +
        '<div style="padding:10px 14px">' + plan.bench.map(function (b) {
          return '<span class="chip">' + rbEsc_(b.name) + ' <span class="muted">' + rbEsc_(b.pos) + ' · ' + rbEsc_(b.shift) + '</span></span>';
        }).join('') + '</div></div>';
    }
    return datebar + hd + tbl + benchHtml;
  } catch (e) { return '<div class="panel">โหลด "จัดเวรล่วงหน้า" ไม่ได้: ' + rbEsc_(e.message) + ' <div class="muted">— ตรวจสิทธิ์เข้าถึง 3 ชีต (ROSTER/FLIGHT/Total) และรหัสชีตใน Script Properties</div></div>'; }
}

function advTest_() {
  var d = new Date(); d.setMonth(d.getMonth()); var tgt = { y: 2026, m: 6, d: 1 };
  var emp = advReadEmployees_(), ros = advReadRosterFrontline_(tgt), flt = advReadFlights_(tgt), built = advBuildPool_(tgt), plan = advPlan_(tgt);
  Logger.log('employees=%s frontlineRows=%s working=%s flights=%s pool=%s teams=%s | plan: flights=%s assigned=%s bench=%s',
    Object.keys(emp).length, ros.length, ros.filter(function (r) { return !r.off; }).length, flt.length, built.pool.length,
    Object.keys(built.airlineTeams).length, plan.nFlights, plan.nAssigned, plan.bench.length);
  return { employees: Object.keys(emp).length, rosterRows: ros.length, flights: flt.length, pool: built.pool.length, nFlights: plan.nFlights, nAssigned: plan.nAssigned };
}

var CONFIG_RB = {
  ROOT_FOLDER_ID:   '1Uk-6w7U-cqQEXFIVEl6tRhKKRCaN1ojp',   // PSA year folder (drill month→day)
  OUTPUT_FOLDER_ID: '',                                     // โฟลเดอร์เก็บรายงาน — เว้นว่าง = เซฟลง My Drive
  LL_FILE_ID:       '', // ไฟล์ LL — ใส่ ID ถ้าบัญชีที่รันมีสิทธิ์เข้า (ของเดิม '13Ry12jDy8S8vmlPVTxMUDLC_8u3PiPRIhvgDHEeWhMg'); เว้นว่าง = ข้าม LL
  CHAT_WEBHOOK_PROP: 'GCHAT_WEBHOOK_REPORT',               // Script Property holding the webhook URL
  SKIP_TIMETABLE_TEAMS: [],                                // teams to omit from the timetable tab
};

var MON_RB = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ─── ENTRY POINTS ───────────────────────────────────────────────────────────
function runDailyRosterReport() {
  try { rbRunForDate_(new Date()); }
  catch (e) { Logger.log('❌ runDailyRosterReport: ' + e.message + '\n' + (e.stack || '')); }
}

function runRosterForDate(y, m, d) {
  try { rbRunForDate_(new Date(y, m - 1, d)); }
  catch (e) { Logger.log('❌ runRosterForDate: ' + e.message + '\n' + (e.stack || '')); }
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyRosterReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyRosterReport').timeBased().atHour(8).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('runDailyRosterReport').timeBased().atHour(14).nearMinute(0).everyDays(1).create();
  var w = PropertiesService.getScriptProperties().getProperty(CONFIG_RB.CHAT_WEBHOOK_PROP) ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง (ใส่ใน Script Properties)';
  Logger.log('✅ ตั้ง trigger รันทุกวัน 08:00 และ 14:00 แล้ว · Google Chat webhook: ' + w);
}

function setupChatWebhook() {
  var url = 'PASTE_GOOGLE_CHAT_WEBHOOK_URL_HERE';
  if (url.indexOf('http') !== 0) { Logger.log('⚠️ วาง URL webhook ในฟังก์ชัน setupChatWebhook ก่อน'); return; }
  PropertiesService.getScriptProperties().setProperty(CONFIG_RB.CHAT_WEBHOOK_PROP, url);
  Logger.log('✅ บันทึก webhook แล้ว → รายงานรายวันจะส่งเข้า Google Chat');
}

function rbOpenAnyById_(id) {
  var file = DriveApp.getFileById(id);
  var mime = file.getMimeType();
  if (mime === MimeType.GOOGLE_SHEETS) return { ss: SpreadsheetApp.openById(id), tempId: null };
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || /\.xlsx$/i.test(file.getName())) {
    var tmp = Drive.Files.copy({ title: '_TEMP_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }, id, { convert: true });
    return { ss: SpreadsheetApp.openById(tmp.id), tempId: tmp.id };
  }
  throw new Error('ไฟล์นี้ไม่ใช่ Spreadsheet (mime=' + mime + ') — ต้องชี้ไปที่ไฟล์ assignment PSA');
}

function testRosterFromId(ssId, llId, y, m, d) {
  ssId = ssId || 'PUT_A_ROSTER_SPREADSHEET_ID_HERE';
  var opened = rbOpenAnyById_(ssId);
  var roster = opened.ss;
  Logger.log('📄 ไฟล์: %s | ชีต: %s', roster.getName(),
             roster.getSheets().map(function (s) { return s.getName(); }).join(', '));
  var res = readRosterFromSpreadsheet(roster);
  Logger.log('➡️ เจอ %s ทีม, รวม %s คน (working %s)',
             Object.keys(res.teams).length, res.totals.staff, res.totals.working);
  if (res.totals.staff === 0) {
    Logger.log('⚠️ อ่านไม่เจอพนักงาน — ตรวจว่าไฟล์นี้เป็นไฟล์ assignment PSA (มีแท็บ EK/SQ/QR/...) ' +
               'และมีหัวตาราง ID/NAME/SHIFT ใช่ไหม');
  }
  var ll = null;
  if (llId) {
    var date = (y && m && d) ? new Date(y, m - 1, d) : new Date();
    try { ll = readLLForDate(llId, date); } catch (e) { Logger.log('⚠️ LL: ' + e.message); }
  }
  var master = null;
  try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e) { Logger.log('⚠️ Master: ' + e.message); }
  var out = SpreadsheetApp.create('Roster Report — ' + roster.getName());
  rbWriteDashboard_(out, res, roster.getName(), ll, master);
  rbWriteTimetable_(out, res, roster.getName(), ll);
  rbWriteFlightSLA_(out, res, roster.getName(), ll);
  rbWriteSupport_(out, res, roster.getName(), ll);
  rbWriteAssignCheck_(out, res, roster.getName(), ll);
  rbWriteFillPlan_(out, res, roster.getName(), ll);
  rbWriteAutoAssign_(out, res, roster.getName(), ll);
  var cleanup = out.getSheetByName('Sheet1') || out.getSheetByName('ชีต1');
  if (cleanup && out.getSheets().length > 1) out.deleteSheet(cleanup);
  if (opened.tempId) { try { DriveApp.getFileById(opened.tempId).setTrashed(true); } catch (e) {} }
  Logger.log('✅ Report written: %s', out.getUrl());
  return out.getUrl();
}

// ─── MAIN PIPELINE ──────────────────────────────────────────────────────────
function rbRunForDate_(date) {
  var roster = rbOpenTodayRoster_(date);
  var res = readRosterFromSpreadsheet(roster.ss);

  var ll = null;
  if (CONFIG_RB.LL_FILE_ID) {
    try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); }
    catch (e) { Logger.log('⚠️ LL: ' + e.message); }
  }

  var master = null;
  if (MASTER_FILE_ID_RB) {
    try { master = readMasterHeadcount(MASTER_FILE_ID_RB); }
    catch (e) { Logger.log('⚠️ Master: ' + e.message); }
  }

  var be = date.getFullYear() + 543;
  var mon = MON_RB[date.getMonth()];
  var dd = ('0' + date.getDate()).slice(-2);
  var dateStr = date.getDate() + ' ' + mon + ' ' + be;

  // one monthly file, tabs PER DAY → keeps history
  var out = rbGetMonthlyOutput_(mon, be);
  rbWriteDashboard_(out, res, dateStr, ll, master, '📊 ' + dd + ' ' + mon);
  rbWriteTimetable_(out, res, dateStr, ll, '🕓 ' + dd + ' ' + mon);
  rbWriteFlightSLA_(out, res, dateStr, ll, '✈️ ' + dd + ' ' + mon);
  rbWriteSupport_(out, res, dateStr, ll, '🆘 ' + dd + ' ' + mon);
  rbWriteAssignCheck_(out, res, dateStr, ll, '🧭 ' + dd + ' ' + mon);
  rbWriteFillPlan_(out, res, dateStr, ll, '🤖 เติม ' + dd + ' ' + mon);
  rbWriteAutoAssign_(out, res, dateStr, ll, '🤖 Auto ' + dd + ' ' + mon);
  // weekly OT (>36h) — reads the week's files; non-fatal if it can't finish
  try {
    var wr = rbWeekRange_(date);
    rbWriteWeeklyOT_(out, date, mon, '⏱️ OT ' + wr.startDay + '-' + wr.endDay + ' ' + mon);
  } catch (e) { Logger.log('⚠️ Weekly OT: ' + e.message); }
  ['Sheet1', 'ชีต1', 'Sheet'].forEach(function (n) {
    var s = out.getSheetByName(n); if (s && out.getSheets().length > 1) out.deleteSheet(s);
  });
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }

  rbPostChat_(res, dateStr, out.getUrl(), ll, master);
  Logger.log('✅ Done: %s', out.getUrl());
}

// ─── DASHBOARD TAB (KPI cards — JUN_2569 style) ─────────────────────────────
var KPI_BG_ = ['#e8f0fe', '#e6f4ea', '#f5f5f5', '#fff8e1', '#fff3e0', '#fce4ec'];
var KPI_FC_ = ['#1a237e', '#1b5e20', '#424242', '#e65100', '#bf360c', '#880e4f'];

function rbCards_(sh, top, labels, values) {
  for (var i = 0; i < labels.length; i++) {
    sh.getRange(top, i + 1).setValue(labels[i]).setBackground(KPI_BG_[i % 6]).setFontColor(KPI_FC_[i % 6])
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.getRange(top + 1, i + 1).setValue(values[i]).setBackground(KPI_BG_[i % 6]).setFontColor(KPI_FC_[i % 6])
      .setFontWeight('bold').setFontSize(20).setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
  sh.setRowHeight(top, 22); sh.setRowHeight(top + 1, 40);
}

function rbOtCell_(people, hrs) { return people > 0 ? (people + ' (' + hrs + 'h)') : '-'; }

function rbManpowerTable_(sh, top, title, rowsData, headColor) {
  var W = 9;
  sh.getRange(top, 1, 1, W).merge().setValue(title)
    .setBackground(headColor).setFontColor('#fff').setFontWeight('bold').setFontSize(12);
  sh.setRowHeight(top, 24);
  var head = ['ทีม/ส่วน', 'Total', 'Working', 'OFF', 'Vac', 'OT-Off', 'OT ก่อนกะ', 'OT หลังกะ', '%Working'];
  sh.getRange(top + 1, 1, 1, W).setValues([head]).setBackground('#2e75b6').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  var body = rowsData.map(function (d) {
    var b = d.agg, work = b.working + b.ot_off;
    var pct = b.staff > 0 ? Math.round(work / b.staff * 100) + '%' : '-';
    return [d.label, b.staff, work, b.off, b.leave, rbOtCell_(b.ot_off, b.otOffHrs), rbOtCell_(b.otPre, b.otPreHrs), rbOtCell_(b.otPost, b.otPostHrs), pct];
  });
  if (body.length) sh.getRange(top + 2, 1, body.length, W).setValues(body);
  return top + 2 + body.length;
}

function rbWriteDashboard_(ss, res, dateStr, ll, master, tabName) {
  tabName = tabName || '📊 Dashboard';
  var oldD = ss.getSheetByName(tabName);
  if (oldD) ss.deleteSheet(oldD);                            // recreate fresh (clears stale freeze/merges)
  var sh = ss.insertSheet(tabName, 0);

  var P = res.totals;
  var L = ll && ll.totals.staff > 0 ? ll.totals : null;
  var combStaff = P.staff + (L ? L.staff : 0);
  var combWork  = (P.working + P.ot_off) + (L ? L.working + L.ot_off : 0);
  var combOff   = P.off + (L ? L.off : 0);
  var combOtOff = P.ot_off + (L ? L.ot_off : 0);
  var combOtPpl = P.otPeople + (L ? L.otPeople : 0);
  var combOtHrs = Math.round((P.otHours + (L ? L.otHours : 0)) * 10) / 10;

  // Title
  sh.getRange(1, 1, 1, 6).merge().setValue('📊 Daily Manpower Dashboard  —  ' + dateStr)
    .setBackground('#002060').setFontColor('#fff').setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 34);

  // KPI cards (PSA + LL combined) — exact JUN_2569 fields
  rbCards_(sh, 3,
    ['👥 Total Staff', '🟢 Working', '⬛ OFF', '🟡 OT OFF (XX)', '⏰ OT คน', '⏱️ OT ชั่วโมง'],
    [combStaff, combWork, combOff, combOtOff, combOtPpl, combOtHrs]);

  // Overall OT split (ก่อนกะ / หลังกะ / OT OFF) — combined PSA + LL, คน + ชม.
  var otPre = P.otPre + (L ? L.otPre : 0), otPreHrs = Math.round((P.otPreHrs + (L ? L.otPreHrs : 0)) * 10) / 10;
  var otPost = P.otPost + (L ? L.otPost : 0), otPostHrs = Math.round((P.otPostHrs + (L ? L.otPostHrs : 0)) * 10) / 10;
  var otOff = P.ot_off + (L ? L.ot_off : 0), otOffHrs = Math.round((P.otOffHrs + (L ? L.otOffHrs : 0)) * 10) / 10;
  sh.getRange(5, 1, 1, 6).merge()
    .setValue('⏱️ OT ก่อนกะ: ' + otPre + ' คน (' + otPreHrs + 'h)  |  OT หลังกะ: ' + otPost + ' คน (' + otPostHrs +
              'h)  |  OT OFF: ' + otOff + ' คน (' + otOffHrs + 'h)  |  รวม OT: ' + (P.otPeople + (L ? L.otPeople : 0)) +
              ' คน (' + Math.round((P.otHours + (L ? L.otHours : 0)) * 10) / 10 + 'h)')
    .setBackground('#241c33').setFontColor('#f5c542').setFontWeight('bold').setFontSize(11)
    .setHorizontalAlignment('center');
  sh.setRowHeight(5, 22);

  // Active establishment headcount (both departments) from MASTER file
  var row = 7;
  if (master) {
    var both = master.PSA.total + master.LL.total;
    sh.getRange(row, 1, 1, 6).merge()
      .setValue('👥 จำนวนพนักงานทั้งหมด (Active) — PSA ' + master.PSA.total +
                '  +  LL ' + master.LL.total + '  =  ' + both + ' คน')
      .setBackground('#37474f').setFontColor('#fff').setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('center');
    sh.setRowHeight(row, 22);
    row += 2;
  } else {
    row += 1;
  }

  // 📌 Manpower by Team (PSA)
  var teamRows = Object.keys(res.teams).sort(function (a, b) {
    return (res.teams[b].working + res.teams[b].ot_off) - (res.teams[a].working + res.teams[a].ot_off);
  }).map(function (t) { return { label: t, agg: res.teams[t] }; });
  teamRows.push({ label: '🔵 PSA TOTAL', agg: P });
  row = rbManpowerTable_(sh, row, '📌 Manpower by Team (PSA)', teamRows, '#1f4e79') + 1;

  // 📌 Manpower by Section (LL)
  if (L) {
    var secRows = Object.keys(ll.sections).map(function (s) { return { label: s, agg: ll.sections[s] }; });
    secRows.push({ label: '🟡 LL TOTAL', agg: L });
    row = rbManpowerTable_(sh, row, '📌 Manpower by Section (LL)', secRows, '#7f6000') + 1;
  }

  // 📌 By position group (PSA then LL) — full detail, with OT ก่อน/หลังกะ
  var ph = ['Position', 'Total', 'Working', 'OT-Off', 'Off', 'Sick', 'Leave', 'OT ก่อนกะ', 'OT หลังกะ'];
  function posBlock(title, positions, orderList, bg) {
    sh.getRange(row, 1, 1, ph.length).merge().setValue(title)
      .setBackground(bg).setFontColor('#fff').setFontWeight('bold'); row++;
    sh.getRange(row, 1, 1, ph.length).setValues([ph]).setBackground('#888').setFontColor('#fff').setFontWeight('bold'); row++;
    var body = [];
    orderList.forEach(function (p) {
      var b = positions[p]; if (!b) return;
      body.push([p, b.staff, b.working + b.ot_off, rbOtCell_(b.ot_off, b.otOffHrs), b.off, b.sick, b.leave,
                 rbOtCell_(b.otPre, b.otPreHrs), rbOtCell_(b.otPost, b.otPostHrs)]);
    });
    if (body.length) { sh.getRange(row, 1, body.length, ph.length).setValues(body); row += body.length; }
    row += 1;
  }
  posBlock('🔵 PSA by position', res.positions,
           ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign', 'DIR', 'MGR', 'Assist'], '#1f4e79');
  if (L) posBlock('🟡 LL by position', ll.positions, ['PSS', 'SNR', 'PSA', 'Porter', 'Admin', 'Trainee'], '#7f6000');

  // Combined PSA + LL working KPI footer
  if (L) {
    sh.getRange(row, 1, 1, 6).merge()
      .setValue('🏢 รวม PSA + LL  —  มาทำงาน ' + combWork + ' / ' + combStaff +
                ' คน  •  OFF ' + combOff + '  •  OT ' + combOtPpl + ' คน (' + combOtHrs + 'h)')
      .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('center');
    sh.setRowHeight(row, 24);
  }

  [110, 70, 75, 65, 70, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  for (var c = 7; c <= 9; c++) sh.setColumnWidth(c, 60);
  sh.setFrozenRows(2);
}

// ─── TIMETABLE TAB (wide flight-form layout, 3 OT columns) ──────────────────
function rbShiftCell_(r) {
  var code = r.shift || '';
  return (r.shiftTime && r.shiftTime !== code) ? (code + ' (' + r.shiftTime + ')') : code;
}

function rbOtCols_(r) {
  var cell = (r.otTime ? r.otTime + ' ' : '') + (r.ot ? '(' + r.ot + 'h)' : '');
  if (r.bucket === 'ot_off') return ['', '', r.ot ? cell : '✔'];
  if (r.ot > 0) return r.otType === 'PRE' ? [cell, '', ''] : ['', cell, ''];
  return ['', '', ''];
}

function rbWriteTimetable_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🕓 Timetable';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);                              // recreate fresh (clears stale freeze/merges)
  var sh = ss.insertSheet(tabName, 1);

  // flatten ALL records (working first, then OFF/SL/ลา) — PSA teams then LL sections
  var recsAll = [];
  Object.keys(res.teams).forEach(function (team) {
    if (CONFIG_RB.SKIP_TIMETABLE_TEAMS.indexOf(team) >= 0) return;
    res.teams[team].records.forEach(function (r) { recsAll.push(r); });
  });
  if (ll && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) { recsAll.push(r); });
    });
  }
  var bkOrd = { working: 0, ot_off: 1, off: 2, vac: 3, sick: 4 };
  recsAll.sort(function (a, b) {
    return String(a.team).localeCompare(String(b.team)) ||
           ((bkOrd[a.bucket] || 0) - (bkOrd[b.bucket] || 0)) ||
           ((a.shiftStart == null ? 99999 : a.shiftStart) - (b.shiftStart == null ? 99999 : b.shiftStart));
  });

  // จำนวนคอลัมน์ไฟลท์ = มากสุดที่พนักงานคนใดได้รับ (ขั้นต่ำ 4 · เพดาน 20 กันกว้างเกิน)
  var maxFl = 4;
  recsAll.forEach(function (r) { if (r.assignments && r.assignments.length > maxFl) maxFl = r.assignments.length; });
  var MAXFL = Math.min(maxFl, 20), F = 6, B = 9, TOTAL = B + MAXFL * F + 1;
  if (sh.getMaxColumns() < TOTAL) sh.insertColumnsAfter(sh.getMaxColumns(), TOTAL - sh.getMaxColumns());

  // Title
  sh.getRange(1, 1, 1, TOTAL).merge().setValue('🕓 Timetable / ตารางงานรายคน — ' + dateStr)
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);

  // Group headers (rows 2-3)
  var baseHdr = ['Team', 'รหัสพนักงาน', 'ตำแหน่ง', 'ชื่อ', 'SHIFT เวลากะ', 'RE', 'OT ก่อนกะ', 'OT หลังกะ', 'OT OFF'];
  baseHdr.forEach(function (h, i) {
    sh.getRange(2, i + 1, 2, 1).merge().setValue(h).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
      .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  });
  var flClr = ['#0d3d6b', '#145a32', '#6e2f8e', '#784212'];
  for (var fi = 0; fi < MAXFL; fi++) {
    var base = B + fi * F + 1, clr = flClr[fi % flClr.length];
    sh.getRange(2, base, 1, F).merge().setValue('ไฟลท์ที่ ' + (fi + 1)).setBackground(clr).setFontColor('#fff')
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
    ['ชื่อไฟลท์', 'หน้าที่/Task', 'STA', 'OP', 'CL', 'STD'].forEach(function (h, k) {
      sh.getRange(3, base + k).setValue(h).setBackground(clr).setFontColor('#fff').setFontWeight('bold')
        .setFontSize(9).setHorizontalAlignment('center').setWrap(true);
    });
  }
  sh.getRange(2, TOTAL, 2, 1).merge().setValue('ชั่วโมงรวม').setBackground('#1f4e79').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(2, 20); sh.setRowHeight(3, 30);

  // Data rows
  var ST_LB = { off: '⬛ OFF', sick: '🔴 SL (ป่วย)', vac: '🌴 ลา' };
  var ST_BG = { off: '#e8eaed', sick: '#f8d7da', vac: '#fff3cd' };
  var data = recsAll.map(function (r) {
    var st = ST_LB[r.bucket];                               // off / sick / vac
    if (st) {                                               // non-working: show status, blank flights/OT
      var row0 = [r.team || '', r.id || '', r.pos || '', r.name || '', st, '', '', '', ''];
      for (var z = 0; z < MAXFL * F + 1; z++) row0.push('');
      return row0;
    }
    var ot = rbOtCols_(r);
    var row = [r.team || '', r.id || '', r.pos || '', r.name || '', rbShiftCell_(r), r.re || '', ot[0], ot[1], ot[2]];
    for (var fi = 0; fi < MAXFL; fi++) {
      var a = r.assignments && r.assignments[fi];
      row.push(a ? a.flight : '', a ? (a.task || '') : '', a ? (a.STA || '') : '', a ? (a.OP || '') : '', a ? (a.CL || '') : '', a ? (a.STD || '') : '');
    }
    var total = (r.shiftHrs || 0) + (r.ot || 0);
    row.push(total ? Math.round(total * 10) / 10 : '');
    return row;
  });
  if (data.length) {
    sh.getRange(4, 1, data.length, TOTAL).setValues(data).setFontSize(9).setVerticalAlignment('middle');
    for (var i = 0; i < data.length; i++) {
      var ro = recsAll[i];
      if (ST_BG[ro.bucket]) sh.getRange(4 + i, 1, 1, TOTAL).setBackground(ST_BG[ro.bucket]);   // OFF เทา · SL แดง · ลา เหลือง
      else if (i % 2) sh.getRange(4 + i, 1, 1, TOTAL).setBackground('#f3f7fc');
      if (ro.bucket === 'ot_off') sh.getRange(4 + i, 9).setBackground('#fff3cd');  // highlight OT OFF
    }
    sh.getRange(4, 1, data.length, 4).setFontWeight('bold');
  }

  // Column widths
  [90, 90, 70, 140, 120, 50, 95, 95, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  for (var f2 = 0; f2 < MAXFL; f2++) {
    var b2 = B + f2 * F + 1;
    [120, 130, 52, 52, 52, 52].forEach(function (w, k) { sh.setColumnWidth(b2 + k, w); });
  }
  sh.setColumnWidth(TOTAL, 70);
  sh.setFrozenRows(3);
}

// ─── WEEKLY OT (>36h/week check) ────────────────────────────────────────────
var OT_WEEK_LIMIT = 36;

function rbWeekRange_(date) {
  var d = date.getDate();
  var startDay = Math.floor((d - 1) / 7) * 7 + 1;
  var daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return { startDay: startDay, endDay: Math.min(startDay + 6, daysInMonth) };
}

function rbWeeklyOT_(date) {
  var wr = rbWeekRange_(date);
  var upto = Math.min(date.getDate(), wr.endDay);
  var people = {}, daysRead = [];
  for (var day = wr.startDay; day <= upto; day++) {
    var dt = new Date(date.getFullYear(), date.getMonth(), day);
    var roster;
    try { roster = rbOpenTodayRoster_(dt); } catch (e) { continue; }
    var res;
    try { res = readRosterFromSpreadsheet(roster.ss); } catch (e2) { res = null; }
    if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e3) {} }
    if (!res) continue;
    daysRead.push(day);
    var ll = null;
    if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, dt); } catch (e4) {} }

    function tally(team, r) {
      if ((r.bucket !== 'working' && r.bucket !== 'ot_off') || !(r.ot > 0)) return;
      var key = r.id ? ('#' + r.id) : (String(r.name).toUpperCase() + '|' + team);
      if (!people[key]) people[key] = { name: r.name, team: team, pos: r.pos || '', daily: {}, total: 0 };
      people[key].daily[day] = Math.round(((people[key].daily[day] || 0) + r.ot) * 10) / 10;
      people[key].total += r.ot;
    }
    Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { tally(t, r); }); });
    if (ll && ll.totals.staff > 0) {
      Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { tally('LL·' + s, r); }); });
    }
  }
  var list = Object.keys(people).map(function (k) { people[k].total = Math.round(people[k].total * 10) / 10; return people[k]; })
    .sort(function (a, b) { return b.total - a.total; });
  return { startDay: wr.startDay, endDay: wr.endDay, daysRead: daysRead, people: list,
           over: list.filter(function (p) { return p.total > OT_WEEK_LIMIT; }) };
}

function rbWriteWeeklyOT_(ss, date, mon, tabName) {
  tabName = tabName || '⏱️ OT สัปดาห์';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var wk = rbWeeklyOT_(date);
  var dayCols = [];
  for (var d = wk.startDay; d <= wk.endDay; d++) dayCols.push(d);
  var W = 3 + dayCols.length + 2;

  sh.getRange(1, 1, 1, W).merge()
    .setValue('⏱️ OT รายสัปดาห์ (' + wk.startDay + '-' + wk.endDay + ' ' + mon + ')  •  เกิน ' + OT_WEEK_LIMIT +
              ' ชม./สัปดาห์: ' + wk.over.length + ' คน  •  อ่าน ' + wk.daysRead.length + ' วัน')
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center');
  sh.setRowHeight(1, 26);

  var head = ['ชื่อ', 'ทีม', 'ตำแหน่ง'].concat(dayCols.map(function (d) { return String(d); })).concat(['OT รวม/สัปดาห์', 'สถานะ']);
  sh.getRange(2, 1, 1, W).setValues([head]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center');

  var body = wk.people.map(function (p) {
    var row = [p.name, p.team, p.pos];
    dayCols.forEach(function (d) { row.push(p.daily[d] || ''); });
    var status = p.total > OT_WEEK_LIMIT ? '🔴 เกิน ' + OT_WEEK_LIMIT : (p.total >= 30 ? '🟡 ใกล้' : '');
    row.push(p.total, status);
    return row;
  });
  if (body.length) {
    sh.getRange(3, 1, body.length, W).setValues(body).setFontSize(9);
    for (var i = 0; i < wk.people.length; i++) {
      if (wk.people[i].total > OT_WEEK_LIMIT) sh.getRange(3 + i, 1, 1, W).setBackground('#fdecec');
      else if (wk.people[i].total >= 30) sh.getRange(3 + i, 1, 1, W).setBackground('#fff8e1');
    }
  } else {
    sh.getRange(3, 1, 1, W).merge().setValue('ยังไม่มีข้อมูล OT ในสัปดาห์นี้').setHorizontalAlignment('center');
  }
  [130, 90, 60].concat(dayCols.map(function () { return 40; })).concat([95, 90]).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
}

function runWeeklyOTReport(y, m, d) {
  var date = (y && m && d) ? new Date(y, m - 1, d) : new Date();
  var mon = MON_RB[date.getMonth()], be = date.getFullYear() + 543;
  var out = rbGetMonthlyOutput_(mon, be);
  var wr = rbWeekRange_(date);
  rbWriteWeeklyOT_(out, date, mon, '⏱️ OT ' + wr.startDay + '-' + wr.endDay + ' ' + mon);
  Logger.log('✅ Weekly OT: %s', out.getUrl());
  return out.getUrl();
}

// ─── GOOGLE CHAT ────────────────────────────────────────────────────────────
function rbPostChat_(res, dateStr, url, ll, master) {
  var webhook = PropertiesService.getScriptProperties().getProperty(CONFIG_RB.CHAT_WEBHOOK_PROP);
  if (!webhook) { Logger.log('⚠️ no webhook set in property %s', CONFIG_RB.CHAT_WEBHOOK_PROP); return; }
  var T = res.totals;
  var now = new Date();
  var hh = parseInt(Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Bangkok', 'HH'), 10);
  var clock = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Bangkok', 'HH:mm');
  var round = hh < 12 ? 'รอบเช้า ☀️' : 'รอบบ่าย 🌤️';
  var lines = [
    '📊 *Daily Manpower* — ' + dateStr + '  ·  ' + round + ' (' + clock + ')',
  ];
  if (master) {
    lines.push('👥 *พนักงานทั้งหมด (Active):* PSA ' + master.PSA.total + ' + LL ' + master.LL.total +
               ' = *' + (master.PSA.total + master.LL.total) + '* คน');
  }
  lines.push('🔵 *PSA* — 👥 *' + T.staff + '*  🟢 *' + (T.working + T.ot_off) + '*  ⬛ *' + T.off +
      '*  🤒 *' + T.sick + '*  🌴 *' + T.leave + '*  ⏰ *' + T.otPeople + '* (' + T.otHours + 'h)  ✈️ *' + T.flights + '*');
  if (ll && ll.totals.staff > 0) {
    var L = ll.totals;
    lines.push('🟡 *LL* — 👥 *' + L.staff + '*  🟢 *' + (L.working + L.ot_off) + '*  ⬛ *' + L.off +
      '*  🤒 *' + L.sick + '*  🌴 *' + L.leave + '*  ⏰ *' + L.otPeople + '* (' + L.otHours + 'h)');
    lines.push('🏢 *รวม PSA+LL working: *' + (T.working + T.ot_off + L.working + L.ot_off) + '* / ' + (T.staff + L.staff) + ' คน*');
  }
  var lt = (ll && ll.totals.staff) ? ll.totals : { otPre: 0, otPreHrs: 0, otPost: 0, otPostHrs: 0, ot_off: 0, otOffHrs: 0 };
  var oPre = T.otPre + lt.otPre, oPreH = Math.round((T.otPreHrs + lt.otPreHrs) * 10) / 10;
  var oPost = T.otPost + lt.otPost, oPostH = Math.round((T.otPostHrs + lt.otPostHrs) * 10) / 10;
  var oOff = T.ot_off + lt.ot_off, oOffH = Math.round((T.otOffHrs + lt.otOffHrs) * 10) / 10;
  lines.push('⏱️ *OT ก่อนกะ:* ' + oPre + ' คน (' + oPreH + 'h)  |  *OT หลังกะ:* ' + oPost + ' คน (' + oPostH +
             'h)  |  *OT OFF:* ' + oOff + ' คน (' + oOffH + 'h)');
  try {
    var ac = acAnalyze_(res, ll).summary;
    if (ac.bad || ac.warn) {
      lines.push('🧭 *ตรวจ Assign:* 🔴 ไฟลท์นอกเวลา/ขาด OT *' + ac.bad + '*  ·  🟡 ควรตรวจ *' + ac.warn +
                 '*  (OT อาจเกิน ' + ac.otMuch + ' · ช่วงว่าง ' + ac.gap + ')');
    }
  } catch (eac) { Logger.log('⚠️ AssignCheck: ' + eac.message); }
  lines.push('', '*Top teams (working):*');
  Object.keys(res.teams).sort(function (a, b) { return res.teams[b].working - res.teams[a].working; })
    .slice(0, 8).forEach(function (t) {
      var b = res.teams[t];
      lines.push('  • ' + t + ': ' + (b.working + b.ot_off) + '/' + b.staff + '  OT ' + b.otHours + 'h  ✈️' + b.flights);
    });
  if (url) lines.push('', '🔗 ' + url);
  UrlFetchApp.fetch(webhook, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: lines.join('\n') }), muteHttpExceptions: true,
  });
}

// ─── DRIVE NAVIGATION (find today's roster, convert xlsx if needed) ─────────
function rbOpenTodayRoster_(date) {
  var dd = ('0' + date.getDate()).slice(-2);
  var mon = MON_RB[date.getMonth()];
  var mm = ('0' + (date.getMonth() + 1)).slice(-2);
  var yr2 = String(date.getFullYear()).slice(2);

  var year = DriveApp.getFolderById(CONFIG_RB.ROOT_FOLDER_ID);
  var monthFolder = rbFindMonthFolder_(year, mm, mon, yr2, date.getFullYear()) || year;
  var file = rbFindDayFile_(monthFolder, dd, mon, yr2);
  if (!file) throw new Error('ไม่พบไฟล์ roster ของวันที่ ' + dd + ' ' + mon + ' ใน ' + monthFolder.getName());

  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return { ss: SpreadsheetApp.openById(file.getId()), tempId: null, fileName: file.getName() };
  }
  var tmp = Drive.Files.copy({ title: '_TEMP_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
                             file.getId(), { convert: true });
  return { ss: SpreadsheetApp.openById(tmp.id), tempId: tmp.id, fileName: file.getName() };
}

function rbFindMonthFolder_(parent, mm, mon, yr2, year) {
  var pats = [
    new RegExp('^' + mm + '\\.?\\s*' + mon + yr2 + '$', 'i'),
    new RegExp('^' + mon + '\\s*' + yr2 + '$', 'i'),
    new RegExp('^' + mon + '\\s*' + year + '$', 'i'),
    new RegExp(mon, 'i'),
  ];
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next(), nm = f.getName();
    for (var p = 0; p < pats.length; p++) if (pats[p].test(nm)) return f;
  }
  return null;
}

function rbFindDayFile_(folder, dd, mon, yr2) {
  var d = parseInt(dd, 10);
  var pats = [
    new RegExp('^' + dd + '\\s*' + mon + yr2 + '(\\.|$| )', 'i'),
    new RegExp('^' + dd + '\\s*' + mon + '(\\.|$| )', 'i'),
    new RegExp('^' + d + '\\s*' + mon + '(\\.|$| )', 'i'),
    new RegExp('^' + dd + '\\s*' + mon, 'i'),
    new RegExp('^' + d + '\\s*' + mon, 'i'),
  ];
  var best = null;
  ['application/vnd.google-apps.spreadsheet',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].forEach(function (mime) {
    var it = folder.getFilesByType(mime);
    while (it.hasNext()) {
      var f = it.next(), nm = f.getName();
      for (var p = 0; p < pats.length; p++) {
        if (pats[p].test(nm) && (!best || p < best.p)) best = { f: f, p: p };
      }
    }
  });
  return best ? best.f : null;
}

function rbGetMonthlyOutput_(mon, be) {
  var name = 'Roster Report ' + mon + ' ' + be;
  var folder = null;
  if (CONFIG_RB.OUTPUT_FOLDER_ID) {
    try { folder = DriveApp.getFolderById(CONFIG_RB.OUTPUT_FOLDER_ID); }
    catch (e) { Logger.log('⚠️ OUTPUT_FOLDER_ID เข้าไม่ได้ (' + e.message + ') → สร้างไฟล์ใน My Drive แทน'); }
  }
  var it = folder ? folder.getFilesByName(name) : DriveApp.getFilesByName(name);
  if (it.hasNext()) return SpreadsheetApp.openById(it.next().getId());
  var ss = SpreadsheetApp.create(name);
  if (folder) {
    try {
      var file = DriveApp.getFileById(ss.getId());
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (e2) { Logger.log('⚠️ ย้ายไฟล์เข้าโฟลเดอร์ไม่ได้: ' + e2.message); }
  }
  return ss;
}

var AOTGA_LOGO_URL = '';
var CI = { royal:'#1D428A', bosch:'#236192', sky:'#4EC3E0', teal:'#3FBCBE', yellow:'#FEC909', red:'#D92526', grey:'#7C878F', good:'#1BA37A', sub:'#5a6b86' };
var MONW = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
var DOWW = ['อา','จ','อ','พ','พฤ','ศ','ส'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.ping) {  // deployment self-test: /exec?ping=1
    return HtmlService.createHtmlOutput('<body style="font-family:sans-serif;padding:30px">✅ Web app OK · ' + new Date() + '</body>');
  }
  var date = new Date();
  if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) { var a = p.date.split('-'); date = new Date(+a[0], +a[1]-1, +a[2]); }
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var iso = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  var base = ''; try { base = ScriptApp.getService().getUrl() || ''; } catch (eb) {}
  var html;
  try {
    var d = rbLoadResLL_(date);
    var master = null;
    if (MASTER_FILE_ID_RB) { try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e4) {} }
    html = rbBuildDashboardHtml_(d.res, d.ll, master, date, iso, base, tz);
  } catch (err) {
    html = '<!doctype html><html><head><meta charset="utf-8"><style>' + rbDesignCss_() + '</style></head>' +
      '<body><div class="wrap">' + rbWeekNav_(date, iso, base, tz) +
      '<div class="panel" style="text-align:center;padding:40px"><h2>⚠️ ไม่มีข้อมูลของวันที่ ' + rbEsc_(iso) + '</h2>' +
      '<p class="muted" style="margin-top:8px">' + rbEsc_(err.message) + '</p>' +
      '<p class="muted">ยังไม่มีไฟล์ assignment ของวันนี้ หรือบัญชีไม่มีสิทธิ์ — เลือกวันอื่นจากแถบด้านบน</p></div></div></body></html>';
  }
  return HtmlService.createHtmlOutput(html).setTitle('AOTGA · Manpower Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function rbLoadResLL_(date) {
  var roster = rbOpenTodayRoster_(date);
  var res = readRosterFromSpreadsheet(roster.ss);
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }
  var ll = null;
  if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e2) {} }
  return { res: res, ll: ll };
}
function rbDateFromIso_(iso) { var a = String(iso).split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }

function rbTimetableHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    return rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
      '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
      rbTtRows_(d.res, d.ll),
      rbCtrls_('view-tt', true));
  } catch (e) { return '<div class="panel">โหลด Timetable ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbFlightsHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    return rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>ส่ง/ต้องการ</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th><th>สถานะ</th></tr>',
      rbFltRows_(d.res, d.ll), rbCtrls_('view-flt', true));
  } catch (e) { return '<div class="panel">โหลด Flights ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbAssignHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var an = acAnalyze_(d.res, d.ll), s = an.summary;
    var hd = '<div class="sectionlabel">ตรวจ <b>' + s.checked + '</b>/' + s.working +
      ' คนที่มาทำงาน · <b class="badd">🔴 ไฟลท์นอกเวลา/ขาด OT ' + s.bad + '</b> · 🟡 ควรตรวจ ' + s.warn +
      ' · OT อาจเกิน ' + s.otMuch + ' · มีช่วงว่าง ' + s.gap +
      ' · <span class="muted">ไม่มีไฟลท์ ' + s.noFlt + ' (bench/standby)</span>' +
      (s.noWin ? ' · (ไม่มีเวลากะระบุ ' + s.noWin + ' — ข้าม)' : '') + '</div>';
    var rows = an.rows.map(function (r) {
      var emo = r.status === 'bad' ? '🔴' : '🟡';
      return '<tr class="' + (r.status === 'bad' ? 'rowbad' : '') + '" data-team="' + rbEsc_(r.team) + '"><td>' + emo + '</td><td class="b">' +
        rbEsc_(r.team) + '</td><td class="tnum">' + rbEsc_(r.id || '') + '</td><td>' + rbEsc_(r.name) + '</td><td>' + rbEsc_(r.pos) + '</td><td class="tnum">' +
        rbEsc_(r.shift) + '</td><td>' + (r.ot && r.ot !== '-' ? rbEsc_(r.ot) : '<span class="muted">—</span>') + '</td><td>' + rbEsc_(r.flights) + '</td><td>' +
        (rbEsc_(r.job) || '<span class="muted">—</span>') + '</td><td class="' + (r.uncovered ? 'badd' : 'muted') + '">' +
        (rbEsc_(r.uncovered) || '—') + '</td><td>' + (rbEsc_(r.gaps) || '<span class="muted">—</span>') + '</td><td>' +
        (rbEsc_(r.otVerdict) || '<span class="muted">—</span>') + '</td><td>' + rbEsc_(r.issue) + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="13" class="okk" style="text-align:center;padding:20px">✅ ไม่พบการ Assign ที่ผิดปกติ — ทุกคนเวลากะครอบคลุมไฟลท์และ OT เหมาะสม</td></tr>';
    return hd + rbTblCard_('🧭 ตรวจความเหมาะสมการ Assign รายคน',
      '<tr><th>สถานะ</th><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>ไฟลท์</th><th>ไฟลท์ที่ทำ</th>' +
      '<th>ไฟลท์นอกเวลา</th><th>ช่วงว่าง</th><th>OT เหมาะสม?</th><th>ปัญหา/คำแนะนำ</th></tr>',
      rows, rbCtrls_('view-ac', true));
  } catch (e) { return '<div class="panel">โหลดตรวจ Assign ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbEsc_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function rbAttr_(s){ return rbEsc_(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function rbOtTxt_(n,h){ return n>0 ? (n+' <span class="muted">('+h+'h)</span>') : '·'; }

function rbPlanChip_(p) {
  var busyCls = p.n >= 5 ? ' sup--busy' : (p.n === 0 ? ' sup--free' : '');
  return '<span class="chip chip--duty supchip planchip' + busyCls + '"' +
    ' data-nm="' + rbAttr_(p.name) + '" data-pos="' + rbAttr_(p.pos) + '" data-pteam="' + rbAttr_(p.team) + '"' +
    ' data-shift="' + rbAttr_(p.shift || '-') + '" data-ot="' + rbAttr_(p.ot || '-') + '" data-hrs="' + (p.hrs || 0) + '" data-n="' + (p.n || 0) + '"' +
    ' data-flts="' + rbAttr_((p.flts || []).join('‖')) + '">' +
    '<span class="editnm" contenteditable="true" spellcheck="false" onclick="event.stopPropagation()"' +
    ' oninput="var c=this.closest(\'.supchip\');c.dataset.nm=this.textContent;c.classList.add(\'edited\')" title="คลิกเพื่อแก้ไขชื่อ">' + rbEsc_(p.name) + '</span>' +
    '<span class="planchip__i" onclick="showPsn(this.closest(\'.supchip\'))" title="ดูงาน/OT/ไฟลท์ที่ทำ"> ' + rbEsc_(p.pos) + ' ⓘ</span></span>';
}

function rbPlanNames_(arr) {
  if (!arr || !arr.length) return '<span class="muted">—</span>';
  var by = {}, order = [];
  arr.forEach(function (p) { if (!by[p.team]) { by[p.team] = []; order.push(p.team); } by[p.team].push(p); });
  return order.map(function (t) {
    return '<span class="supgrp"><span class="supgrp__t">' + rbEsc_(t) + ' ' + by[t].length + '</span>' +
      by[t].map(rbPlanChip_).join('') + '</span>';
  }).join('');
}

function rbFillPlanHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var gaps = apFillGaps_(d.res, d.ll);
    var filledN = 0, remainN = 0;
    gaps.forEach(function (g) { filledN += g.picked.length; remainN += g.remain; });
    var hd = '<div class="sectionlabel" style="background:#eef6ff;border-left:4px solid #1f4e79;padding:8px 12px;border-radius:8px">📋 <b>เติมจาก Assign เดิม</b> — จัดคนว่างข้ามทีมมาเสริมไฟลท์ที่ขาด · เสริม <b class="okk">' + filledN + ' คน</b>' +
      (remainN ? ' · <b class="badd">ยังขาด ' + remainN + ' คน</b>' : ' · ครบ ✅') + ' <span class="muted">(คลิกชื่อเพื่อแก้ไข · คลิก ⓘ ดูงาน/OT/ไฟลท์)</span></div>';
    var bodyA = gaps.map(function (g) {
      var who = g.picked.length ? rbPlanNames_(g.picked) : '<span class="badd">' + (g.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + rbEsc_(g.needSys) : 'ไม่มีคนว่าง') + '</span>';
      var st = g.remain === 0 ? '<span class="okk">✅ เติมครบ</span>' : (g.picked.length ? '<span class="badd">⚠️ ยังขาด ' + g.remain + '</span>' : '<span class="badd">🔴 ขาด ' + g.remain + '</span>');
      return '<tr class="' + (g.remain ? 'rowbad' : '') + '" data-team="' + rbEsc_(g.airline) + '"><td class="b">' + rbEsc_(g.flight) +
        '</td><td>' + rbEsc_(g.airline) + '</td><td class="tnum">' + rbEsc_(g.std) + '</td><td class="badd">' + rbEsc_(g.phase) + ' ขาด ' + g.need +
        '</td><td class="tnum">' + rbEsc_(g.win) + '</td><td>' + rbEsc_(g.needSys || 'iPort/ใดก็ได้') + '</td><td>' + who + '</td><td>' + st + '</td></tr>';
    }).join('');
    if (!bodyA) bodyA = '<tr><td colspan="8" class="okk" style="text-align:center;padding:20px">✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA แล้ว — ไม่ต้องเสริม</td></tr>';
    return hd + rbTblCard_('🤖 เติมคนเสริมไฟลท์ที่ขาด (ข้ามทีม)',
      '<tr><th>Flight</th><th>สายการบิน</th><th>STD/STA</th><th>ตำแหน่งที่ขาด</th><th>ช่วงเวลา</th><th>ระบบที่ต้องใช้</th><th>คนที่จัดให้</th><th>สถานะ</th></tr>',
      bodyA, rbCtrls_('view-fill', true));
  } catch (e) { return '<div class="panel">โหลด "เติม Assign เดิม" ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbAutoAssignHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rp = apReplan_(d.res, d.ll);
    var shortF = 0;
    rp.plan.forEach(function (p) { if (Object.keys(p.shortx).length) shortF++; });
    var hd = '<div class="sectionlabel" style="background:#eef6ff;border-left:4px solid #1f4e79;padding:8px 12px;border-radius:8px">📋 <b>Auto Assign</b> — จัดเวรใหม่ทั้งหมดตาม SLA · จัดคน <b>' + rp.nAssigned + '/' + rp.nPeople +
      '</b> ลง <b>' + rp.nFlights + '</b> ไฟลท์ · พัก ' + rp.bench.length + ' คน' + (shortF ? ' · <b class="badd">' + shortF + ' ไฟลท์ยังขาด</b>' : ' · ครบ ✅') +
      ' <span class="muted">(คลิกชื่อเพื่อแก้ไข · คลิก ⓘ ดูงาน/OT/ไฟลท์)</span></div>';
    function cellB(arr, req, shortN) {
      if (!req) return '<span class="muted">— ไม่มี</span>';                // เช่น PG ไม่มีเช็คอิน
      return '<div><b>' + arr.length + '/' + req + '</b> ' + (shortN ? '<span class="badd">⚠️-' + shortN + '</span>' : '<span class="okk">✓</span>') +
        '</div>' + rbPlanNames_(arr);
    }
    var bodyB = rp.plan.map(function (p) {
      var ok = Object.keys(p.shortx).length === 0;
      return '<tr class="' + (ok ? '' : 'rowbad') + '" data-team="' + rbEsc_(p.airline) + '"><td class="b">' + rbEsc_(p.flight) +
        '</td><td>' + rbEsc_(p.airline) + '</td><td>' + rbEsc_(p.system || 'iPort') + '</td><td class="tnum">' + rbEsc_(p.sta) + '</td><td class="tnum">' + rbEsc_(p.std) +
        '</td><td>' + cellB(p.assign.SUP, p.phaseReq.SUP, p.shortx.SUP) + '</td><td>' + cellB(p.assign.CI, p.phaseReq.CI, p.shortx.CI) +
        '</td><td>' + cellB(p.assign.GATE, p.phaseReq.GATE, p.shortx.GATE) + '</td><td>' + cellB(p.assign.ARR, p.phaseReq.ARR, p.shortx.ARR) + '</td></tr>';
    }).join('');
    if (!bodyB) bodyB = '<tr><td colspan="9" class="muted" style="text-align:center;padding:20px">— ไม่มีไฟลท์</td></tr>';
    var tblB = rbTblCard_('🤖 จัดเวรใหม่ทั้งหมดตาม SLA',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ระบบ</th><th>STA</th><th>STD</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th></tr>',
      bodyB, rbCtrls_('view-auto', true));

    var benchHtml = '';
    if (rp.bench.length) {
      var by = {}, ord = [];
      rp.bench.forEach(function (b) { if (!by[b.team]) { by[b.team] = []; ord.push(b.team); } by[b.team].push(b); });
      benchHtml = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>😴 คนพัก/สำรอง (ยังไม่ถูกจัด) — ' + rp.bench.length + ' คน</h3></div>' +
        '<div style="padding:10px 14px">' + ord.map(function (t) {
          return '<span class="supgrp"><span class="supgrp__t">' + rbEsc_(t) + ' ' + by[t].length + '</span>' +
            by[t].map(function (p) { return '<span class="chip">' + rbEsc_(p.name) + ' <span class="muted">' + rbEsc_(p.pos) + '</span></span>'; }).join('') + '</span>';
        }).join('') + '</div></div>';
    }
    return hd + tblB + benchHtml;
  } catch (e) { return '<div class="panel">โหลด "Auto Assign" ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbSupportHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rows = slaSupportRows_(d.res, d.ll);
    var nF = {}, supTeams = {};
    rows.forEach(function (r) { nF[r.flight] = 1; r.cands.forEach(function (c) { supTeams[c.team] = 1; }); });
    var hd = '<div class="sectionlabel">ไฟลท์ที่คนไม่ครบตาม SLA: <b class="badd">' + Object.keys(nF).length +
      ' ไฟลท์</b> · ตำแหน่งที่ขาด ' + rows.length + ' รายการ — แนะนำคนที่ <b>ว่างช่วงนั้น + รู้ระบบเช็คอิน</b></div>';
    // แถบเลือกหลายทีม: เลือกได้ว่าจะดึงคนจากทีมไหนมาช่วย (คลิกสลับเปิด/ปิด)
    var teamBar = Object.keys(supTeams).sort().map(function (t) {
      return '<button class="supteam on" data-t="' + rbEsc_(t) + '" onclick="toggleSupTeam(this)">' + rbEsc_(t) + '</button>';
    }).join('');
    if (teamBar) teamBar = '<div class="supbar"><b>เลือกทีมที่จะดึงมาช่วย:</b> ' + teamBar +
      ' <button class="supteam supall" onclick="allSupTeams(this)">ทั้งหมด</button>' +
      '<span class="muted" style="font-size:12px">— ถ้าทีมที่เลือกไม่พอ ระบบเติม <span class="sup--sub" style="padding:1px 6px;border-radius:6px">↪ ทดแทน</span> จากทีมอื่นให้ครบจำนวนที่ขาด</span></div>';
    var body = rows.map(function (r) {
      var who = r.cands.length
        ? '<div class="supwrap" data-need="' + r.shortN + '">' + slaGroupCands_(r.cands).map(function (g) {
            return '<span class="supgrp"><span class="supgrp__t">' + rbEsc_(g.team) + ' ' + g.people.length + '</span>' +
              g.people.map(function (p) {
                var busyCls = p.n >= 5 ? ' sup--busy' : (p.n === 0 ? ' sup--free' : '');
                return '<span class="chip chip--duty supchip' + busyCls + '" data-cteam="' + rbEsc_(g.team) + '" onclick="showPsn(this)"' +
                  ' data-nm="' + rbAttr_(p.name) + '" data-pos="' + rbAttr_(p.pos) + '" data-pteam="' + rbAttr_(g.team) + '"' +
                  ' data-shift="' + rbAttr_(p.shift) + '" data-ot="' + rbAttr_(p.ot) + '" data-hrs="' + p.hrs + '" data-n="' + p.n + '"' +
                  ' data-flts="' + rbAttr_((p.flts || []).join('‖')) + '">' + rbEsc_(p.name) + ' <span class="muted">' + rbEsc_(p.pos) + '</span></span>';
              }).join('') + '</span>';
          }).join('') + '</div>'
        : '<span class="badd">' + (r.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + rbEsc_(r.needSys) : 'ไม่มีคนว่าง') + '</span>';
      return '<tr class="' + (r.cands.length ? '' : 'rowbad') + '" data-team="' + rbEsc_(r.team) + '"><td class="b">' + rbEsc_(r.flight) +
        '</td><td>' + rbEsc_(r.airline) + '</td><td>' + rbEsc_(r.system || '-') + '</td><td>' + rbEsc_(r.team) + '</td><td class="tnum">' + rbEsc_(r.STD) +
        '</td><td class="badd">' + rbEsc_(r.phase) + ' ขาด ' + r.shortN + (r.needSys ? ' <span class="muted">(' + rbEsc_(r.needSys) + ')</span>' : '') +
        '</td><td class="tnum">' + rbEsc_(r.win) + '</td><td>' + who + '</td></tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="8" class="okk" style="text-align:center;padding:20px">✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA</td></tr>';
    return hd + teamBar + rbTblCard_('🆘 ไฟลท์คนไม่ครบ + คนที่มาช่วยได้ (จัดกลุ่มตามทีม)',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ระบบเช็คอิน</th><th>ทีม</th><th>STD</th><th>ตำแหน่งที่ขาด</th><th>ช่วงเวลา</th><th>คนที่มาช่วยได้ (เลือกทีมด้านบน)</th></tr>',
      body, rbCtrls_('view-sup', true));
  } catch (e) { return '<div class="panel">โหลด Support ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbCtrls_(viewId, withSearch){
  return (withSearch ? '<input class="search" placeholder="🔎 ค้นหา" oninput="applyFilter(\''+viewId+'\')">' : '') +
    '<select class="teamsel" onchange="applyFilter(\''+viewId+'\')"><option value="">ทุกทีม</option></select>';
}

// ── header + week nav + tabs ────────────────────────────────────────────────
function rbAppbar_(date) {
  var be = date.getFullYear()+543;
  return '<div class="appbar rise"><div class="appbar__row">' +
    '<div class="brand"><div class="brand__mark">✈</div><div><h1>AOT<span>GA</span></h1>' +
    '<p>Passenger Services · การโดยสาร</p></div></div>' +
    '<div class="appbar__meta"><div class="datepill"><div class="d tnum">' + date.getDate()+' '+MONW[date.getMonth()]+' '+be +
    '</div><div class="s">Daily Manpower · ตารางกำลังพลรายวัน</div></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">' +
    '<div class="livedot"><i></i>Live</div>' +
    '<button class="btn btn--accent" onclick="window.print()">⬇ Export PDF</button></div></div></div></div>';
}
function rbWeekNav_(date, iso, base, tz) {
  var chips = [];
  for (var off=-7; off<=7; off++) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate()+off);
    var i = Utilities.formatDate(d, tz||'Asia/Bangkok', 'yyyy-MM-dd');
    chips.push('<a class="wk' + (i===iso?' sel':'') + '" href="' + (base||'') + '?date=' + i + '" target="_top">' +
      '<span class="wd">' + DOWW[d.getDay()] + '</span><span class="wn tnum">' + d.getDate() + '</span>' +
      '<span class="wm">' + MONW[d.getMonth()] + '</span></a>');
  }
  var prev = new Date(date.getFullYear(),date.getMonth(),date.getDate()-1);
  var next = new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
  function u(d){ return (base||'') + '?date=' + Utilities.formatDate(d, tz||'Asia/Bangkok','yyyy-MM-dd'); }
  return '<div class="weeknav"><div class="weeknav__date">' +
    '<a class="iconbtn" href="' + u(prev) + '" target="_top">‹</a>' +
    '<a class="iconbtn" href="' + u(next) + '" target="_top">›</a></div>' +
    '<div class="weeknav__strip">' + chips.join('') + '</div></div>';
}
function rbTabs_(shortCount, acCount) {
  return '<div class="tabs">' +
    '<button class="tab active" id="tab-dash" onclick="showView(\'dash\')">▦ Dashboard</button>' +
    '<button class="tab" id="tab-tt" onclick="showView(\'tt\');loadTT()">☰ Timetable</button>' +
    '<button class="tab" id="tab-flt" onclick="showView(\'flt\');loadFlt()">✈ Flights &amp; SLA' +
    (shortCount ? '<span class="badge tnum">' + shortCount + '</span>' : '') + '</button>' +
    '<button class="tab" id="tab-sup" onclick="showView(\'sup\');loadSup()">🆘 Support' +
    (shortCount ? '<span class="badge tnum">' + shortCount + '</span>' : '') + '</button>' +
    '<button class="tab" id="tab-ac" onclick="showView(\'ac\');loadAC()">🧭 ตรวจ Assign' +
    (acCount ? '<span class="badge tnum">' + acCount + '</span>' : '') + '</button>' +
    '<button class="tab" id="tab-fill" onclick="showView(\'fill\');loadFill()">🤖 เติม Assign เดิม</button>' +
    '<button class="tab" id="tab-auto" onclick="showView(\'auto\');loadAuto()">🤖 Auto Assign</button>' +
    '<button class="tab" id="tab-adv" onclick="showView(\'adv\');loadAdv()">📅 จัดล่วงหน้า</button>' +
    '<button class="tab" id="tab-ot" onclick="showView(\'ot\');loadOT()">⏱️ OT สัปดาห์</button></div>';
}

function rbWeeklyOTHtml(iso) {
  try {
    var a = String(iso).split('-');
    var date = new Date(+a[0], +a[1] - 1, +a[2]);
    var wk = rbWeeklyOT_(date);
    var dayCols = [];
    for (var d = wk.startDay; d <= wk.endDay; d++) dayCols.push(d);
    var th = '<tr><th>ชื่อ</th><th>ทีม</th><th>ตำแหน่ง</th>' +
      dayCols.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '<th>OT รวม/สัปดาห์</th><th>สถานะ</th></tr>';
    var rows = wk.people.map(function (p) {
      var tds = dayCols.map(function (x) { return '<td class="tnum">' + (p.daily[x] || '') + '</td>'; }).join('');
      var status = p.total > OT_WEEK_LIMIT ? '<span class="badd">🔴 เกิน ' + OT_WEEK_LIMIT + '</span>'
                 : (p.total >= 30 ? '<span class="muted">🟡 ใกล้</span>' : '');
      return '<tr class="' + (p.total > OT_WEEK_LIMIT ? 'rowbad' : '') + '" data-team="' + rbEsc_(p.team) + '"><td class="b">' + rbEsc_(p.name) + '</td><td>' +
        rbEsc_(p.team) + '</td><td>' + rbEsc_(p.pos) + '</td>' + tds + '<td class="tnum"><b>' + p.total + 'h</b></td><td>' + status + '</td></tr>';
    }).join('');
    var hd = '<div class="sectionlabel">สัปดาห์ ' + wk.startDay + '-' + wk.endDay + ' · อ่าน ' + wk.daysRead.length +
      ' วัน · <b class="badd">เกิน ' + OT_WEEK_LIMIT + ' ชม.: ' + wk.over.length + ' คน</b></div>';
    return hd + '<div class="tablecard"><div class="tablecard__hd"><h3>⏱️ OT รายสัปดาห์ (เกิน ' + OT_WEEK_LIMIT + ' ชม./สัปดาห์)</h3>' + rbCtrls_('view-ot', true) + '</div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead>' + th + '</thead><tbody>' +
      (rows || '<tr><td colspan="' + (dayCols.length + 5) + '" class="muted">ยังไม่มีข้อมูล OT ในสัปดาห์นี้</td></tr>') +
      '</tbody></table></div></div>';
  } catch (e) { return '<div class="panel">โหลด OT รายสัปดาห์ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

// ── KPI hero ────────────────────────────────────────────────────────────────
function rbKpiHero_(C, master) {
  var attPct = C.staff>0 ? Math.round((C.working)/C.staff*100) : 0;
  var avg = C.otPeople>0 ? Math.round(C.otHours/C.otPeople*10)/10 : 0;
  var defs = [
    ['👥', CI.royal, C.staff, '', 'Total Staff', 'พนักงานทั้งหมด', master ? ('+'+(master.PSA.total+master.LL.total)+' active') : ''],
    ['✅', CI.good, C.working, '', 'Working', 'มาปฏิบัติงาน', attPct+'% attendance'],
    ['⬛', CI.grey, C.off, '', 'OFF', 'วันหยุด', ''],
    ['🟡', CI.yellow, C.ot_off, '', 'OT OFF (XX)', 'ทำ OT วันหยุด', C.otOffHrs+'h'],
    ['⏰', CI.red, C.otPeople, '', 'OT · People', 'พนักงานทำ OT', 'รวมทั้งกะ'],
    ['⏱️', CI.bosch, C.otHours, 'h', 'OT · Hours', 'ชั่วโมง OT รวม', avg+'h เฉลี่ย/คน'],
  ];
  return '<div class="kpis rise">' + defs.map(function (d) {
    return '<div class="kpi" style="--c:' + d[1] + '"><div class="kpi__top">' +
      '<div class="kpi__ico" style="--c:' + d[1] + '">' + d[0] + '</div>' +
      (d[6] ? '<div class="kpi__trend">' + rbEsc_(d[6]) + '</div>' : '') + '</div>' +
      '<div class="kpi__val tnum">' + d[2] + (d[3]||'') + '</div>' +
      '<div class="kpi__lbl">' + d[4] + '</div><div class="kpi__sub">' + d[5] + '</div></div>';
  }).join('') + '</div>';
}

// ── table rows ──────────────────────────────────────────────────────────────
function rbBarMini_(pct){ return '<div class="barmini"><i style="width:'+pct+'%"></i><b>'+pct+'%</b></div>'; }
function rbAggRowHtml_(label, b) {
  var work = b.working + b.ot_off, pct = b.staff>0 ? Math.round(work/b.staff*100) : 0;
  return '<tr><td class="b">' + rbEsc_(label) + '</td><td class="tnum">' + b.staff + '</td><td class="tnum"><b>' + work +
    '</b></td><td class="tnum">' + b.off + '</td><td class="tnum">' + b.leave + '</td><td class="tnum">' + rbOtTxt_(b.ot_off, b.otOffHrs) +
    '</td><td class="tnum">' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td class="tnum">' + rbOtTxt_(b.otPost, b.otPostHrs) +
    '</td><td style="min-width:90px">' + rbBarMini_(pct) + '</td></tr>';
}
function rbTeamRows_(teams, order){ return order.map(function(t){ return rbAggRowHtml_(t, teams[t]); }).join(''); }
function rbPosRows_(positions, order) {
  return order.map(function (p) {
    var b = positions[p]; if (!b) return '';
    return '<tr><td class="b">' + p + '</td><td class="tnum">' + b.staff + '</td><td class="tnum"><b>' + (b.working + b.ot_off) +
      '</b></td><td class="tnum">' + rbOtTxt_(b.ot_off, b.otOffHrs) + '</td><td class="tnum">' + b.off + '</td><td class="tnum">' + b.sick +
      '</td><td class="tnum">' + b.leave + '</td><td class="tnum">' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td class="tnum">' +
      rbOtTxt_(b.otPost, b.otPostHrs) + '</td></tr>';
  }).join('');
}
function rbFlightChips_(assigns, team, owner) {
  if (!assigns || !assigns.length) return '<span class="muted">—</span>';
  var chips = assigns.map(function (a) {
    var t = a.task ? (' <span class="tag">'+rbEsc_(a.task)+'</span>') : '';
    var sta = (a.STA||a.STD) ? (' '+(a.STA||'–')+'/'+(a.STD||'–')) : '';
    var op = (a.OP||a.CL) ? (' <span class="muted">'+(a.OP||'–')+'-'+(a.CL||'–')+'</span>') : '';
    var isFl = acIsFlight_(a.flight);
    var sup = isFl && owner && team && !slaSkipTeam_(team) && owner[slaAirlineOf_(a.flight)] && owner[slaAirlineOf_(a.flight)] !== team;
    var cls = !isFl ? 'chip chip--duty' : (sup ? 'chip chip--sup' : 'chip');   // ซัพพอร์ตข้ามทีม = ส้ม
    return '<span class="'+cls+'" style="cursor:default">' + rbEsc_(a.flight) + (sup ? ' 🔁' : '') + t + sta + op + '</span>';
  }).join('');
  return '<div class="chipgroup">' + chips + '</div>';      // flex-wrap container กันชิปซ้อนกัน
}
function rbFltCount_(assigns) {                              // นับเฉพาะรหัสไฟลท์จริง (ให้ตรงกับแท็บตรวจ Assign)
  return (assigns || []).filter(function (a) { return acIsFlight_(a.flight); }).length;
}
function rbTtRows_(res, ll) {
  var rows = [];
  var owner = acOwnerTeams_(res, ll);   // ทีมเจ้าของแต่ละสายการบิน (ไว้มาร์คไฟลท์ซัพพอร์ตข้ามทีม)
  Object.keys(res.teams).forEach(function (t){ res.teams[t].records.forEach(function(r){ rows.push(r); }); });
  if (ll && ll.totals.staff>0) Object.keys(ll.sections).forEach(function(s){ ll.sections[s].records.forEach(function(r){ rows.push(r); }); });
  var ord={working:0,ot_off:1,off:2,vac:3,sick:4};
  rows.sort(function(a,b){ return String(a.team).localeCompare(String(b.team)) || ((ord[a.bucket]||0)-(ord[b.bucket]||0)) || ((a.shiftStart==null?99999:a.shiftStart)-(b.shiftStart==null?99999:b.shiftStart)); });
  var STLB={off:'⬛ OFF',sick:'🔴 SL (ป่วย)',vac:'🌴 ลา'}, STCLS={off:'row-off',sick:'row-sl',vac:'row-vac'};
  return rows.map(function (r) {
    var st = r.shiftStart==null?99999:r.shiftStart;
    var lbl = STLB[r.bucket];
    if (lbl) {   // OFF / SL / ลา — แสดงสถานะ ไฮไลท์สี ไม่มีไฟลท์/OT
      return '<tr class="'+STCLS[r.bucket]+'" data-team="'+rbEsc_(r.team)+'" data-start="'+st+'"><td class="b">'+rbEsc_(r.team)+
        '</td><td class="tnum">'+rbEsc_(r.id||'')+'</td><td>'+rbEsc_(r.name)+'</td><td>'+rbEsc_(r.pos||'')+'</td><td class="b">'+lbl+
        '</td><td class="muted">—</td><td class="tnum">0</td><td class="muted">—</td></tr>';
    }
    var sh = rbEsc_(r.shift||'') + (r.shiftTime&&r.shiftTime!==r.shift ? ' <span class="muted">'+r.shiftTime+'</span>' : '');
    var ot = r.ot ? ((r.bucket==='ot_off'?'<span class="tag">OFF</span>':(r.otType==='PRE'?'<span class="tag">ก่อน</span>':'<span class="tag">หลัง</span>'))+' '+(r.otTime||'')+' <span class="muted">('+r.ot+'h)</span>') : '<span class="muted">—</span>';
    return '<tr data-team="'+rbEsc_(r.team)+'" data-start="'+st+'"><td class="b">'+rbEsc_(r.team)+'</td><td class="tnum">'+rbEsc_(r.id||'')+
      '</td><td>'+rbEsc_(r.name)+'</td><td>'+rbEsc_(r.pos||'')+'</td><td>'+sh+'</td><td>'+ot+'</td><td class="tnum">'+rbFltCount_(r.assignments)+
      '</td><td>'+rbFlightChips_(r.assignments, r.team, owner)+'</td></tr>';
  }).join('');
}
function rbFltRows_(res, ll) {
  return slaCollectFlights_(res, ll).map(function (f) {
    function c(ph){ return '<td class="tnum '+(f.short[ph]?'badd':'okk')+'">'+f.assigned[ph]+'/'+f.req[ph]+(f.short[ph]?' ▼'+f.short[ph]:'')+'</td>'; }
    var st = f.ok ? '<span class="okk">✅ ครบ</span>' : '<span class="badd">⚠️ '+rbEsc_(slaShortText_(f))+'</span>';
    return '<tr class="'+(f.ok?'':'rowbad')+'" data-team="'+rbEsc_(f.teamList)+'"><td class="b">'+rbEsc_(f.flight)+'</td><td>'+f.airline+'</td><td>'+rbEsc_(f.teamList)+
      '</td><td class="tnum">'+(f.STA||'')+'</td><td class="tnum">'+(f.STD||'')+'</td><td class="tnum"><b>'+f.assigned.total+'</b>/'+f.req.total+'</td>'+
      c('SUP')+c('CI')+c('GATE')+c('ARR')+'<td>'+st+'</td></tr>';
  }).join('');
}

function rbTblCard_(title, headHtml, bodyHtml, extraHd) {
  return '<div class="tablecard"><div class="tablecard__hd"><h3>'+title+'</h3>'+(extraHd||'')+'</div>' +
    '<div style="overflow-x:auto"><table class="tbl"><thead>'+headHtml+'</thead><tbody>'+bodyHtml+'</tbody></table></div></div>';
}

function rbBuildDashboardHtml_(res, ll, master, date, iso, base, tz, staticMode) {
  var P = res.totals, L = ll && ll.totals.staff>0 ? ll.totals : null;
  function comb(k){ return P[k] + (L?L[k]:0); }
  var C = { staff:comb('staff'), working:comb('working')+comb('ot_off'), off:comb('off'), sick:comb('sick'),
            leave:comb('leave'), ot_off:comb('ot_off'), otOffHrs:Math.round(comb('otOffHrs')*10)/10,
            otPeople:comb('otPeople'), otHours:Math.round(comb('otHours')*10)/10,
            otPre:comb('otPre'), otPreHrs:Math.round(comb('otPreHrs')*10)/10,
            otPost:comb('otPost'), otPostHrs:Math.round(comb('otPostHrs')*10)/10 };
  var teamOrder = Object.keys(res.teams).sort(function(a,b){ return (res.teams[b].working+res.teams[b].ot_off)-(res.teams[a].working+res.teams[a].ot_off); });
  var shortCount = 0; try { shortCount = slaCollectFlights_(res, ll).filter(function(f){return !f.ok;}).length; } catch (esc) {}
  var acCount = 0; try { acCount = acAnalyze_(res, ll).summary.bad; } catch (eac) {}

  var cd = { tn:teamOrder, tw:teamOrder.map(function(t){return res.teams[t].working+res.teams[t].ot_off;}),
    tt:teamOrder.map(function(t){return res.teams[t].staff;}), work:C.working, off:C.off, sick:C.sick, leave:C.leave,
    otPreN:C.otPre, otPostN:C.otPost, otOffN:C.ot_off, otPreH:C.otPreHrs, otPostH:C.otPostHrs, otOffH:C.otOffHrs, c:CI };

  var teamHead = '<tr><th>ทีม</th><th>Total</th><th>Working</th><th>OFF</th><th>Vac</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>';
  var posHead = '<tr><th>ตำแหน่ง</th><th>Total</th><th>Work</th><th>OT-Off</th><th>Off</th><th>Sick</th><th>Leave</th><th>OT ก่อน</th><th>OT หลัง</th></tr>';
  var masterLine = master ? ('<div class="sectionlabel">👥 พนักงานทั้งหมด (Active): PSA <b>'+master.PSA.total+'</b> + LL <b>'+master.LL.total+'</b> = <b>'+(master.PSA.total+master.LL.total)+'</b> คน</div>') : '';
  var llCards = '';
  if (L) {
    var secRows = Object.keys(ll.sections).map(function(s){ return rbAggRowHtml_(s, ll.sections[s]); }).join('');
    llCards = rbTblCard_('🟡 LL by Section', '<tr><th>ส่วนงาน</th><th>Total</th><th>Working</th><th>OFF</th><th>Vac</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>', secRows) +
      rbTblCard_('🟡 LL by Position', posHead, rbPosRows_(ll.positions, ['PSS','SNR','PSA','Porter','Admin','Trainee']));
  }

  var otbar = '<div class="otsplit"><div class="otrow"><span>⏱️ OT ก่อนกะ</span><b class="tnum">'+C.otPre+' คน · '+C.otPreHrs+'h</b></div>' +
    '<div class="otrow"><span>⏱️ OT หลังกะ</span><b class="tnum">'+C.otPost+' คน · '+C.otPostHrs+'h</b></div>' +
    '<div class="otrow"><span>⏱️ OT OFF</span><b class="tnum">'+C.ot_off+' คน · '+C.otOffHrs+'h</b></div>' +
    '<div class="otrow"><span>รวม OT</span><b class="tnum">'+C.otPeople+' คน · '+C.otHours+'h</b></div></div>';

  // tab contents: inline (offline file) or lazy placeholders (web app)
  var ttInner = staticMode
    ? rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
        '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
        rbTtRows_(res, ll), rbCtrls_('view-tt', true))
    : '<div id="ttbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Timetable…</div></div>';
  var fltInner = staticMode
    ? rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
        '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>ส่ง/ต้องการ</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th><th>สถานะ</th></tr>',
        rbFltRows_(res, ll), rbCtrls_('view-flt', true))
    : '<div id="fltbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Flights &amp; SLA…</div></div>';
  var otInner = staticMode ? rbWeeklyOTHtml(iso)
    : '<div id="otbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังคำนวณ OT รายสัปดาห์ (อ่านไฟล์หลายวัน อาจใช้เวลาสักครู่)…</div></div>';
  var acInner = staticMode ? rbAssignHtml(iso)
    : '<div id="acbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังตรวจการ Assign…</div></div>';
  var supInner = staticMode ? rbSupportHtml(iso)
    : '<div id="supbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังหาคนซัพพอร์ต…</div></div>';
  var fillInner = staticMode ? rbFillPlanHtml(iso)
    : '<div id="fillbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังเติมคนเสริมไฟลท์ที่ขาด…</div></div>';
  var autoInner = staticMode ? rbAutoAssignHtml(iso)
    : '<div id="autobox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังจัดเวรใหม่ทั้งหมดตาม SLA…</div></div>';
  var advInner = '<div id="advbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กดแท็บเพื่อจัดเวรล่วงหน้า (อ่านลิงก์ ROSTER/FLIGHT/รายชื่อจริง)…</div></div>';

  return '<!doctype html><html lang="th" data-theme="corporate"><head><meta charset="utf-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' + rbDesignCss_() + '</style></head><body><div class="wrap">' +
    rbAppbar_(date) + rbWeekNav_(date, iso, base, tz) + rbTabs_(shortCount, acCount) +
    '<div id="view-dash">' +
    rbKpiHero_(C, master) + masterLine +
    '<div class="grid grid--charts" style="margin-top:16px">' +
      '<div class="panel"><div class="panel__hd"><h3>📊 Working / Total ต่อทีม</h3></div><canvas id="c1" height="150"></canvas></div>' +
      '<div class="panel"><div class="panel__hd"><h3>🧭 ภาพรวมสถานะ</h3></div><canvas id="c2" height="150"></canvas></div></div>' +
    '<div class="grid grid--charts" style="margin-top:16px">' +
      '<div class="panel"><div class="panel__hd"><h3>⏱️ OT แยกประเภท (คน)</h3></div><canvas id="c3" height="140"></canvas></div>' +
      '<div class="panel"><div class="panel__hd"><h3>⏱️ OT แยกประเภท (ชม.)</h3></div><canvas id="c4" height="140"></canvas></div>' +
      '<div class="panel">' + otbar + '</div></div>' +
    '<div style="margin-top:16px">' + rbTblCard_('📌 Manpower by Team (PSA)', teamHead, rbTeamRows_(res.teams, teamOrder)) + '</div>' +
    '<div style="margin-top:16px">' + rbTblCard_('👥 PSA by Position', posHead, rbPosRows_(res.positions, ['PSS','SNR','PSA','Globlex','AdminD','Porter','Crewsign'])) + '</div>' +
    (L ? '<div style="margin-top:16px">'+llCards+'</div>' : '') +
    '</div>' +
    '<div id="view-tt" style="display:none">' + ttInner + '</div>' +
    '<div id="view-flt" style="display:none">' + fltInner + '</div>' +
    '<div id="view-sup" style="display:none">' + supInner + '</div>' +
    '<div id="view-ac" style="display:none">' + acInner + '</div>' +
    '<div id="view-fill" style="display:none">' + fillInner + '</div>' +
    '<div id="view-auto" style="display:none">' + autoInner + '</div>' +
    '<div id="view-adv" style="display:none">' + advInner + '</div>' +
    '<div id="view-ot" style="display:none">' + otInner + '</div>' +
    '<div class="foot">บริษัท บริการภาคพื้น ท่าอากาศยานไทย จำกัด (AOTGA) · live จาก Apps Script</div>' +
    '</div>' +
    '<div id="psnpop" class="psnpop" style="display:none" onclick="event.stopPropagation()"></div>' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>' +
    '<script>var CD=' + JSON.stringify(cd) + ';var ISO=' + JSON.stringify(iso) + ';var STATIC=' + (staticMode ? 'true' : 'false') + ';' +
    'function showView(v){["dash","tt","flt","sup","ac","fill","auto","adv","ot"].forEach(function(x){document.getElementById("view-"+x).style.display=v===x?"":"none";document.getElementById("tab-"+x).className="tab"+(v===x?" active":"");});}' +
    'var LD={};function lazy(box,fn,id){if(STATIC||LD[id])return;LD[id]=1;if(!(window.google&&google.script&&google.script.run)){document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">เปิดผ่าน Web App URL (/exec) เพื่อดูส่วนนี้</div>";return;}' +
    'google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;makeSortable();buildTeamSels();}).withFailureHandler(function(e){LD[id]=0;document.getElementById(box).innerHTML="<div class=\\"panel\\">โหลดไม่ได้: "+e.message+"</div>";})[fn](ISO);}' +
    'function loadTT(){lazy("ttbox","rbTimetableHtml","tt");}function loadFlt(){lazy("fltbox","rbFlightsHtml","flt");}function loadOT(){lazy("otbox","rbWeeklyOTHtml","ot");}function loadAC(){lazy("acbox","rbAssignHtml","ac");}function loadSup(){lazy("supbox","rbSupportHtml","sup");}function loadFill(){lazy("fillbox","rbFillPlanHtml","fill");}function loadAuto(){lazy("autobox","rbAutoAssignHtml","auto");}' +
    'function loadAdv(){lazy("advbox","rbAdvanceHtml","adv");}function advGo(v){var b=document.getElementById("advbox");if(!b||!(window.google&&google.script))return;b.innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">⏳ กำลังจัดเวร "+v+"…</div>";google.script.run.withSuccessHandler(function(h){b.innerHTML=h;makeSortable();}).withFailureHandler(function(e){b.innerHTML="<div class=\\"panel\\">"+e.message+"</div>";}).rbAdvanceHtml(v);}' +
    'function advSave(){var v=document.getElementById("view-adv");if(!v)return;var tb=v.querySelector("table.tbl");var di=v.querySelector("input[type=date]");var date=di?di.value:ISO;if(!tb){alert("เลือกวันที่ที่มีไฟลท์ก่อน");return;}var rows=[];[].forEach.call(tb.tBodies[0].rows,function(tr){if(tr.cells.length<9)return;var c=[];for(var i=0;i<4;i++){var ns=[];[].forEach.call(tr.cells[5+i].querySelectorAll(".namepick"),function(x){if(x.value.trim())ns.push(x.value.trim());});c.push(ns.join(", "));}rows.push([tr.cells[0].innerText.trim(),tr.cells[1].innerText.trim(),tr.cells[3].innerText.trim(),tr.cells[4].innerText.trim(),c[0],c[1],c[2],c[3]]);});if(!rows.length){alert("ไม่มีไฟลท์ให้บันทึก");return;}if(!(window.google&&google.script)){alert("เปิดผ่าน /exec เพื่อบันทึก");return;}var m=document.getElementById("advsavemsg");if(m)m.innerHTML="⏳ กำลังบันทึก…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="✅ บันทึกแล้ว: <a href=\\""+url+"\\" target=\\"_blank\\">เปิดชีต</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("บันทึกไม่ได้: "+e.message);}).advSaveProposal(date,JSON.stringify(rows));}' +
    'function applyFilter(viewId){var v=document.getElementById(viewId);if(!v)return;var sb=v.querySelector(".search"),q=sb?sb.value.toLowerCase():"";var ts=v.querySelector(".teamsel"),team=ts?ts.value:"";[].forEach.call(v.querySelectorAll("tbody tr"),function(r){var dt=r.getAttribute("data-team")||"";var okT=!team||dt===team||dt.split(",").indexOf(team)>=0;var okQ=!q||r.textContent.toLowerCase().indexOf(q)>=0;r.style.display=(okT&&okQ)?"":"none";});}' +
    'function buildTeamSels(){[].forEach.call(document.querySelectorAll("select.teamsel"),function(sel){if(sel.options.length>1)return;var v=sel.closest("div[id^=view-]");if(!v)return;var set={};[].forEach.call(v.querySelectorAll("tbody tr[data-team]"),function(r){(r.getAttribute("data-team")||"").split(",").forEach(function(t){t=t.trim();if(t)set[t]=1;});});Object.keys(set).sort().forEach(function(t){var o=document.createElement("option");o.text=t;o.value=t;sel.add(o);});});}' +
    'function supGrpVis(w){[].forEach.call(w.querySelectorAll(".supgrp"),function(g){var any=[].some.call(g.querySelectorAll(".supchip"),function(c){return c.style.display!=="none";});g.style.display=any?"":"none";});}' +
    'function applySupFilter(){var on={},anyOff=false;[].forEach.call(document.querySelectorAll("#view-sup .supteam:not(.supall)"),function(b){if(b.classList.contains("on"))on[b.getAttribute("data-t")]=1;else anyOff=true;});' +
    '[].forEach.call(document.querySelectorAll("#view-sup .supwrap"),function(w){var chips=[].slice.call(w.querySelectorAll(".supchip"));' +
    'if(!anyOff){chips.forEach(function(c){c.style.display="";c.classList.remove("sup--sub");});supGrpVis(w);return;}' +
    'var need=+(w.getAttribute("data-need")||1);var sel=[],uns=[];chips.forEach(function(c){(on[c.getAttribute("data-cteam")]?sel:uns).push(c);});' +
    'sel.forEach(function(c){c.style.display="";c.classList.remove("sup--sub");});var fill=Math.max(0,need-sel.length);' +
    'uns.forEach(function(c,i){if(i<fill){c.style.display="";c.classList.add("sup--sub");c.title="ทดแทน (ทีมไม่ได้เลือก)";}else{c.style.display="none";c.classList.remove("sup--sub");}});supGrpVis(w);});}' +
    'function toggleSupTeam(b){b.classList.toggle("on");applySupFilter();}' +
    'function allSupTeams(b){var on=[].some.call(document.querySelectorAll("#view-sup .supteam:not(.supall)"),function(x){return !x.classList.contains("on");});[].forEach.call(document.querySelectorAll("#view-sup .supteam:not(.supall)"),function(x){if(on)x.classList.add("on");else x.classList.remove("on");});applySupFilter();}' +
    'function makeSortable(){[].forEach.call(document.querySelectorAll("table.tbl"),function(tb){if(tb.getAttribute("data-srt"))return;tb.setAttribute("data-srt","1");var hs=tb.tHead?tb.tHead.rows[tb.tHead.rows.length-1].cells:[];[].forEach.call(hs,function(th,ci){th.style.cursor="pointer";th.title="คลิกเพื่อเรียง";th.addEventListener("click",function(){sortTbl(tb,ci,th);});});});}' +
    'function sortTbl(tb,ci,th){var tbody=tb.tBodies[0];if(!tbody)return;var rows=[].slice.call(tbody.rows).filter(function(r){return r.cells.length>ci&&!(r.cells[0].hasAttribute("colspan")||r.cells[0].colSpan>1);});var dir=th.getAttribute("data-sd")==="asc"?"desc":"asc";[].forEach.call(tb.tHead.querySelectorAll("th"),function(x){x.removeAttribute("data-sd");var s=x.querySelector(".sar");if(s)s.remove();});th.setAttribute("data-sd",dir);var ar=document.createElement("span");ar.className="sar";ar.textContent=dir==="asc"?" ▲":" ▼";th.appendChild(ar);rows.sort(function(a,b){var x=a.cells[ci].textContent.trim(),y=b.cells[ci].textContent.trim();var nx=parseFloat(x.replace(/[^0-9.\\-]/g,"")),ny=parseFloat(y.replace(/[^0-9.\\-]/g,""));var num=x!==""&&y!==""&&!isNaN(nx)&&!isNaN(ny)&&/[0-9]/.test(x)&&/[0-9]/.test(y)&&!/[A-Za-zก-๙]{2,}/.test(x.replace(/คน|h/g,""));var c=num?(nx-ny):x.localeCompare(y,"th");return dir==="asc"?c:-c;});rows.forEach(function(r){tbody.appendChild(r);});}' +
    'function showPsn(el){var d=el.dataset;var flts=(d.flts||"").split("‖").filter(Boolean);var work=(+d.n>=5)?" <span class=\\"badd\\">(งานเยอะ)</span>":((+d.n===0)?" <span class=\\"okk\\">(ว่าง)</span>":"");' +
    'var h="<div class=\\"psn__hd\\"><b>"+d.nm+"</b> <span class=\\"muted\\">"+d.pos+" · "+d.pteam+"</span><span class=\\"psn__x\\" onclick=\\"hidePsn()\\">✕</span></div>";' +
    'h+="<div class=\\"psn__r\\">🕘 กะ (เข้า-ออก): <b>"+d.shift+"</b></div><div class=\\"psn__r\\">⏱️ OT: "+d.ot+"</div>";' +
    'h+="<div class=\\"psn__r\\">✈️ งานเดิม: <b>"+d.n+"</b> ไฟลท์ · รวม "+d.hrs+"h"+work+"</div>";' +
    'h+="<div class=\\"psn__flts\\">"+(flts.length?flts.map(function(f){return "<span class=\\"chip\\">"+f+"</span>";}).join(" "):"<span class=\\"muted\\">— ไม่มีไฟลท์เดิม (ว่าง)</span>")+"</div>";' +
    'var p=document.getElementById("psnpop");p.innerHTML=h;p.style.display="block";var r=el.getBoundingClientRect();' +
    'p.style.left=Math.max(8,Math.min(r.left,window.innerWidth-370))+"px";p.style.top=(r.bottom+window.scrollY+6)+"px";}' +
    'function hidePsn(){var p=document.getElementById("psnpop");if(p)p.style.display="none";}' +
    'document.addEventListener("click",function(e){var p=document.getElementById("psnpop");if(p&&p.style.display==="block"&&!p.contains(e.target)&&!(e.target.classList&&e.target.closest(".supchip")))hidePsn();});' +
    'window.addEventListener("load",function(){makeSortable();buildTeamSels();});' +
    'window.addEventListener("load",function(){if(!window.Chart)return;if(window.ChartDataLabels)Chart.register(window.ChartDataLabels);' +
    'Chart.defaults.color="'+CI.sub+'";Chart.defaults.font.family="Kanit,sans-serif";Chart.defaults.font.weight="600";' +
    'new Chart(c1,{type:"bar",data:{labels:CD.tn,datasets:[{label:"Working",data:CD.tw,backgroundColor:CD.c.teal,borderRadius:5},{label:"Total",data:CD.tt,backgroundColor:"#c9d6e8",borderRadius:5}]},options:{plugins:{legend:{labels:{boxWidth:12}},datalabels:{anchor:"end",align:"end",font:{size:9,weight:"700"},color:"#15233f"}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"},suggestedMax:Math.max.apply(null,CD.tt)+3}}}});' +
    'new Chart(c2,{type:"doughnut",data:{labels:["Working","OFF","Sick","Leave"],datasets:[{data:[CD.work,CD.off,CD.sick,CD.leave],backgroundColor:[CD.c.teal,CD.c.grey,CD.c.red,CD.c.yellow],borderColor:"#fff",borderWidth:2}]},options:{plugins:{legend:{position:"bottom",labels:{boxWidth:12}},datalabels:{color:"#fff",font:{weight:"700"}}}}});' +
    'var OTL=["ก่อนกะ","หลังกะ","OT OFF"],OTC=[CD.c.yellow,CD.c.royal,CD.c.red];' +
    'new Chart(c3,{type:"bar",data:{labels:OTL,datasets:[{data:[CD.otPreN,CD.otPostN,CD.otOffN],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+" คน";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});' +
    'new Chart(c4,{type:"bar",data:{labels:OTL,datasets:[{data:[CD.otPreH,CD.otPostH,CD.otOffH],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+"h";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});});' +
    '</script></body></html>';
}

function rbDesignCss_() { return rbDESIGN_CSS_; }
var rbDESIGN_CSS_ = `:root{--royal:#1D428A;--bosch:#236192;--sky:#4EC3E0;--teal:#3FBCBE;--yellow:#FEC909;--red:#D92526;--grey:#7C878F;--brand:var(--royal);--brand-2:var(--bosch);--accent:var(--sky);--good:#1BA37A;--warn:#E8A400;--alert:var(--red);--bg:#eef3fa;--bg-2:#e3ecf7;--card:#ffffff;--ink:#15233f;--ink-2:#5a6b86;--ink-3:#93a1b8;--line:#e4ebf4;--line-2:#eef2f8;--radius:16px;--radius-sm:11px;--radius-lg:22px;--shadow:0 2px 4px rgba(20,40,80,.04),0 12px 28px rgba(20,40,80,.07);--shadow-sm:0 1px 2px rgba(20,40,80,.05),0 4px 12px rgba(20,40,80,.05);--shadow-lg:0 8px 18px rgba(20,40,80,.08),0 30px 60px rgba(20,40,80,.12);--header-grad:linear-gradient(118deg,#16315f 0%,var(--royal) 46%,var(--bosch) 100%);--maxw:1320px;--font:'Kanit',-apple-system,'Segoe UI',sans-serif;}
[data-theme="vibrant"]{--bg:#eaf1fb;--bg-2:#dfeafb;--header-grad:linear-gradient(120deg,#1b2a6b 0%,var(--royal) 38%,var(--teal) 100%);--shadow:0 2px 6px rgba(29,66,138,.06),0 16px 36px rgba(29,66,138,.12);--shadow-lg:0 10px 24px rgba(29,66,138,.12),0 36px 70px rgba(29,66,138,.18);}
[data-theme="soft"]{--bg:#f4f6fb;--bg-2:#eef1f8;--card:#ffffff;--line:#eceff6;--radius:22px;--radius-sm:15px;--radius-lg:28px;--header-grad:linear-gradient(125deg,#2a4f97 0%,#3a6fc0 60%,#5aa9d8 100%);--shadow:0 3px 8px rgba(40,60,100,.05),0 16px 40px rgba(40,60,100,.08);}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{background:var(--bg);}
body{font-family:var(--font);color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;min-height:100vh;background:radial-gradient(1200px 600px at 85% -10%,rgba(78,195,224,.18),transparent 60%),radial-gradient(1000px 500px at -5% 0%,rgba(29,66,138,.10),transparent 55%),var(--bg);}
.wrap{max-width:var(--maxw);margin:0 auto;padding:20px 24px 56px;}
.tnum{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.appbar{position:relative;background:var(--header-grad);border-radius:var(--radius-lg);padding:20px 28px;color:#fff;overflow:hidden;box-shadow:var(--shadow-lg);}
.appbar::before{content:"";position:absolute;inset:0;background:radial-gradient(520px 520px at 88% -120%,rgba(255,255,255,.14),transparent 60%),repeating-linear-gradient(115deg,rgba(255,255,255,.05) 0 1px,transparent 1px 64px);pointer-events:none;}
.appbar__row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;}
.brand{display:flex;align-items:center;gap:15px;}
.brand__mark{width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.12);border:1.5px solid rgba(255,255,255,.4);display:grid;place-items:center;flex:0 0 auto;backdrop-filter:blur(4px);}
.brand__mark svg{width:30px;height:30px;}
.brand h1{font-size:21px;font-weight:800;letter-spacing:.6px;line-height:1.05;}
.brand h1 span{color:var(--sky);}
.brand p{font-size:12px;font-weight:300;color:#cfe1f5;margin-top:3px;letter-spacing:.2px;white-space:nowrap;}
.appbar__meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.datepill{display:flex;flex-direction:column;align-items:flex-end;padding-right:16px;border-right:1px solid rgba(255,255,255,.22);}
.datepill .d{font-size:19px;font-weight:700;line-height:1.1;white-space:nowrap;}
.datepill .s{font-size:11px;color:#cfe1f5;font-weight:300;white-space:nowrap;}
.livedot{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#d8e8f8;font-weight:400;}
.livedot i{width:8px;height:8px;border-radius:50%;background:#58e6a0;box-shadow:0 0 0 0 rgba(88,230,160,.6);animation:pulse 2s infinite;}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(88,230,160,.5);}
70%{box-shadow:0 0 0 7px rgba(88,230,160,0);}
100%{box-shadow:0 0 0 0 rgba(88,230,160,0);}
}
.btn{font-family:inherit;cursor:pointer;border:0;border-radius:11px;padding:10px 15px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:7px;transition:transform .12s ease,box-shadow .12s ease,background .12s;}
.btn:active{transform:translateY(1px);}
.btn--ghost{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.28);}
.btn--ghost:hover{background:rgba(255,255,255,.24);}
.btn--accent{background:var(--sky);color:#0c2c45;}
.btn--accent:hover{box-shadow:0 6px 16px rgba(78,195,224,.4);}
.weeknav{display:flex;align-items:center;gap:12px;margin:16px 0 18px;}
.weeknav__strip{display:flex;gap:7px;overflow-x:auto;flex:1;padding:3px 1px 6px;scrollbar-width:thin;}
.weeknav__strip::-webkit-scrollbar{height:5px;}
.weeknav__strip::-webkit-scrollbar-thumb{background:#c7d4e6;border-radius:4px;}
.wk{flex:0 0 auto;min-width:50px;text-align:center;cursor:pointer;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:7px 6px 8px;line-height:1.1;transition:all .14s ease;user-select:none;}
.wk:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:var(--shadow-sm);}
.wk .wd{display:block;font-size:9.5px;color:var(--ink-3);font-weight:500;letter-spacing:.4px;}
.wk .wn{display:block;font-size:18px;font-weight:700;color:var(--ink);}
.wk .wm{display:block;font-size:9px;color:var(--ink-3);font-weight:400;}
.wk.sel{background:var(--brand);border-color:var(--brand);box-shadow:0 8px 18px rgba(29,66,138,.28);}
.wk.sel .wd,.wk.sel .wm{color:#bcd2ef;}
.wk.sel .wn{color:#fff;}
.wk.today:not(.sel){border-color:var(--accent);}
.wk.today:not(.sel) .wn{color:var(--brand);}
.weeknav__date{display:flex;align-items:center;gap:8px;}
.weeknav__date input{font-family:inherit;background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:11px;padding:9px 11px;font-size:13px;font-weight:500;}
.iconbtn{width:38px;height:38px;flex:0 0 auto;border-radius:11px;border:1px solid var(--line);background:var(--card);color:var(--brand);cursor:pointer;display:grid;place-items:center;font-size:16px;transition:all .14s;}
.iconbtn:hover{border-color:var(--accent);color:var(--accent);}
.tabs{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;}
.tab{font-family:inherit;cursor:pointer;background:var(--card);border:1px solid var(--line);color:var(--ink-2);border-radius:13px;padding:11px 18px;font-weight:600;font-size:14px;display:inline-flex;align-items:center;gap:9px;transition:all .15s ease;}
.tab svg{width:17px;height:17px;}
.tab:hover{color:var(--brand);border-color:#cdd9ec;}
.tab.active{background:var(--brand);color:#fff;border-color:var(--brand);box-shadow:0 8px 18px rgba(29,66,138,.24);}
.tab .badge{font-size:11px;font-weight:700;background:rgba(255,255,255,.22);color:#fff;border-radius:20px;padding:1px 8px;min-width:20px;text-align:center;}
.tab:not(.active) .badge{background:#fdeaea;color:var(--red);}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:16px;}
.kpi{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 16px 15px;box-shadow:var(--shadow-sm);overflow:hidden;transition:transform .16s ease,box-shadow .16s ease;}
.kpi:hover{transform:translateY(-3px);box-shadow:var(--shadow);}
.kpi::after{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--c);}
.kpi__top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;}
.kpi__ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 14%,white);color:var(--c);}
.kpi__ico svg{width:19px;height:19px;}
.kpi__trend{font-size:11px;font-weight:600;color:var(--ink-3);display:inline-flex;align-items:center;gap:3px;}
.kpi__trend.up{color:var(--good);}
.kpi__trend.down{color:var(--alert);}
.kpi__val{font-size:34px;font-weight:800;color:var(--ink);line-height:1;letter-spacing:-.5px;}
.kpi__val small{font-size:15px;font-weight:600;color:var(--ink-3);margin-left:2px;}
.kpi__lbl{font-size:12.5px;color:var(--ink-2);font-weight:500;margin-top:5px;}
.kpi__sub{font-size:11px;color:var(--ink-3);margin-top:2px;}
.attband{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:14px;margin-bottom:16px;}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;box-shadow:var(--shadow-sm);}
.panel--brand{background:var(--header-grad);color:#fff;border:0;box-shadow:var(--shadow);position:relative;overflow:hidden;}
.panel--brand::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.05) 0 1px,transparent 1px 54px);}
.panel h3{font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.panel--brand h3{color:#cfe1f5;}
.panel__hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.panel__hd h3{margin-bottom:0;}
.attring{position:relative;display:flex;align-items:center;gap:18px;}
.ring{position:relative;width:132px;height:132px;flex:0 0 auto;}
.ring__center{position:absolute;inset:0;display:grid;place-content:center;text-align:center;}
.ring__center .big{font-size:30px;font-weight:800;line-height:1;color:#fff;}
.ring__center .lbl{font-size:10.5px;color:#cfe1f5;margin-top:3px;}
.attlegend{display:flex;flex-direction:column;gap:9px;flex:1;}
.leg{display:flex;align-items:center;gap:9px;font-size:13px;}
.leg i{width:11px;height:11px;border-radius:4px;flex:0 0 auto;}
.leg .lk{color:#d6e4f5;font-weight:300;flex:1;}
.leg .lv{font-weight:700;font-size:15px;}
.statlist{display:flex;flex-direction:column;gap:12px;}
.statrow{display:flex;align-items:center;gap:12px;}
.statrow__ico{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 13%,white);color:var(--c);flex:0 0 auto;}
.statrow__ico svg{width:18px;height:18px;}
.statrow__t{flex:1;}
.statrow__t .k{font-size:12px;color:var(--ink-2);font-weight:500;}
.statrow__t .v{font-size:19px;font-weight:800;color:var(--ink);line-height:1.1;}
.statrow__t .v small{font-size:12px;color:var(--ink-3);font-weight:600;}
.otsplit{display:flex;flex-direction:column;gap:13px;}
.otrow .otrow__top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;}
.otrow .otrow__top .k{font-size:12.5px;font-weight:500;color:var(--ink-2);}
.otrow .otrow__top .v{font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;padding-left:10px;}
.otrow .otrow__top .v small{color:var(--ink-3);font-weight:500;}
.track{height:9px;background:var(--line-2);border-radius:6px;overflow:hidden;}
.track>i{display:block;height:100%;border-radius:6px;}
.grid{display:grid;gap:16px;}
.grid--2{grid-template-columns:1.35fr 1fr;}
.grid--charts{grid-template-columns:1.4fr 1fr;margin-bottom:16px;}
.barchart{display:flex;flex-direction:column;gap:11px;}
.barchart__row{display:grid;grid-template-columns:116px 1fr 46px;align-items:center;gap:12px;}
.barchart__lbl{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--ink);}
.barchart__lbl .tag{font-size:10px;font-weight:700;color:#fff;background:var(--brand);border-radius:6px;padding:1px 7px;letter-spacing:.3px;}
.barchart__bar{position:relative;height:24px;background:var(--line-2);border-radius:8px;overflow:hidden;}
.barchart__fill{position:relative;z-index:1;height:100%;border-radius:8px;background:linear-gradient(90deg,var(--teal),var(--sky));display:flex;align-items:center;transition:width .9s cubic-bezier(.2,.8,.2,1);}
.barchart__ghost{position:absolute;inset:0;z-index:0;}
.barchart__val{font-size:13px;font-weight:700;color:var(--ink);text-align:right;}
.barchart__val small{color:var(--ink-3);font-weight:500;}
.donut-wrap{display:flex;align-items:center;gap:20px;}
.donut{width:150px;height:150px;flex:0 0 auto;}
.donut-legend{display:flex;flex-direction:column;gap:11px;flex:1;}
.tablecard{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm);overflow:hidden;}
.teamsel{font-family:inherit;font-size:13px;font-weight:600;color:var(--ink);padding:7px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card);cursor:pointer;margin-left:8px;}
.tablecard__hd{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:16px 20px 13px;}
.tablecard__hd h3{font-size:14.5px;font-weight:700;color:var(--brand);display:flex;align-items:center;gap:9px;}
.tablecard__hd .pill{font-size:11px;font-weight:600;color:var(--ink-2);background:var(--bg-2);border-radius:20px;padding:3px 11px;}
.tbl{width:100%;border-collapse:collapse;font-size:13px;}
.tbl th{text-align:right;color:var(--ink-3);font-weight:600;font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;padding:8px 12px;background:var(--bg-2);}
.tbl th:first-child{text-align:left;}
.tbl td{text-align:right;padding:9px 12px;border-bottom:1px solid var(--line-2);color:var(--ink);}
.tbl td:first-child{text-align:left;}
.tbl tbody tr:last-child td{border-bottom:0;}
.tbl tbody tr:hover td{background:color-mix(in srgb,var(--accent) 7%,white);}
.tbl tr.total td{background:color-mix(in srgb,var(--brand) 6%,white);font-weight:700;border-top:2px solid var(--line);}
.tbl .nm{font-weight:600;color:var(--ink);display:flex;align-items:center;gap:9px;}
.dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}
.tag{display:inline-flex;align-items:center;justify-content:center;min-width:34px;font-size:10.5px;font-weight:800;letter-spacing:.4px;color:#fff;background:var(--brand);border-radius:6px;padding:2px 8px;}
.muted{color:var(--ink-3);font-weight:400;}
.b{font-weight:700;}
.cellbar{position:relative;height:18px;background:var(--line-2);border-radius:6px;overflow:hidden;min-width:90px;}
.cellbar>i{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:linear-gradient(90deg,var(--teal),var(--sky));}
.cellbar>span{position:absolute;right:7px;top:0;line-height:18px;font-size:11px;font-weight:700;color:var(--brand);}
.otcell{font-weight:700;}
.otcell small{color:var(--ink-3);font-weight:500;font-size:11px;}
.otcell.pre{color:var(--warn);}
.otcell.post{color:var(--royal);}
.ttbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
.search{position:relative;flex:1;min-width:200px;}
.search input{width:100%;font-family:inherit;border:1px solid var(--line);border-radius:12px;padding:11px 12px 11px 38px;font-size:13.5px;background:var(--card);color:var(--ink);}
.search input:focus{outline:2px solid color-mix(in srgb,var(--accent) 50%,white);border-color:var(--accent);}
.search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:17px;height:17px;color:var(--ink-3);}
.chipgroup{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-start;}
.tbl td .chipgroup{min-width:320px;}
.chip{display:inline-block;line-height:1.35;font-family:inherit;cursor:pointer;font-size:11px;font-weight:600;padding:4px 9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink-2);transition:all .13s;white-space:normal;}
.chip:hover{border-color:var(--accent);}
.chip--duty{background:var(--bg-2);color:var(--ink-3);border-style:dashed;}
.chip--sup{background:#fff3e0;color:#b45309;border-color:#f0a64a;}
.planchip .editnm{display:inline-block;min-width:22px;padding:0 2px;border-bottom:1px dashed var(--accent);outline:none;cursor:text;font-weight:700;color:var(--ink-2);}
.planchip .editnm:focus{background:#fff7d6;border-bottom-color:#d9a400;border-radius:3px;}
.planchip.edited{background:#fff7d6;border-color:#d9a400;}
.planchip__i{cursor:pointer;color:var(--ink-3);font-weight:600;}
.planchip__i:hover{color:var(--accent);}
.pickwrap{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;}
.namepick{font-family:inherit;font-size:11px;font-weight:600;padding:3px 6px;border-radius:7px;border:1px solid var(--line);background:var(--bg-2);color:var(--ink-2);max-width:230px;cursor:pointer;}
.namepick:focus{outline:none;border-color:var(--accent);background:#fff;}
.namepick.edited{background:#fff7d6;border-color:#d9a400;}
.supbar{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:10px 0 4px;font-size:13px;}
.supteam{font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink-3);cursor:pointer;}
.supteam.on{background:var(--brand);color:#fff;border-color:var(--brand);}
.supteam.supall{background:var(--bg-2);color:var(--ink);}
.supgrp{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px;margin:0 10px 6px 0;padding:3px 4px 3px 0;}
.supgrp__t{font-size:11px;font-weight:800;color:var(--brand);background:var(--bg-2);border-radius:7px;padding:3px 8px;margin-right:4px;white-space:nowrap;}
.supwrap{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px 10px;max-width:760px;}
.supchip{font-size:10.5px;padding:3px 7px;white-space:nowrap;cursor:pointer;}
.supchip:hover{border-color:var(--accent);background:#eef4fb;}
.supchip.sup--busy{border-color:#e0a96d;}
.supchip.sup--free{border-color:#56b682;}
.supchip.sup--sub{background:#fdf2e3;border:1px dashed #e0a96d;color:#9a5b1a;}
.supchip.sup--sub::before{content:"↪ ";font-weight:700;}
.psnpop{position:absolute;z-index:9999;width:350px;max-width:92vw;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 34px rgba(20,40,80,.22);padding:13px 15px;font-size:13px;}
.psn__hd{display:flex;align-items:center;gap:6px;font-size:14px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line-2);}
.psn__x{margin-left:auto;cursor:pointer;color:var(--ink-3);font-weight:700;padding:0 4px;}
.psn__r{margin:4px 0;}
.psn__flts{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;}
.psn__flts .chip{font-size:10.5px;padding:3px 7px;}
.tbl tbody tr.row-off td{background:#eceff1 !important;color:#7c878f;}
.tbl tbody tr.row-sl td{background:#f8d7da !important;color:#b3261e;font-weight:600;}
.tbl tbody tr.row-vac td{background:#fff3cd !important;color:#7a5b00;}
.chip.on{background:var(--brand);color:#fff;border-color:var(--brand);}
.ttgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:13px;}
.ttcard{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:15px 16px;box-shadow:var(--shadow-sm);transition:transform .14s,box-shadow .14s;}
.ttcard:hover{transform:translateY(-2px);box-shadow:var(--shadow);}
.ttcard__hd{display:flex;align-items:center;gap:11px;margin-bottom:12px;}
.avatar{width:40px;height:40px;border-radius:12px;flex:0 0 auto;display:grid;place-items:center;color:#fff;font-weight:700;font-size:15px;background:linear-gradient(135deg,var(--royal),var(--bosch));}
.ttcard__id{flex:1;min-width:0;}
.ttcard__id .nm{font-size:14.5px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ttcard__id .meta{font-size:11.5px;color:var(--ink-3);display:flex;align-items:center;gap:7px;margin-top:1px;}
.shiftbadge{text-align:right;flex:0 0 auto;}
.shiftbadge .code{font-size:13px;font-weight:800;color:var(--brand);}
.shiftbadge .time{font-size:11px;color:var(--ink-2);font-variant-numeric:tabular-nums;}
.ttcard__ot{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:8px;margin-bottom:11px;}
.ttcard__ot.pre{background:#fff6e0;color:#9a6b00;}
.ttcard__ot.post{background:#e9f0fb;color:var(--royal);}
.ttcard__ot.off{background:#fdeaea;color:var(--red);}
.fstrip{display:flex;flex-direction:column;gap:7px;}
.fstrip__item{display:flex;align-items:center;gap:8px;background:var(--bg-2);border-radius:10px;padding:7px 10px;}
.fstrip__no{font-size:12.5px;font-weight:800;color:var(--brand);min-width:52px;flex:0 0 auto;}
.fstrip__task{font-size:10px;font-weight:700;color:#fff;background:var(--teal);border-radius:6px;padding:2px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:92px;flex:0 1 auto;}
.fstrip__time{margin-left:auto;font-size:11px;color:var(--ink-2);font-variant-numeric:tabular-nums;text-align:right;flex:0 0 auto;white-space:nowrap;}
.fstrip__time .lab{font-size:8.5px;font-weight:700;color:var(--ink-3);letter-spacing:.3px;display:block;}
.ttcard__empty{font-size:12px;color:var(--ink-3);font-style:italic;padding:6px 0;}
.slabar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px;}
.slasum{display:flex;gap:10px;}
.slasum .pill{display:flex;align-items:center;gap:8px;padding:9px 15px;border-radius:12px;font-size:13px;font-weight:600;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow-sm);}
.slasum .pill b{font-size:17px;font-weight:800;}
.slasum .pill.ok b{color:var(--good);}
.slasum .pill.bad b{color:var(--alert);}
.fltlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px;}
.boarding{position:relative;display:flex;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-sm);transition:transform .14s,box-shadow .14s;}
.boarding:hover{transform:translateY(-2px);box-shadow:var(--shadow);}
.boarding.short{border-color:#f3c9c9;}
.boarding__stub{width:92px;flex:0 0 auto;background:var(--header-grad);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 8px;position:relative;}
.boarding.short .boarding__stub{background:linear-gradient(160deg,#b3201f,var(--red));}
.boarding__stub .ac{font-size:22px;font-weight:800;letter-spacing:1px;}
.boarding__stub .acn{font-size:8.5px;color:rgba(255,255,255,.8);text-align:center;margin-top:3px;line-height:1.2;font-weight:300;}
.boarding__perf{position:absolute;right:-7px;top:0;bottom:0;width:14px;background:radial-gradient(circle at center,var(--bg) 0 5px,transparent 5px) repeat-y;background-size:14px 18px;}
.boarding__body{flex:1;padding:13px 16px 14px;min-width:0;}
.boarding__top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px;}
.boarding__fl{font-size:18px;font-weight:800;color:var(--ink);letter-spacing:.5px;}
.boarding__fl small{display:block;font-size:11px;font-weight:400;color:var(--ink-3);}
.boarding__times{text-align:right;font-size:11px;color:var(--ink-2);}
.boarding__times .t{font-variant-numeric:tabular-nums;font-weight:700;color:var(--ink);font-size:13px;}
.slastatus{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;}
.slastatus.ok{background:#e3f6ee;color:var(--good);}
.slastatus.bad{background:#fdeaea;color:var(--red);}
.phases{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.phase{text-align:center;background:var(--bg-2);border-radius:10px;padding:8px 4px;}
.phase.short{background:#fdecec;}
.phase .pl{font-size:9.5px;font-weight:700;color:var(--ink-3);letter-spacing:.4px;text-transform:uppercase;}
.phase .pv{font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;font-variant-numeric:tabular-nums;}
.phase.short .pv{color:var(--red);}
.phase .pv span{font-size:11px;color:var(--ink-3);font-weight:600;}
.phase .pd{font-size:9.5px;font-weight:700;margin-top:1px;}
.phase.short .pd{color:var(--red);}
.phase.full .pd{color:var(--good);}
.foot{margin-top:26px;text-align:center;color:var(--ink-3);font-size:11.5px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;}
.foot b{color:var(--ink-2);font-weight:600;}
.sectionlabel{font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-3);margin:22px 2px 12px;display:flex;align-items:center;gap:10px;}
.sectionlabel::after{content:"";flex:1;height:1px;background:var(--line);}
@media (max-width:1080px){.kpis{grid-template-columns:repeat(3,1fr);}
.attband{grid-template-columns:1fr 1fr;}
.attband>:first-child{grid-column:1 / -1;}
.grid--2,.grid--charts{grid-template-columns:1fr;}
}
@media (max-width:680px){.wrap{padding:14px 14px 44px;}
.kpis{grid-template-columns:repeat(2,1fr);}
.attband{grid-template-columns:1fr;}
.brand h1{font-size:18px;}
.kpi__val{font-size:28px;}
.fltlist,.ttgrid{grid-template-columns:1fr;}
}
@keyframes rise{from{transform:translateY(9px);}
to{transform:none;}
}
.rise{animation:rise .5s cubic-bezier(.2,.8,.2,1) both;}
body.flat .kpi,body.flat .panel,body.flat .tablecard,body.flat .ttcard,body.flat .boarding,body.flat .wk,body.flat .tab,body.flat .slasum .pill{box-shadow:none !important;border-color:#d4deec;}
body.flat .panel--brand{border:1px solid rgba(255,255,255,.2);}
body.nomotion .rise{animation:none;}
canvas{max-width:100%}
.tbl td .barmini{position:relative;height:16px;background:var(--line-2);border-radius:8px;overflow:hidden;min-width:70px}
.tbl td .barmini i{position:absolute;inset:0;background:linear-gradient(90deg,var(--teal),var(--sky));border-radius:8px}
.tbl td .barmini b{position:absolute;right:6px;top:0;line-height:16px;font-size:10px;color:var(--royal);font-weight:700}
.okk{color:var(--good);font-weight:700}
.badd{color:var(--red);font-weight:700}
tr.rowbad td{background:#fdecec}
.muted{color:var(--ink-3)}
@media print{.weeknav,.tabs,.btn,.ttbar{display:none}
#view-tt,#view-flt,#view-dash{display:block!important}
}`;
