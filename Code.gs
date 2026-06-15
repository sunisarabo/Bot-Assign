/**
 * SmartShift Roster Bot — All-in-One (AOTGA design web app)
 * setupTriggers() = รันทุกวัน 08:00 และ 14:00 ส่งเข้า Google Chat
 */


// ===== RosterReader.gs =====

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

/** วันหยุดประเพณี/นักขัตฤกษ์ ปี 2569 (2026) ตามประกาศ AOTGA 403/2568
 *  ทำงานในวันเหล่านี้ = ได้ OT นักขัต X1 (1 เท่า) จากชั่วโมงทำงานในกะวันนั้น */
var PUBLIC_HOLIDAYS = {
  '2026-01-01': 'วันขึ้นปีใหม่',
  '2026-03-03': 'วันมาฆบูชา',
  '2026-04-06': 'วันจักรี',
  '2026-04-13': 'วันสงกรานต์',
  '2026-04-14': 'วันสงกรานต์',
  '2026-05-01': 'วันแรงงานแห่งชาติ',
  '2026-06-01': 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี',
  '2026-07-28': 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว',
  '2026-07-29': 'วันอาสาฬหบูชา',
  '2026-08-12': 'วันแม่แห่งชาติ',
  '2026-10-13': 'วันนวมินทรมหาราช',
  '2026-10-23': 'วันปิยมหาราช',
  '2026-12-05': 'วันพ่อแห่งชาติ',
  '2026-12-31': 'วันสิ้นปี'
};

/** คืนชื่อวันหยุดประเพณี ถ้า date เป็นวันหยุด (รับ Date หรือ {y,m,d}) ไม่ใช่ → null */
function rrPublicHoliday_(date) {
  var y, m, d;
  if (date && typeof date.getFullYear === 'function') { y = date.getFullYear(); m = date.getMonth() + 1; d = date.getDate(); }
  else if (date) { y = date.y; m = date.m; d = date.d; } else return null;
  var key = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  return PUBLIC_HOLIDAYS[key] || null;
}

// ─── cell helpers ───────────────────────────────────────────────────────────
function rrClean_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // ค่าเวลา-ล้วน (time-only) ใน Sheets วางอยู่บนวันฐาน epoch (ปี 1899/1900) → เป็น "เวลา" รวมเที่ยงคืน 00:00
    // ส่วนวันที่ปฏิทินจริง (ปี > 1901 เช่น 12/06/2026) ไม่ใช่เวลา → คืนว่าง
    if (v.getFullYear() > 1901) return '';
    var h = v.getHours(), m = v.getMinutes();
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);   // 00:00 = เที่ยงคืนจริง (เดิม (h||m) ตัดทิ้งผิด)
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
/** "0820" / "925" → "08:20" / "09:25" */
function rrHHMM_(s) { var m = String(s || '').match(/(\d{1,2})(\d{2})$/); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; }
/** แปลงข้อความจ็อบของทีม LP เป็น assignment list
 *  เช่น "GATE SU660/661 0925/1055 STBY0930, ARR AK822/823 1530/1600"
 *  → [{flight:'SU660/661',task:'GATE',STA:'09:25',STD:'10:55'}, {flight:'AK822/823',task:'ARR',STA:'15:30',STD:'16:00'}] */
function rrParseJobText_(text) {
  var out = [];
  if (!text) return out;
  String(text).split(/[,;\n]+/).forEach(function (chunk) {
    var c = rrClean_(chunk); if (!c) return;
    var toks = c.split(/\s+/), flight = '', role = [], times = '';
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!flight && /^(?:[A-Z]{1,3}|\d[A-Z])\d{2,4}(?:\/\d{2,4})?$/i.test(t)) { flight = t; continue; }
      if (flight && !times && /^\d{3,4}\/\d{3,4}$/.test(t)) { times = t; continue; }
      if (!flight && /^[A-Za-z][A-Za-z/().-]*$/.test(t)) role.push(t.toUpperCase());   // คำบทบาทก่อนรหัสไฟลท์ (ARR/GATE…)
    }
    if (!flight || !acIsFlight_(flight)) return;     // ไม่มีรหัสไฟลท์ = ไม่ใช่จ็อบไฟลท์ (training/standby) → ข้าม
    var sta = '', std = '';
    if (times) { var p = times.split('/'); sta = rrHHMM_(p[0]); std = rrHHMM_(p[1]); }
    out.push({ flight: flight, task: role.join(' '), STA: sta, STD: std, OP: '', CL: '' });
  });
  return out;
}
/** ดึงรหัสไฟลท์ทั้งหมดจากข้อความรกๆ (Admin Doc/Crewsign) — เก็บเฉพาะที่ผ่าน acIsFlight_, ตัดซ้ำด้วยเลขไฟลท์
 *  เช่น "EY414/415 CREWSIGN(0500), AK818-819 STA0805" → [{flight:'EY414/415'},{flight:'AK818-819'}] */
function rrExtractFlights_(txt) {
  var out = [], seen = {};
  if (!txt) return out;
  (String(txt).match(/[A-Z0-9]{2,3}\s?\d{2,4}(?:\s?[\/-]\s?\d{2,4})?/gi) || []).forEach(function (code) {
    code = rrClean_(code).replace(/\s+/g, '');
    if (!acIsFlight_(code)) return;
    var key = (code.match(/\d{2,4}/g) || []).join('/');
    if (!key || seen[key]) return; seen[key] = 1;
    out.push({ flight: code, task: '', STA: '', STD: '', OP: '', CL: '' });
  });
  return out;
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
/** อ่าน OT หนึ่งกลุ่ม (คู่ IN/OUT ที่คอลัมน์ otc, total ที่ totc) → {hours, range:[s,e]} หรือ null
 *  ถ้ามีคอลัมน์ TOTAL → ใช้ค่ารวม (ว่าง+มี IN-OUT → คำนวณจากช่วง) ; ไม่มี TOTAL → ใช้ค่าในคอลัมน์ OT เอง */
function rrReadOtGroup_(row, otc, totc) {
  if (otc < 0) return null;
  var rng = rrRangeCells_(row, otc), h;
  if (totc >= 0) {
    h = rrOtHours_(totc < row.length ? row[totc] : '');
    if (!(h > 0) && rng[0] != null && rng[1] != null) {
      var a = rng[0], b = rng[1]; if (b <= a) b += 1440; h = Math.round((b - a) / 60 * 10) / 10;
    }
  } else {
    h = rrOtHours_(otc < row.length ? row[otc] : '');
  }
  if (!(h > 0) && rng[0] == null) return null;
  return { hours: h > 0 ? h : 0, range: rng };
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
  m = ((Math.round(m) % 1440) + 1440) % 1440;                 // normalize → นาฬิกา 00:00–23:59 (กันค่าติดลบ/ข้ามคืน)
  return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
}
/** เลื่อนช่วง [a,b] ด้วย k×1440 ให้แนบชิดช่วงอ้างอิง [rs,re] มากสุด — จัดเวลาข้ามเที่ยงคืนให้อยู่ timeline เดียวกัน */
function rrAlignTo_(a, b, rs, re) {
  if (a == null || b == null || rs == null || re == null) return [a, b];
  if (b <= a) b += 1440;                                       // ช่วงตัวเองข้ามคืน
  var bestK = 0, bestGap = Infinity;
  for (var k = -2; k <= 2; k++) {
    var aa = a + 1440 * k, bb = b + 1440 * k;
    var gap = (aa > re) ? (aa - re) : (bb < rs ? (rs - bb) : 0);
    if (gap < bestGap) { bestGap = gap; bestK = k; }
  }
  return [a + 1440 * bestK, b + 1440 * bestK];
}
function rrFmtRange_(r) { return (r[0] != null && r[1] != null) ? (rrFmtMin_(r[0]) + '-' + rrFmtMin_(r[1])) : ''; }

/** 'PRE' (OT before shift) or 'POST' (OT after shift). Defaults POST. */
function rrOtType_(srng, orng, isOff) {
  if (isOff) return 'POST';
  var si = srng[0], so = srng[1], oi = orng[0], oo = orng[1];
  if (oi == null) return 'POST';
  if (oo == null) return (si != null && oi < si) ? 'PRE' : 'POST';   // ไม่มีเวลาเลิก OT → เทียบ in กับต้นกะ (กัน null<=x เป็น PRE ผิด)
  if (so != null && si != null && so <= si) so += 1440;       // กะข้ามคืน
  if (oo != null && oo <= oi) oo += 1440;                      // OT ข้ามคืน
  if (si == null || so == null) return (si != null && oi < si) ? 'PRE' : 'POST';
  var al = rrAlignTo_(oi, oo, si, so); oi = al[0]; oo = al[1]; // จัด OT ให้อยู่ timeline เดียวกับกะ
  return (oo <= si + 30) ? 'PRE' : 'POST';                     // จบ ≤ ต้นกะ = ก่อนกะ, ไม่งั้น = หลังกะ
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
    // คอลัมน์สถานะ (Onduty/Off/OT OFF/VAC…): บางชีต (PVTLP) ใช้หัว 'STATUS', ที่เหลือใช้ 'REMARK'
    // ('REMARK FOR SUPPORT OTHER FLT' = โน้ต ไม่ใช่สถานะ → ไม่แมตช์ 'REMARK' ตรง ๆ อยู่แล้ว)
    cm.remark = u.indexOf('STATUS') >= 0 ? u.indexOf('STATUS') : u.indexOf('REMARK');
    // คอลัมน์จ็อบแบบข้อความ (ทีม LP): หัวคอลัมน์มี 'SUPPORT' + 'FL' เช่น "REMARK FOR SUPPORT OTHER FLT"
    cm.jobtext = -1;
    for (var jt = 0; jt < u.length; jt++) { if (u[jt].indexOf('SUPPORT') >= 0 && /\bFL/.test(u[jt])) { cm.jobtext = jt; break; } }
    cm.re     = u.indexOf('RE');
    cm.resked = u.indexOf('RE-SKED');
    if (cm.resked < 0) cm.resked = u.indexOf('RESKED');
    if (cm.resked < 0) cm.resked = u.indexOf('RE-SKED.');
    // OT: รองรับทั้ง 'OT' ตรง ๆ และเลย์เอาต์ 2 ฝั่ง 'OT(BEFORE)' / 'OT(AFTER)' (เช่น EY มี OT ก่อนกะ + หลังกะ แยกคู่ IN/OUT)
    var otCols = [];
    for (var oc = 0; oc < u.length; oc++) {
      var oh = u[oc].replace(/[\s.]/g, '');
      if (oh === 'OT' || oh.indexOf('OT(') === 0) otCols.push(oc);
    }
    cm.ot  = otCols.length     ? otCols[0] : -1;
    cm.ot2 = otCols.length > 1 ? otCols[1] : -1;
    function rrTotAfter(otc) {                                  // หา 'TOTAL HRS' ภายใน 3 คอลัมน์ถัดจากกลุ่ม OT
      if (otc < 0) return -1;
      for (var c = otc + 1; c < u.length; c++) {
        var h = u[c].replace(/\./g, '').replace(/\s+/g, ' ').trim();
        if (h.indexOf('TOTAL') === 0 && (c - otc) > 0 && (c - otc) <= 3) return c;
      }
      return -1;
    }
    cm.ottot  = rrTotAfter(cm.ot);
    cm.ottot2 = rrTotAfter(cm.ot2);
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

/** หัวคอลัมน์ที่เป็น 'รหัสไฟลท์' (G9687/688, WY831/832, CA413, 6E1077, SQ726). */
function rrIsFlightHdr_(h) {
  return /(?:^|[\s\/])(?:[A-Z]{1,3}\s?\d{2,4}|\d[A-Z]\d{2,4})/.test(String(h || ''));
}

// ─── parsers ────────────────────────────────────────────────────────────────
/** เทากลาง (ไม่ขาว/ไม่ดำสนิท) แบบ neutral grey — ใช้มาร์คไฟลท์ยกเลิก (ระบายเทาทั้งบล็อก) */
function rrIsCancelGrey_(hex) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return false;
  var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return (mx - mn) <= 0x16 && mn >= 0x40 && mx <= 0xDC;       // r≈g≈b และอยู่โทนเทากลาง
}
/** ไฟลท์ถูกยกเลิกไหม — เช็ค 3 สัญญาณ: ข้อความ CXL/CANCEL/ยกเลิก, ขีดฆ่าหัวไฟลท์, ระบายเทาทั้งบล็อก (หัว+STA+OP) */
function rrFlightCancelled_(name, col, c1, hi, meta) {
  if (/\b(CXL|CNL|CANCEL(?:LED)?)\b|ยกเลิก/i.test(String(name || ''))) return true;
  if (!meta) return false;
  var bgs = meta.bgs, lines = meta.lines;
  if (lines && lines[hi] && /line-through/i.test(String(lines[hi][col] || ''))) return true;   // ขีดฆ่า
  if (bgs && bgs[hi] && rrIsCancelGrey_(bgs[hi][col])) return true;                             // หัวไฟลท์เทา
  if (bgs) {                                                  // ระบายเทาเกือบทั้งบล็อก (หัว/STA/OP)
    var grey = 0, tot = 0;
    for (var rr = hi; rr <= hi + 2 && rr < bgs.length; rr++) {
      for (var cc = col; cc < c1; cc++) { var hx = bgs[rr] && bgs[rr][cc]; if (!hx) continue; tot++; if (rrIsCancelGrey_(hx)) grey++; }
    }
    if (tot >= 3 && grey >= Math.ceil(tot * 0.6)) return true;
  }
  return false;
}

function rrParseStandard_(rows, team, meta) {
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
      fltcols[fi].cancelled = rrFlightCancelled_(fltcols[fi].name, c0, c1, hi, meta);   // ไฟลท์ยกเลิก (เทา/ขีดฆ่า/CXL)
      // ใช้ป้าย A:/D: (STA/STD) และ O:/C: (OP/CL) ถ้ามี (กัน STA ว่างแล้ว STD เลื่อนมาผิดช่อง)
      var staV = '', stdV = '', opV = '', clV = '', posS = [], posO = [];
      for (var cc = c0; cc < c1; cc++) {
        // ข้าม placeholder 00:00 (สล็อตไฟลท์ว่างในเทมเพลต) + ไม่เขียนทับค่าที่อ่านได้แล้ว
        // (กันไฟลท์สุดท้ายที่ span ยาวถึงท้ายแถว ไปดูดเวลา 00:00 ของสล็อตว่างมาทับเวลาจริง — เช่น KE677/678)
        var sc = rrClean_(sta[cc]), tv = rrTimePair_(sc);
        if (tv && tv !== '00:00') { if (/^\s*D/i.test(sc)) { if (!stdV) stdV = tv; } else if (/^\s*A/i.test(sc)) { if (!staV) staV = tv; } else posS.push(tv); }
        var ocs = rrClean_(opn[cc]), ov = rrTimePair_(ocs);
        if (ov && ov !== '00:00') { if (/^\s*C/i.test(ocs)) { if (!clV) clV = ov; } else if (/^\s*O/i.test(ocs)) { if (!opV) opV = ov; } else posO.push(ov); }
      }
      if (!staV && posS.length) staV = posS.shift();
      if (!stdV && posS.length) stdV = posS.shift();
      if (!opV && posO.length) opV = posO.shift();
      if (!clV && posO.length) clV = posO.shift();
      flights[fltcols[fi].name] = { STA: staV, STD: stdV, OP: opV, CL: clV };
    }
    fltcols = fltcols.filter(function (f) { return !f.cancelled; });   // ตัดไฟลท์ที่ยกเลิกออก (ไม่บันทึก assignment)
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
        // หัวคอลัมน์เป็น "ป้ายไฟลท์ทั่วไป" (เช่น "หมายเลขไฟลท์ 1", "Job 1", "FLIGHT") — รหัสไฟลท์จริง
        // ฝังในข้อความ (Admin Doc/Crewsign: "EY414/415 CREWSIGN…, AK818-819…") → ดึงออกมา
        // (ไม่แตะคอลัมน์ Counter ของ SU — คงงานเคาน์เตอร์ไว้)
        var codes = /หมายเลขไฟลท์|^(?:JOB|FLIGHT)\b/i.test(fc.name) ? rrExtractFlights_(tasks.join(' ')) : null;
        if (codes && codes.length) {
          codes.forEach(function (a) { assigns.push(a); });
        } else {
          assigns.push({ flight: fc.name, task: tasks.join('/'),
                         STA: info.STA || '', STD: info.STD || '', OP: op, CL: cl });
          // common check-in (SU): โค้ดเคาน์เตอร์ที่ระบุเลขไฟลท์ เช่น "FC661" = FC ของ SU661
          // → เพิ่ม assignment ไฟลท์ของทีม (เฉพาะทีมที่ชื่อเป็นรหัสสายการบิน 2 ตัว)
          if (/^[A-Z]{2}$/.test(String(team).toUpperCase()) && !acIsFlight_(fc.name)) {
            var air = String(team).toUpperCase();
            tasks.forEach(function (tk) {
              var mm = String(tk).match(/^([A-Z]+)?(\d{3,4})$/);   // FC661 / 285
              if (mm && acIsFlight_(air + mm[2])) {
                assigns.push({ flight: air + mm[2], task: mm[1] || '', STA: '', STD: '', OP: '', CL: '' });
              }
            });
          }
        }
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
    // ทีม LP/Support: จ็อบงานเขียนเป็นข้อความในคอลัมน์ "REMARK FOR SUPPORT OTHER FLT"
    // (เช่น "GATE SU660/661 0925/1055 STBY0930, ARR AK822/823 1530/1600") → แปลงเป็น assignment
    if (cm.jobtext >= 0 && cm.jobtext < row.length) {
      var jobs = rrParseJobText_(rrClean_(row[cm.jobtext]));
      if (jobs.length) {
        var jnums = {};
        assigns.forEach(function (a) { (a.flight.match(/\d{2,4}/g) || []).forEach(function (n) { jnums[n] = 1; }); });
        jobs.forEach(function (a) {
          var cn = a.flight.match(/\d{2,4}/g) || [];
          if (cn.length && !cn.some(function (n) { return jnums[n]; })) { assigns.push(a); cn.forEach(function (n) { jnums[n] = 1; }); }
        });
      }
    }

    // OT: รวมทุกกลุ่ม — ปกติ 1 กลุ่ม; EY มี ก่อนกะ(BEFORE) + หลังกะ(AFTER) แยกคู่ IN/OUT
    var twoSided = cm.ot2 >= 0;
    var otG1 = rrReadOtGroup_(row, cm.ot, cm.ottot);
    var otG2 = twoSided ? rrReadOtGroup_(row, cm.ot2, cm.ottot2) : null;
    var otSpans = [], oth = 0;
    if (otG1) { oth += otG1.hours; if (otG1.range[0] != null) otSpans.push({ a: otG1.range[0], b: otG1.range[1], type: twoSided ? 'PRE' : null }); }
    if (otG2) { oth += otG2.hours; if (otG2.range[0] != null) otSpans.push({ a: otG2.range[0], b: otG2.range[1], type: 'POST' }); }
    oth = Math.round(oth * 10) / 10;
    var bkt = rrClassify_(shift || timev, remark);
    if (bkt === 'off' && oth > 0) bkt = 'ot_off';            // SHIFT=X แต่มี OT (เช่น 14-20) = ทำ OT วันหยุด
    if (bkt === 'ot_off' && !(oth > 0)) bkt = 'off';         // REMARK="OT OFF" แต่ไม่มีชั่วโมง OT จริง = ยังไม่ได้มาทำ → หยุด (ไม่นับเป็น on-duty)
    // เวลากะ: ปกติอยู่คอลัมน์ TIME; ถ้าไม่มี → อ่านช่วงเวลาจากคอลัมน์ SHIFT เอง (เช่น "09-17")
    var srng = cm.time >= 0 ? rrRangeCells_(row, cm.time) : rrRangeStr_(shift);
    // Re-Sked overrides the shift time when filled (เปลี่ยนเวลาเข้างาน)
    var reTime = '';
    if (cm.resked >= 0) {
      var rs = rrRangeCells_(row, cm.resked);
      if (rs[0] != null) { srng = rs; reTime = rrFmtRange_(rs); }
    }
    // otType (ฟิลด์เดียว สำหรับสถิติ/แสดงผล): มีฝั่งหลังกะ → POST ไม่งั้นจัดประเภทช่วงแรกอัตโนมัติ
    var primarySpan = otSpans.length ? [otSpans[otSpans.length - 1].a, otSpans[otSpans.length - 1].b] : [null, null];
    var otType = oth > 0 ? (twoSided ? (otG2 ? 'POST' : 'PRE') : rrOtType_(srng, primarySpan, bkt === 'ot_off')) : null;
    recs.push({
      team: team, id: idd, name: name,
      pos: cm.pos >= 0 ? rrClean_(row[cm.pos]) : '',
      re: reTime || ((cm.re >= 0 && cm.re < row.length) ? rrClean_(row[cm.re]) : ''),
      shift: shift || timev,
      shiftTime: rrFmtRange_(srng) || (shift || timev),
      shiftStart: srng[0],
      shiftHrs: (srng[0] != null && srng[1] != null) ? Math.round((((srng[1] <= srng[0] ? srng[1] + 1440 : srng[1]) - srng[0]) / 60) * 10) / 10 : 0,
      bucket: bkt, ot: oth, otType: otType, otSpans: otSpans,
      otTime: oth > 0 ? otSpans.map(function (s) { return rrFmtRange_([s.a, s.b]); }).filter(String).join(', ') : '',
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
    // ข้ามแถวหัวตาราง/legend ท้ายชีต (ไม่ใช่ชื่อคน) — กันนับ AdminDoc เกินจริง
    if (!nm || nm.length < 2) continue;
    if (/^(NAME|SCHEDULE|SHIFT|POSITION|TYPE|ON\s*DUTY|ONDUTY|OT\s*OFF|OFF|RE-?SKED|REMARK|FLIGHT|SUPP|SUPPORT|TOTAL)\b/.test(nU)) continue;
    if (/^(SL|BL|VAC|ID|XX)$/.test(nU)) continue;
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
  var rng = ws.getRange(1, 1, last, Math.min(ws.getLastColumn(), 60));
  var rows = rng.getValues();
  // อ่านสีพื้น + ขีดฆ่า เพื่อตรวจไฟลท์ที่ยกเลิก (ระบายเทาทั้งบล็อก / ขีดฆ่า)
  var meta = null;
  try { meta = { bgs: rng.getBackgrounds(), lines: rng.getFontLines() }; } catch (e) { meta = null; }
  if (n.indexOf('PORTER') >= 0 && n.indexOf('CREW') >= 0) {
    // ชีต Crewsign แบบใหม่ใช้เลย์เอาต์มาตรฐาน (ID/Position/NAME/SHIFT/IN-OUT) — นับครบทุกคน
    // (ทีมมี "CREW" → rrPosGroup_ จัดเป็น Crewsign อยู่แล้ว) · เลย์เอาต์เก่า 2 คอลัมน์ → fallback
    var cstd = rrParseStandard_(rows, name, meta);
    if (cstd && cstd.length) return cstd;
    return rrParseCrewsign_(rows, name);
  }
  if (n === 'PORTER') {
    // New PORTER sheets use the standard ID/REMARK layout; old ones are a
    // 2-column name list. Prefer standard; fall back to the 2-column parser.
    var pstd = rrParseStandard_(rows, name, meta);
    if (pstd && pstd.length) return pstd;
    return rrParsePorter_(rows, name);
  }
  if (n.indexOf('ADMIN') >= 0 && n.indexOf('DOC') >= 0) {
    // ชีต Admin Doc แบบใหม่ใช้เลย์เอาต์มาตรฐาน (ID/Position/NAME/SHIFT + REMARK สถานะ Onduty/Off)
    // → อ่านชื่อ/กะ/สถานะ off ถูกต้อง · เลย์เอาต์เก่า 2 คอลัมน์ → fallback
    var astd = rrParseStandard_(rows, name, meta);
    if (astd && astd.length) return astd;
    return rrParseAdminDoc_(rows, name);
  }
  if (n === 'SU' || n.indexOf('SU ') === 0) {
    // New SU template (effective 08 JUN) is a standard ID/REMARK staff table
    // (with inline Counter/Gate sections); the old SU sheet is a counter-rotation
    // grid with no ID column. Prefer the standard reader; fall back to the grid.
    var std = rrParseStandard_(rows, name, meta);
    if (std && std.length) return std;
    return rrParseSU_(rows, name);
  }
  return rrParseStandard_(rows, name, meta);
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

function rrAddBucket_(agg, r, isHol) {
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
  if (isHol && r.bucket === 'working' && r.shiftHrs > 0) {      // วันหยุดประเพณี: ทำงาน = OT นักขัต X1 เท่าชั่วโมงกะ
    agg.otHol++; agg.otHolHrs += r.shiftHrs;
  }
  agg.flights += (r.assignments ? r.assignments.length : 0);
  agg.staff++;
}
function rrNewAgg_() {
  return { staff: 0, working: 0, ot_off: 0, off: 0, sick: 0, leave: 0, otPeople: 0, otHours: 0,
           otPre: 0, otPreHrs: 0, otPost: 0, otPostHrs: 0, otOffHrs: 0, otHol: 0, otHolHrs: 0, flights: 0 };
}
function rrRoundAgg_(a) {
  a.otHours = Math.round(a.otHours * 10) / 10; a.otPreHrs = Math.round(a.otPreHrs * 10) / 10;
  a.otPostHrs = Math.round(a.otPostHrs * 10) / 10; a.otOffHrs = Math.round(a.otOffHrs * 10) / 10;
  a.otHolHrs = Math.round(a.otHolHrs * 10) / 10; return a;
}

function readRosterFromSpreadsheet(ss, date) {
  var teams = {};
  var positions = {};                                        // exact per-position-group rollup
  var totals = rrNewAgg_();
  var holName = date ? rrPublicHoliday_(date) : null, isHol = !!holName;  // วันหยุดประเพณี → OT นักขัต X1
  rrFilterRev_(ss.getSheets()).forEach(function (ws) {
    var recs = rrParseSheet_(ws);
    if (!recs || !recs.length) return;
    var t = rrNewAgg_();
    t.records = recs;
    recs.forEach(function (r) {
      r.posGroup = rrPosGroup_(r.pos, ws.getName());
      r.isHoliday = isHol;
      rrAddBucket_(t, r, isHol);
      if (!positions[r.posGroup]) positions[r.posGroup] = rrNewAgg_();
      rrAddBucket_(positions[r.posGroup], r, isHol);
      rrAddBucket_(totals, r, isHol);
    });
    rrRoundAgg_(t);
    teams[ws.getName().trim()] = t;
  });
  Object.keys(positions).forEach(function (p) { rrRoundAgg_(positions[p]); });
  rrRoundAgg_(totals);
  delete totals.records;
  return { teams: teams, positions: positions, totals: totals, holiday: holName };
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


// ===== MasterReader.gs =====

/**
 * MasterReader.gs — total active-headcount per department from the MASTER file
 * =============================================================================
 * The Pax Manpower master ("Total" sheet) lists every employee with their team,
 * department and status. This gives the *establishment* headcount (all active
 * staff) for PSA (การโดยสาร) and LL (ติดตามสัมภาระ) — independent of who is on
 * duty today. The daily attendance still comes from the assignment files; this
 * only adds "จำนวนพนักงานทั้งหมด" per department.
 *
 * Master "Total" sheet columns (0-indexed), per the original SmartShift bot:
 *   1 ID | 2 Team | 4 NameTH | 6 Dept | 7 Position | 10 NameEN | 12 ResignDate | 13 Status
 */

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


// ===== LLReader.gs =====

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


// ===== SLA.gs =====

/**
 * SLA.gs — airline SLA (service level) staffing check + daily flight list.
 * =============================================================================
 * For each flight in the day's roster it counts how many staff were assigned to
 * each phase (Supervisor / Check-in / Gate / Arrival) and compares against the
 * airline SLA requirement, flagging shortages (which phase, how many short) =
 * the "support needed" check. (Renamed from the old SOP_* naming to SLA_*.)
 *
 * Requires RosterReader.gs (res = readRosterFromSpreadsheet()).
 */

// ── Airline SLA: timing offsets (นาที รอบ STD = เวลาออก) + required headcount per role/phase ──
// roles: [name, count, code, phase]  · phase = ALL(SUP) / CI / ARR / GATE
// ci    = check-in เปิด ก่อน STD (เช่น -180 = 3 ชม.)   · cc = check-in ปิด ก่อน STD (เช่น -60 = 1 ชม.)
// go    = gate open ก่อน STD (เช่น -45)                · lc = boarding/last call ก่อน STD
// brief = บรีฟเริ่ม ก่อนเวลาเปิด check-in (นาที)        · post = งาน post-flight หลัง STD/STA (นาที) — มีทุกสาย
// total = จำนวนพนักงานทั้งหมด · เวลาเปิดเคาน์เตอร์ใช้ OP ในชีตก่อน ถ้าไม่มีจึงใช้ STD+ci
// post-flight ใช้ค่า post รายสาย (full-service 30 / LCC 20) · SLA_POST = ค่า fallback กรณีสายไม่มี post
var SLA_POST = 20;   // fallback post-flight (นาที) เมื่อสายการบินไม่มีฟิลด์ post
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
  '3K':[2,4,1,2,8], '3U':[2,4,1,2,8], '6B':[2,5,2,2,10], '6E':[2,5,1,6,9], '8L':[2,4,1,2,8], '8M':[2,3,1,2,7],
  '9C':[2,5,1,2,9], '9H':[2,4,1,2,8], 'AF':[2,9,1,2,13], 'AI':[2,6,1,2,10], 'AK':[2,3,1,2,7], 'AQ':[2,3,1,2,7],
  'AY':[2,5,1,2,9], 'BY':[2,5,2,2,10], 'C6':[2,4,1,2,8], 'CA':[2,6,1,2,10], 'CX':[2,6,2,2,11], 'CZ':[2,6,1,2,10],
  'DE':[2,6,2,2,11], 'DK':[2,7,1,2,11], 'DV':[2,4,1,2,8], 'EK':[2,7,3,2,13], 'EO':[2,6,1,2,10], 'EY':[2,9,1,2,13],
  'FM':[2,4,1,2,8], 'FY':[2,4,1,2,8], 'G2':[2,6,1,2,10], 'G8':[2,4,1,2,8], 'G9':[2,4,1,2,8], 'HB':[2,4,1,2,8],
  'HH':[2,4,1,2,8], 'HO':[2,4,1,2,8], 'HU':[2,6,1,2,10], 'HX':[2,5,1,2,9], 'HY':[2,5,1,2,9], 'IT':[2,4,1,2,8], 'IX':[2,4,1,2,8],
  'JQ':[2,7,1,3,11], 'KC':[2,5,1,2,9], 'KE':[2,8,1,2,12], 'KY':[2,3,1,2,7], 'LJ':[2,4,1,2,8], 'LO':[2,6,1,2,10],
  'LY':[2,8,1,2,12], 'MH':[2,4,1,2,8], 'MU':[2,4,1,2,8], 'N0':[2,5,1,2,9], 'N4':[2,6,1,2,10], 'NO':[2,6,1,2,10],
  'OD':[2,5,1,2,9], 'OM':[2,4,1,2,8], 'OQ':[2,4,1,2,8], 'OV':[2,4,1,2,8], 'OZ':[2,6,1,2,10], 'PG':[2,0,1,2,5],
  'PN':[2,4,1,2,8], 'QP':[2,4,1,2,8], 'QR':[2,9,2,2,14], 'QZ':[1,3,1,1,7], 'S7':[2,4,1,2,8], 'SG':[2,4,1,2,8], 'SQ':[2,5,1,2,9],
  'SU':[2,8,1,2,12], 'TK':[2,8,4,2,15], 'TR':[2,6,1,2,10], 'U6':[2,4,1,2,8], 'UO':[2,4,2,2,9], 'VJ':[2,5,1,2,9],
  'W5':[2,7,1,2,11], 'WK':[2,6,1,2,10], 'WY':[2,7,1,2,11], 'WZ':[2,6,1,2,10], 'ZF':[2,6,1,2,10], 'ZH':[2,4,1,2,8],
};

// ── Airline → check-in SYSTEM (ตารางทางการ) ─────────────────────────────────
var AIRLINE_SYS = {
  '3K':'Gonow', '3U':'Angel Lite', '6B':'iPort', '6E':'Gonow', '8H':'TravelSky', '8L':'TravelSky', '8M':'iPort',
  '9C':'TravelSky', '9H':'TravelSky', 'AF':'Altea', 'AI':'Altea', 'AK':'Gonow', 'AQ':'TravelSky', 'AY':'Altea',
  'B2':'ASTRA', 'BK':'TravelSky', 'BY':'iPort', 'C6':'iPort', 'CA':'TravelSky', 'CX':'Altea', 'CZ':'TravelSky',
  'DE':'Altea', 'DK':'Altea', 'DV':'TWD', 'EK':'AS Connect', 'EO':'Lydia DCS', 'EY':'Altea', 'FM':'TravelSky',
  'FY':'Gonow', 'G2':'iPort', 'G8':'Gonow', 'G9':'Altea', 'GX':'TravelSky', 'H4':'iPort', 'HB':'TravelSky',
  'HH':'iPort', 'HO':'TravelSky', 'HU':'TravelSky', 'HX':'iPort', 'HY':'Altea', 'IT':'Gonow', 'IX':'Gonow',
  'JQ':'Gonow', 'KA':'iPort', 'KC':'Altea', 'KE':'Altea', 'KX':'TravelSky', 'KY':'TravelSky', 'LJ':'iFlyRes',
  'LO':'iPort', 'LY':'Altea', 'MH':'Altea', 'MU':'TravelSky', 'N0':'Gonow', 'N4':'Lydia DCS', 'NO':'Gonow',
  'OD':'Sabre', 'OM':'iPort', 'OQ':'TravelSky', 'OV':'iPort', 'OZ':'Altea', 'PG':'Altea', 'PN':'TravelSky',
  'QP':'Gonow', 'QR':'Altea', 'QZ':'Gonow', 'S7':'TWD', 'SG':'Gonow', 'SQ':'Altea', 'SU':'ASTRA',
  'SV':'Altea', 'TK':'TOYA', 'TR':'Gonow', 'U6':'Gonow', 'UO':'Gonow', 'VJ':'iPort', 'VN':'Gonow',
  'W5':'AVIA', 'WK':'Altea', 'WY':'Sabre', 'WZ':'ASTRA', 'ZF':'ASTRA', 'ZH':'TravelSky',
};
// iPort = ระบบที่ทุกคนทำได้ (ไฟลท์ iPort ใครว่างก็ช่วยเช็คอินได้)
var SLA_UNIVERSAL_SYS_NORM = 'iport';
function slaSysNorm_(s) { return String(s || '').toLowerCase().replace(/[\s.]+/g, ''); }   // Astra=ASTRA, iPort=iport
function slaSystemOf_(airline) { return AIRLINE_SYS[String(airline || '').toUpperCase()] || ''; }
/** ระบบที่ "ต้องรู้" เพื่อช่วยเช็คอินไฟลท์นี้ ('' = ไม่จำกัด เช่น iPort หรือไม่ใช่ CI/SUP) */
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
/** หัวไฟลท์ที่เป็นงานซัพพอร์ต (มีคำว่า SUPPORT/SUUPORT/SUPPORT ฯลฯ) — ไม่นับเป็นไฟลท์จริง */
function slaIsSupportFlight_(name) { return /SUU?PP?ORT/i.test(String(name || '')); }
function slaAirlineOf_(flight) {
  var s = String(flight || '').trim().toUpperCase();
  var m = s.match(/^([0-9A-Z]{2})\s*\d/);                   // 2-char IATA code (EK, 6E, G9, C6) + flight no.
  if (m) return m[1];
  var m2 = s.match(/([A-Z]{1,3})\s*\d/);
  return m2 ? m2[1] : 'DEFAULT';
}
/** เวลาเป็นนาที — '' หรือ 00:00 (placeholder) → null (ถือว่าไม่มีขานั้น) */
function slaRealMin_(x) { var v = acMin_(x); return v ? v : null; }
/** key รวมไฟลท์ = สายการบิน + เลขไฟลท์ "ตัวแรก" → TK172/173, TK172, TK172/TK173 = key เดียว
 *  (EY416/EY417 = EY416/417 = EY416 · CX773/778 ≠ CX778 เพราะเลขแรกต่างกัน) */
function slaFlightKey_(raw) {
  var s = String(raw || '').trim().toUpperCase();
  var m = s.match(/\d+/);                                   // เลขไฟลท์ชุดแรก
  return m ? (slaAirlineOf_(s) + String(parseInt(m[0], 10))) : s.replace(/[\s.\/]+/g, '');
}
/** required headcount per phase for an airline — ใช้ SLA_RQ (Manpower) ก่อน, ไม่งั้น roles */
function slaReq_(airline) {
  var c = String(airline || '').toUpperCase();
  var rq = SLA_RQ[c] || (SLA_ALIAS[c] && SLA_RQ[SLA_ALIAS[c]]);
  if (rq) return { SUP: 1, CI: rq[1], ARR: rq[2], GATE: rq[3], total: rq[4] };   // SUP/FLT.Controller = 1 ต่อไฟลท์เสมอ
  var db = slaGet_(airline);
  var req = { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: db.total || 0 };
  (db.roles || []).forEach(function (r) {
    var ph = r[3] === 'ALL' ? 'SUP' : r[3];
    if (req[ph] === undefined) ph = 'CI';
    req[ph] += r[1];
  });
  req.SUP = 1;                                                                   // SUP/FLT.Controller = 1 ต่อไฟลท์เสมอ
  return req;
}

// ── บทบาทเต็มตามตาราง Manpower per Job (สำหรับแท็บ "จัดล่วงหน้า") ──────────────
// [SUP, FC, Check-in, Arrival, Standby, Gate Monitor, Gate Agent(+Post Dep), sepGate, total]
var SLA_ROLES = {
  '3K':[1,1,4,1,0,1,4,0,8], '3U':[1,1,4,1,0,1,4,0,8], '6B':[1,1,5,2,0,1,5,0,10], '6E':[1,1,5,1,0,1,5,1,9], '8L':[1,1,4,1,0,1,4,0,8],
  '8M':[1,1,3,1,0,1,5,0,7], '9C':[1,1,5,1,0,1,4,0,9], '9H':[1,1,4,1,0,1,4,0,8], 'AF':[1,1,9,1,0,1,5,0,13], 'AI':[1,1,6,1,0,1,4,0,10],
  'AK':[1,1,3,1,0,1,5,0,7], 'AQ':[1,1,3,1,0,1,4,0,7], 'AY':[1,1,5,1,0,1,5,0,9], 'BY':[1,1,5,2,0,1,5,0,10], 'C6':[1,1,4,1,0,1,4,0,8],
  'CA':[1,1,6,1,0,1,4,0,10], 'CX':[1,1,6,2,0,1,6,0,11], 'CZ':[1,1,6,1,0,1,4,0,10], 'DE':[1,1,6,2,0,1,6,0,11], 'DK':[1,1,7,1,0,1,6,0,11],
  'DV':[1,1,4,1,0,1,5,0,8], 'EK':[1,1,7,3,0,1,6,0,13], 'EO':[1,1,6,1,0,1,6,0,10], 'EY':[1,1,9,1,0,1,6,0,13], 'FM':[1,1,4,1,0,1,4,0,8],
  'FY':[1,1,4,1,0,1,4,0,8], 'G2':[1,1,6,1,0,1,5,0,10], 'G8':[1,1,4,1,0,1,4,0,8], 'G9':[1,1,4,1,0,1,4,0,8], 'HB':[1,1,4,1,0,1,4,0,8],
  'HH':[1,1,4,1,0,1,5,0,8], 'HO':[1,1,4,1,0,1,4,0,8], 'HU':[1,1,6,1,0,1,4,0,10], 'HX':[1,1,5,1,0,1,4,0,9], 'HY':[1,1,5,1,0,1,5,0,9],
  'IT':[1,1,4,1,0,1,5,0,8], 'IX':[1,1,4,1,0,1,4,0,8], 'JQ':[1,1,7,1,0,1,9,0,11], 'KC':[1,1,5,1,0,1,4,0,9], 'KE':[1,1,8,1,0,1,4,0,12], 'KY':[1,1,3,1,0,1,4,0,7],
  'LJ':[1,1,4,1,0,1,4,0,8], 'LO':[1,1,6,1,0,1,5,0,10], 'LY':[1,1,8,1,0,1,10,0,12], 'MH':[1,1,4,1,0,1,4,0,8], 'MU':[1,1,4,1,0,1,4,0,8],
  'N0':[1,1,5,1,0,1,5,0,9], 'N4':[1,1,6,1,0,1,6,0,10], 'NO':[1,1,6,1,0,1,6,0,10], 'OD':[1,1,5,1,0,1,5,0,9], 'OM':[1,1,4,1,0,1,4,0,8],
  'OQ':[1,1,4,1,0,1,4,0,8], 'OV':[1,1,4,1,0,1,4,0,8], 'OZ':[1,1,6,1,0,1,5,0,10], 'PG':[1,1,0,1,0,2,4,0,5], 'PN':[1,1,4,1,0,1,4,0,8],
  'QP':[1,1,4,1,0,1,4,0,8], 'QR':[1,1,9,2,0,1,6,0,14], 'QZ':[1,1,3,1,0,1,5,0,7], 'S7':[1,1,4,1,0,1,4,0,8], 'SG':[1,1,4,1,0,1,5,0,8], 'SQ':[1,1,5,1,0,1,5,0,9], 'SU':[1,1,8,1,0,1,5,0,12],
  'TK':[1,1,8,4,0,1,5,0,15], 'TR':[1,1,6,1,0,1,6,0,10], 'U6':[1,1,4,1,0,1,5,0,8], 'UO':[1,1,4,2,0,1,5,0,9], 'VJ':[1,1,5,1,0,1,5,0,9],
  'W5':[1,1,7,1,0,1,5,0,11], 'WK':[1,1,6,1,0,1,5,0,10], 'WY':[1,1,7,1,0,1,8,0,11], 'WZ':[1,1,6,1,0,1,6,0,10], 'ZF':[1,1,6,1,0,1,5,0,10],
  'ZH':[1,1,4,1,0,1,4,0,8],
};
/** บทบาทเต็มต่อไฟลท์ → {SUP,FC,CI,ARR,STB,GM,GA,sep,total} */
function slaRoles_(airline) {
  var c = String(airline || '').toUpperCase();
  var r = SLA_ROLES[c] || (SLA_ALIAS[c] && SLA_ROLES[SLA_ALIAS[c]]);
  if (!r) { var q = slaReq_(airline); return { SUP: 1, FC: 1, CI: q.CI, ARR: q.ARR, STB: 0, GM: 1, GA: Math.max(0, (q.total || 0) - 3 - q.CI - q.ARR), sep: false, total: q.total }; }
  return { SUP: r[0], FC: r[1], CI: r[2], ARR: r[3], STB: r[4], GM: r[5], GA: r[6], sep: !!r[7], total: r[8] };
}
/** เวลาเปิด-ปิดเคาน์เตอร์เช็คอินของไฟลท์ (จาก CI window) → "HH:MM-HH:MM" */
function slaCounterTime_(f) {
  var w = slaPhaseWindow_(f, 'CI');
  return w ? (rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440)) : '';
}
/** classify a job task code into a phase */
/** คืน "ทุกเฟส" ที่ task ครอบคลุม (agent 1 คนทำหลายงาน เช่น "PRIO/GA/PFD" = เช็คอิน+เกท)
 *  · [] = ไปเทรน/ประชุม (ไม่นับเป็นคนคุมไฟลท์) · ['CI'] = ค่าเริ่มต้น (เช็คอิน) */
function slaPhasesOf_(task) {
  var u = String(task || '').toUpperCase();
  if (!u) return ['CI'];
  if (/TRAINING|LOAD CONTROL|IN.?HOUSE|MEETING|E-?LEARN|SEMINAR/.test(u)) return [];   // เทรน/ประชุม → ไม่คุมไฟลท์
  var p = {};
  if (/\bSUP\b|SPVR|\bSOD\b|\bSM\b|FLT\s*CTRL|FLIGHT\s*CONTROL/.test(u)) p.SUP = 1;        // หัวหน้าจริง
  if (/\bARR\b|ARRIVAL|MEET|\bAC\b|\bRF\b|ESCORT|BIR/.test(u)) p.ARR = 1;                    // arrival
  if (/\bGA\b|\bGM\b|\bGC\b|GATE|BOARD|BGO|BOCO|MAAS|PFD|GBD|DEPART|^G[\b/CM-]|^D\b/.test(u)) p.GATE = 1;   // gate (GA/GM/GC)
  if (/\bCT\b|\bC\d|^C\b|\bY\d|\bJ\d|\bW\d|WEB|KIOSK|PRIO|PSM|\bFC\b|\bGK\b|\bSD\b|CHECK|CKIN|CREW|\bCS\b|\bFR\b/.test(u)) p.CI = 1;   // เช็คอิน/เคาน์เตอร์/crew sign
  var keys = Object.keys(p);
  return keys.length ? keys : ['CI'];   // ไม่เข้าเกณฑ์ใด → เช็คอิน (ค่าเริ่มต้น)
}

/** ทีมที่ไม่เกี่ยวกับ SLA เช็คอิน/เกท — ไม่นับใน Flights & SLA / Support */
function slaSkipTeam_(team) {
  var t = String(team || '').toUpperCase();
  return t.indexOf('PORTER') >= 0 || t.indexOf('CREWSIGN') >= 0 || t.indexOf('CREW SIGN') >= 0 ||
         (t.indexOf('ADMIN') >= 0 && t.indexOf('DOC') >= 0);
}

/** collect all flights from the day's roster (PSA + LL), with assigned staff. */
function slaCollectFlights_(res, ll) {
  var flights = {};
  function add(team, rec) {
    (rec.assignments || []).forEach(function (a) {
      var raw = String(a.flight || '').trim();
      var key = slaFlightKey_(raw);                          // รวมไฟลท์เดียวกัน (เลขไฟลท์แรกตรง = key เดียว) เก็บชื่อตัวแรก
      if (!key) return;
      if (slaIsSupportFlight_(key)) return;                  // SUPPORT/SUUPORT = งานซัพพอร์ต ไม่ใช่ไฟลท์จริง → ข้าม
      if (!acIsFlight_(raw)) return;                         // เคาน์เตอร์/พูล (Counter Gx ของ SU, LP MORNING/AFTERNOON, งานอื่นๆ) ไม่ใช่ไฟลท์ → ไม่วัด SLA
      if (!flights[key]) {
        flights[key] = { flight: raw, airline: slaAirlineOf_(key), teams: {},
          STA: a.STA || '', STD: a.STD || '', OP: a.OP || '', CL: a.CL || '',
          assigned: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 }, staff: [] };
      }
      var f = flights[key];
      f.teams[team] = true;
      if (!f.STA && a.STA) f.STA = a.STA; if (!f.STD && a.STD) f.STD = a.STD;
      if (!f.OP && a.OP) f.OP = a.OP; if (!f.CL && a.CL) f.CL = a.CL;
      var phs = slaPhasesOf_(a.task);
      if (!phs.length) { f.staff.push({ name: rec.name, pos: rec.pos, team: team, task: a.task, phase: 'TRAIN' }); return; }   // ไปเทรน → แสดงได้ แต่ไม่นับเป็นคนคุมไฟลท์
      phs.forEach(function (ph) { f.assigned[ph]++; });          // นับทุกเฟสที่คนนี้ครอบคลุม
      f.assigned.total++;                                        // total = headcount (1 คน นับ 1)
      f.staff.push({ name: rec.name, pos: rec.pos, team: team, task: a.task, phase: phs.join('/') });
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
  var arr = Object.keys(flights).map(function (k) {
    var f = flights[k];
    f.req = slaReq_(f.airline);
    // leg-based: ตัด phase ตามขาที่ไฟลท์มีจริง (STD=ขาออก / STA=ขาเข้า · 00:00/ว่าง = ไม่มีขานั้น)
    var hasDep = slaRealMin_(f.STD) != null, hasArr = slaRealMin_(f.STA) != null;
    f.noTime = !hasDep && !hasArr;                            // ไม่มีทั้งคู่ = ข้อมูลเวลาหาย (ไม่ใช่ขาเดียว) → คงความต้องการเต็ม
    if (!f.noTime) {                                          // ตัด phase เฉพาะกรณี "มีขาเดียวจริง"
      var extra = Math.max(0, f.req.total - (f.req.SUP + f.req.CI + f.req.GATE + f.req.ARR));  // เกท "จากเช็คอิน" (departure)
      if (!hasDep) { f.req.CI = 0; f.req.GATE = 0; extra = 0; } // ขาเข้าอย่างเดียว → ไม่ต้องการ Check-in/Gate/คนเสริม
      if (!hasArr) { f.req.ARR = 0; }                           // ขาออกอย่างเดียว → ไม่ต้องการ Arrival
      f.req.total = f.req.SUP + f.req.CI + f.req.GATE + f.req.ARR + extra;
    }
    f.short = {};
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      var d = f.req[ph] - f.assigned[ph];
      if (d > 0) f.short[ph] = d;
    });
    f.shortTotal = Math.max(0, f.req.total - f.assigned.total);
    f.ok = Object.keys(f.short).length === 0 && f.shortTotal === 0;
    f.teamList = Object.keys(f.teams).join(',');
    return f;
  });
  // เศษขา (fragment): ไฟลท์ noTime ที่ "เลขไฟลท์ทุกตัว" ไปซ้ำกับไฟลท์ที่มีเวลาอยู่แล้ว = ขาที่สองซ้ำ → ซ่อนได้
  // (ส่วน noTime ที่ไม่มีเลขซ้ำเลย = ข้อมูลเวลาหายจริง → เก็บไว้เตือนให้เติม)
  var timedNums = {};
  arr.forEach(function (f) { if (!f.noTime) (String(f.flight).match(/\d+/g) || []).forEach(function (n) { timedNums[+n] = 1; }); });
  arr.forEach(function (f) {
    if (!f.noTime) { f.fragment = false; return; }
    var nums = (String(f.flight).match(/\d+/g) || []).map(Number);
    f.fragment = nums.length > 0 && nums.every(function (n) { return timedNums[n]; });
  });
  return arr.sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });
}

var SLA_PH_TH = { SUP: 'SUP', CI: 'Check-in', GATE: 'Gate', ARR: 'Arrival' };
function slaShortText_(f) {
  var parts = [];
  ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) { if (f.short[ph]) parts.push(SLA_PH_TH[ph] + ' ขาด ' + f.short[ph]); });
  return parts.length ? parts.join(' · ') : (f.shortTotal ? ('ขาดรวม ' + f.shortTotal) : '');
}

// ── SUPPORT FINDER: ใครว่าง + รู้ระบบเช็คอิน มาช่วยไฟลท์ที่ขาดได้ ──────────────
/** ระบบเช็คอินที่แต่ละทีม "ทำเป็น" = ระบบของสายการบินที่ทีมนั้นบินวันนี้ */
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
/** ทีมลอย/สแตนด์บายที่ Duty เรียกมาช่วยก่อน (PVTLP = PRIVATE/LP pool, STBY) */
function slaIsFloatTeam_(team) {
  var t = String(team || '').toUpperCase();
  return /PVT|PRIVATE|\bLP\b|FLOAT|STBY|STAND ?BY/.test(t);
}
/** พนักงานที่มาทำงาน + เวลางาน + ช่วงที่ติดไฟลท์ + ระบบที่ทำเป็น (สำหรับหาคนว่าง)
 *  includeOff=true → รวมคนวันหยุด (OFF) ไว้เป็นตัวเลือก "re-sked" (ว่างทุกช่วง · จัดเวลาให้ใหม่ได้) */
function slaSupportPool_(res, ll, teamSys, includeOff) {
  var pool = [];
  function add(team, r) {
    var off = (r.bucket === 'off');
    if (!off && r.bucket !== 'working' && r.bucket !== 'ot_off') return;   // sick/leave/vac ไม่ดึง
    if (off && !includeOff) return;                                        // คน OFF เฉพาะตอนเปิด re-sked
    if (slaSkipTeam_(team)) return;                          // Porter / Crewsign / Admin Doc ไม่เป็นคนช่วย
    var d = acDuty_(r), ds = d.ds, de = d.de;
    if (off) {
      // OFF (re-sked): ถ้ายังมี "กะรายสัปดาห์" ติดอยู่ (เช่น X9=00:00-09:00) → เคารพเวลากะนั้น
      // ไม่สมมุติว่าว่าง 24 ชม. (กันแนะคนกะเช้าไปช่วยไฟลท์บ่าย) · ไม่มีกะระบุ → ว่างทุกช่วง จัดเวลาใหม่ได้
      if (ds == null || de == null) { ds = -100000; de = 100000; }
    }
    if (ds == null || de == null) return;
    var busy = [];
    if (!off) (r.assignments || []).forEach(function (a) { var w = acFlightWin_(a); if (w) busy.push(w); });
    var flts = off ? [] : (r.assignments || []).filter(function (a) { return acIsFlight_(a.flight); })
      .map(function (a) {
        var tm = (a.STA || a.STD) ? (' ' + (a.STA || '–') + '-' + (a.STD || '–'))
               : ((a.OP || a.CL) ? (' ' + (a.OP || '–') + '-' + (a.CL || '–')) : '');
        return a.flight + tm;
      });
    // ช่วงเวลา re-sked (แบบ Duty: "re-sked 11-20") — จากกะรายสัปดาห์ที่เคารพไว้ · ไม่มีกะ → "ทุกช่วง"
    var offWin = (off && ds > -100000 && de < 100000)
      ? (rrFmtMin_(((ds % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((de % 1440) + 1440) % 1440)) : '';
    pool.push({ name: r.name, id: r.id || '', team: team, pos: r.pos || '', posGroup: r.posGroup || '', off: off,
      float: slaIsFloatTeam_(team),
      ds: ds, de: de, busy: busy, sys: teamSys[team] || {}, nflt: flts.length,
      shiftDisp: off ? ('OFF · re-sked ' + (offWin || 'ทุกช่วง') + (r.shift && r.shift.toUpperCase() !== 'OFF' ? ' (' + r.shift + ')' : ''))
                     : (r.bucket === 'ot_off' ? 'OFF (มา OT)' : ((r.shiftTime && r.shiftTime !== r.shift) ? (r.shift + ' ' + r.shiftTime) : (r.shift || r.shiftTime || '-'))),
      otDisp: r.ot > 0 ? (r.ot + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) + (r.otTime ? ' ' + r.otTime : '')) : '-',
      hrs: Math.round(((r.shiftHrs || 0) + (r.ot || 0)) * 10) / 10, flts: flts });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { add(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { add('LL·' + s, r); }); });
  return pool;
}
/** เวลา (นาที) ของแต่ละ phase สำหรับไฟลท์ (อิง STD + offset ของสายการบิน) */
function slaPhaseWindow_(f, ph) {
  var db = slaGet_(f.airline);
  var m = function (x) { var v = acMin_(x); return v ? v : null; };   // 00:00 = placeholder → null
  var std = m(f.STD), sta = m(f.STA);
  if (ph === 'CI')  return std != null ? [std + db.ci, std + db.cc] : null;
  var post = (db.post != null) ? db.post : SLA_POST;   // post-flight รายสาย (full-service 30 / LCC 20)
  if (ph === 'GATE') {                                  // Duty: STA−30 → STD (turnaround) · ขาออกอย่างเดียว → STD−90
    var gs = sta != null ? sta - 30 : (std != null ? std - 90 : null);
    var ge = std != null ? std + post : (sta != null ? sta + post : null);
    return (gs != null && ge != null) ? [gs, ge] : null;
  }
  if (ph === 'ARR') {                                   // Duty: STA−30 → STD (arrival/transfer ถึงขาออก) · ไม่มี STD → STA+post
    var as = sta != null ? sta - 30 : null;
    var ae = std != null ? std + post : (sta != null ? sta + post : null);
    return (as != null && ae != null) ? [as, ae] : null;
  }
  if (ph === 'SUP') return std != null ? [std + db.ci, std + post] : (sta != null ? [sta - 20, sta + post] : null);
  return null;
}
/** หาคนที่มาช่วยไฟลท์ f ใน phase ph ได้
 *  · CI  = รู้ระบบเช็คอินของสายการบินนั้น + ว่าง (ตำแหน่งใดก็ได้)
 *  · SUP = ต้องเป็นตำแหน่ง Sup + รู้ระบบนั้น + ว่าง (สำหรับ Sup/Flight Controller)
 *  · GATE/ARR = ไม่ต้องใช้ระบบ · เรียงลำดับ Agent → Senior → Sup */
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
    // ทำงานก่อน OFF · ทีมลอย(PVTLP/STBY)ก่อน · งานน้อยกว่าก่อน (Duty เรียกทีมลอยก่อน)
    cands.sort(function (a, b) { return (a.off ? 1 : 0) - (b.off ? 1 : 0) || (a.float ? 0 : 1) - (b.float ? 0 : 1) || a.nflt - b.nflt || String(a.team).localeCompare(b.team); });
  } else {
    // CI / GATE / ARR: ทำงานก่อน OFF · ทีมลอยก่อน · Agent → Senior → Sup · งานน้อย/ว่างกว่าก่อน
    var PRI = { PSA: 0, SNR: 1, PSS: 2 };
    cands.sort(function (a, b) {
      return (a.off ? 1 : 0) - (b.off ? 1 : 0) ||
        (a.float ? 0 : 1) - (b.float ? 0 : 1) ||
        (PRI[a.posGroup] == null ? 3 : PRI[a.posGroup]) - (PRI[b.posGroup] == null ? 3 : PRI[b.posGroup]) || a.nflt - b.nflt;
    });
  }
  return max ? cands.slice(0, max) : cands;
}
function slaWinTxt_(f, ph) {
  var w = slaPhaseWindow_(f, ph);
  return w ? (rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440)) : '';
}

/** Sheet tab: ✈️ Flights & SLA — day's flights + required vs assigned + shortage */
function rbWriteFlightSLA_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '✈️ Flights & SLA';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);

  var flights = slaCollectFlights_(res, ll).filter(function (f) { return !(f.noTime && f.fragment); });   // ซ่อนเศษขา (ขาที่สองซ้ำ)
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
/** สร้างรายการ "ไฟลท์ขาด + ใครมาช่วยได้" (ต่อ 1 phase ที่ขาด = 1 แถว) */
function slaSupportRows_(res, ll) {
  var flights = slaCollectFlights_(res, ll).filter(function (f) { return !f.ok && !f.noTime; });
  var teamSys = slaTeamSystems_(res, ll);
  var pool = slaSupportPool_(res, ll, teamSys, true);          // รวมคน OFF (re-sked) เป็นตัวเลือกท้ายสุด
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
          return { name: c.name, pos: slaPosShort_(c.posGroup), team: c.team, off: !!c.off,
                   shift: c.shiftDisp, ot: c.otDisp, hrs: c.hrs, n: c.nflt, flts: c.flts };
        }),
        nCand: cands.length,
      });
    });
  });
  return rows;
}
/** จัดกลุ่มคนช่วยตามทีม (ให้เลือกได้ว่าจะดึงจากทีมไหน) → [{team, people:[...]}] */
function slaGroupCands_(cands) {
  var by = {}, order = [];
  cands.forEach(function (c) { if (!by[c.team]) { by[c.team] = []; order.push(c.team); } by[c.team].push(c); });
  return order.map(function (t) { return { team: t, people: by[t] }; });
}

/** ข้อความ SOS ขอคนซัพ (คัดลอกส่งไลน์) — จัดกลุ่มตามไฟลท์
 *  · ลิสต์เฉพาะ "คนทีมอื่น" ที่ส่งมาช่วย (cands ตัดทีมเจ้าของไฟลท์ออกแล้วใน slaCandidates_)
 *  · เลือก top N ตามจำนวนที่ขาด (N = shortN) เป็นตัวตั้งต้น */
function slaSOSText_(res, ll, dateStr) {
  var rows = slaSupportRows_(res, ll);
  var byFlt = {}, order = [];
  rows.forEach(function (r) {
    if (!byFlt[r.flight]) { byFlt[r.flight] = { first: r, ph: [] }; order.push(r.flight); }
    byFlt[r.flight].ph.push(r);
  });
  if (!order.length) return '✅ ทุกไฟลท์ส่งคนครบตาม SLA — ไม่ต้องขอ Support';
  var out = ['🆘 ขอ Support' + (dateStr ? ' — ' + dateStr : '')];
  order.forEach(function (fl) {
    var g = byFlt[fl], f = g.first;
    out.push('');
    out.push(f.flight + (f.STD ? '  STD ' + f.STD : '') + (f.system ? '  · ' + f.system : ''));
    g.ph.forEach(function (r) {
      out.push('• ' + r.phase + ' ขาด ' + r.shortN + (r.win ? ' (' + r.win + ')' : ''));
      var picks = (r.cands || []).slice(0, r.shortN);
      if (picks.length) picks.forEach(function (c, i) { out.push('   ' + (i + 1) + '. ' + c.name + ' / ' + c.team + (c.off ? '  (OFF·re-sked)' : '')); });
      else out.push('   — ' + (r.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + r.needSys : 'ไม่มีคนว่าง'));
    });
  });
  return out.join('\n');
}

/** Sheet tab: 🆘 Support — ไฟลท์ขาด + แนะนำคนที่ว่างและรู้ระบบเช็คอินมาช่วย */
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


// ===== AssignCheck.gs =====

/**
 * AssignCheck.gs — ตรวจความเหมาะสมของการ Assign รายคน
 * =============================================================================
 * ต่อยอดจาก record ที่ RosterReader ผลิต (shiftTime / shiftStart / shiftHrs,
 * ot / otType / otTime, assignments[]{flight,task,STA,STD,OP,CL}) เพื่อตอบ 4 คำถาม
 * ที่หัวหน้าใช้ตัดสินตารางจริง:
 *
 *   1) เวลากะ (รวม OT) ครอบคลุมเที่ยวบินที่ได้รับมอบหมายไหม  → COVERAGE
 *   2) ให้ OT มาก/น้อยไปไหม                                  → OT FIT
 *   3) มีช่วงว่าง (idle gap) ตรงไหนบ้าง                        → GAP
 * คนที่ไม่มีไฟลท์เลย (bench/standby/support เช่น WY SNR/Agent) จะนับเป็น
 * ตัวเลขสรุปเฉย ๆ ไม่ flag เป็นปัญหารายแถว เพื่อไม่ให้ตารางรก.
 *
 * หน้าต่าง "เวลางาน" (duty window) = ช่วงเวลากะ ขยายด้วย OT ก่อนกะ/หลังกะ
 * (ถ้ามีช่วงเวลา OT ระบุก็ใช้ช่วงนั้น ไม่งั้นขยายด้วยจำนวนชั่วโมง OT).
 * "หน้าต่างไฟลท์" = ช่วง min–max ของเวลา STA/STD/OP/CL ของไฟลท์นั้น.
 * ไฟลท์ถือว่า "ครอบคลุม" เมื่ออยู่ในเวลางาน (มี tolerance ±COVER_TOL นาที).
 *
 * เกณฑ์ (ปรับได้):
 *   COVER_TOL = 60 นาที   — ผ่อนผันก่อน/หลังไฟลท์ (มาทันเคาน์เตอร์เปิด = ครอบคลุม)
 *   GAP_MIN   = 180 นาที  — ช่วงว่างระหว่างไฟลท์ (split-duty dead time) ที่จะแจ้ง
 *   EDGE_MIN  = 240 นาที  — ช่วงว่างก่อนไฟลท์แรก/หลังไฟลท์สุดท้าย (prep/standby) ที่จะแจ้ง
 *
 * Entry: acAnalyze_(res, ll) -> { rows:[...], summary:{...} }
 *        rbWriteAssignCheck_(ss, res, dateStr, ll, tabName) -> เขียนแท็บรายงาน
 */

var AC_COVER_TOL = 60;   // ผ่อนให้ "มาทันเคาน์เตอร์เปิด" = ครอบคลุม (บรีฟ 60 นาทีเป็นช่วงเตรียม)
var AC_GAP_MIN   = 180;
var AC_EDGE_MIN  = 240;

function acMin_(s) {
  var m = String(s == null ? '' : s).match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1] * 60 + +m[2]) : null;
}

/** ไฟลท์จริง (มีรหัสไฟลท์) ที่ต้องเช็คครอบคลุม — ไม่ใช่ pool/counter/common
 *  (CHECK-IN COMMON, LP MORNING/AFTERNOON, Counter G2/G11, Gate A1 ฯลฯ).
 *  รหัสไฟลท์จริงจะ "ขึ้นต้น" ด้วยโค้ดสายการบิน (EK378, 6E1077, G9687, QZ246) —
 *  งานเคาน์เตอร์/zone จะขึ้นต้นด้วยคำอังกฤษ (Counter/Gate/LP …) จึงตัดด้วย prefix. */
function acIsFlight_(name) {
  var s = String(name || '').trim().toUpperCase();
  if (!s) return false;
  if (/^(COUNTER|GATE|CHECK|ZONE|BELT|PIER|STBY|STAND|POOL|OFFICE|BRIEF|NIL|OFF\b|LP\s+(MORNING|AFTERNOON|NIGHT|DAY))/.test(s)) return false;
  // ต้องขึ้นต้นด้วยรหัสสายการบิน IATA 2 ตัว (ตัวอักษร+ตัวอักษร/เลข หรือ เลข+ตัวอักษร) ตามด้วยเลขไฟลท์
  // กันรหัสสนามบิน 3 ตัวอักษร (เช่น "ORY 08", "DMK 12") ที่ไม่ใช่ไฟลท์จริง
  return /^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*\d{2,4}/.test(s);
}

/** งานอบรม/เทรน/ประชุม/กิจกรรม (ไม่ใช่งานหน้าไฟลท์จริง) — นับเป็น "งาน 1 อย่าง" แต่ไม่นับเป็นไฟลท์ที่ต้องครอบคลุม
 *  (เช็คจาก task หรือชื่อรายการ · เลี่ยง CLASS/COURSE เพราะชน Business/First Class · เลี่ยง OJT/MEET เพราะเป็นงานหน้าไฟลท์) */
function acIsActivity_(s) {
  var u = String(s || '').toUpperCase();
  if (!u) return false;
  return /TRAINING|RECURRENT|WORKSHOP|ORIENTATION|SEMINAR|MEETING|E-?LEARNING|\bLMS\b|\bEXAM\b|อบรม|เทรน|ประชุม|สัมมนา|กิจกรรม|สอนงาน|ทดสอบ|\bสอบ\b/.test(u);
}

/** [lo,hi] นาทีที่พนักงาน "cover" ไฟลท์ = ตั้งแต่ "เวลาบรีฟ" จนถึง STD
 *  · เวลาบรีฟ = เวลาเปิดเคาน์เตอร์ (OP จากไฟล์ หรือ STD+ci) ลบเวลาบรีฟของสายการบิน
 *  · จบที่ STD (เครื่องออก)
 *  · ไฟลท์ขาเข้าล้วน (ไม่มี STD) → รอบ STA (บรีฟ→STA+post)
 *  00:00 เป็น placeholder ตัดทิ้ง. คืน null ถ้าไม่มีเวลา. */
function acFlightWin_(a) {
  // อบรม/เทรน/ประชุม ที่ระบุช่วงเวลาในข้อความ (เช่น "TRAINING ... 08-17") → ใช้ช่วงนั้นเป็นเวลางาน (busy/gap ถูกต้อง)
  var atxt = String((a.task || '') + ' ' + (a.flight || ''));
  if (acIsActivity_(atxt)) {
    var rg = atxt.match(/(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?/);
    if (rg) { var alo = (+rg[1]) * 60 + (+(rg[2] || 0)), ahi = (+rg[3]) * 60 + (+(rg[4] || 0)); if (ahi <= alo) ahi += 1440; return [alo, ahi]; }
  }
  function m(x) { var v = acMin_(x); return v ? v : null; }   // 00:00 = placeholder → null
  var sta = m(a.STA), op = m(a.OP), cl = m(a.CL), std = m(a.STD);
  var db = (typeof slaGet_ === 'function') ? slaGet_(slaAirlineOf_(a.flight)) : null;
  var brief = (db && db.brief) || 60, ci = (db && db.ci) || -180, post = (db && db.post != null) ? db.post : SLA_POST;   // post-flight รายสาย
  var lo = null, hi = (std != null) ? std + post : null;      // hi = STD + post (รวมงาน post-flight)
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

/** หน้าต่างเวลางาน (duty) ของหนึ่ง record. */
function acDuty_(r) {
  var sr = rrRangeStr_(r.shiftTime || '');
  var ss = sr[0], se = sr[1];
  if (ss != null && se != null && se <= ss) se += 1440;
  if (ss == null && r.shiftStart != null && r.shiftHrs) {
    ss = r.shiftStart; se = ss + Math.round(r.shiftHrs * 60);
  }
  // ช่วง OT ทั้งหมด (EY อาจมีทั้งก่อนกะ+หลังกะ) — ใช้ r.otSpans ถ้ามี ไม่งั้น parse จาก otTime
  var spans = [];
  if (r.otSpans && r.otSpans.length) {
    r.otSpans.forEach(function (sp) { if (sp && sp.a != null) spans.push({ a: sp.a, b: sp.b, type: sp.type || null }); });
  } else {
    var orr = rrRangeStr_(r.otTime || '');
    if (orr[0] != null) spans.push({ a: orr[0], b: orr[1], type: r.otType || null });
  }

  var ds = ss, de = se;
  if (r.bucket === 'ot_off') {
    // OT OFF = วันหยุดมาทำ OT — เวลางานจริง = ช่วง OT เท่านั้น (ไม่ใช่กะปกติที่ค้างอยู่)
    if (spans.length) { var s0 = spans[0], a0 = s0.a, b0 = s0.b; if (a0 != null && b0 != null && b0 <= a0) b0 += 1440; ds = a0; de = b0; }
    else { ds = null; de = null; }
  } else if (spans.length) {
    spans.forEach(function (sp) {
      var oi = sp.a, oo = sp.b; if (oi == null) return;
      if (oo == null) oo = oi;
      var a = oi, b = oo; if (b <= a) b += 1440;             // ช่วงข้ามคืนภายในตัว
      var t = sp.type || rrOtType_([ss, se], [oi, oo], false);
      if (t === 'PRE') {                                     // OT ก่อนกะ → ปลาย OT แตะต้นกะ, ขยาย ds
        while (ss != null && b - ss > 720) { a -= 1440; b -= 1440; }
        while (ss != null && ss - b > 720) { a += 1440; b += 1440; }
      } else {                                               // OT หลังกะ → ต้น OT ต่อจากปลายกะ (รวมข้ามเที่ยงคืน), ขยาย de
        while (se != null && a - se > 720) { a -= 1440; b -= 1440; }
        while (se != null && se - a > 720) { a += 1440; b += 1440; }
      }
      ds = (ds == null) ? a : Math.min(ds, a);
      de = (de == null) ? b : Math.max(de, b);
    });
  } else if (r.ot > 0 && ss != null) {
    if (r.otType === 'PRE') ds = ss - Math.round(r.ot * 60);
    else de = se + Math.round(r.ot * 60);
  }
  return { ss: ss, se: se, ds: ds, de: de };
}

/** วิเคราะห์ความเหมาะสมของหนึ่ง record (ที่มาทำงาน). */
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
    var isAct = acIsActivity_(a.task) || acIsActivity_(a.flight);   // เทรน/อบรม/ประชุม = งาน แต่ไม่นับเป็นไฟลท์ที่ต้องครอบคลุม (ไม่ flag นอกเวลา)
    var w = acFlightWin_(a);
    if (!w) { if (isAct) out.actN = (out.actN || 0) + 1; return; }   // กิจกรรมไม่มีเวลา → ยังนับเป็นงาน
    var lo = w[0], hi = w[1];
    if (d.ds != null && d.de != null) { var fa = rrAlignTo_(lo, hi, d.ds, d.de); lo = fa[0]; hi = fa[1]; }  // จัดไฟลท์ให้อยู่ timeline เดียวกับเวลางาน (ข้ามเที่ยงคืน)
    else if (d.ds != null && lo < d.ds - 720) { lo += 1440; hi += 1440; }
    out.wins.push({ flight: a.flight, lo: lo, hi: hi, coverable: acIsFlight_(a.flight) && !isAct, activity: isAct });
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
      if (r.otType === 'PRE'  && d.ss != null && w.lo <  d.ss) justified = true;   // ไฟลท์โผล่ก่อนกะ = OT จำเป็น
      if (r.otType !== 'PRE'  && d.se != null && w.hi >  d.se) justified = true;   // ไฟลท์ลากเลยกะ = OT จำเป็น
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
  out.noFlight = (out.flightN === 0 && out.wins.length === 0 && !out.actN && r.bucket === 'working');  // มีงานเคาน์เตอร์/อบรม = ไม่ใช่ว่าง
  return out;
}

/** ทีม "เจ้าของ" ของแต่ละสายการบิน = ทีมที่มีพนักงานทำไฟลท์สายการบินนั้นมากสุด
 *  (ใช้บอกว่าไฟลท์ไหนเป็นการ "ซัพพอร์ตข้ามทีม") */
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

/** วิเคราะห์ทั้งไฟล์ (PSA teams + LL sections). คืน rows ที่ต้องตรวจ + summary. */
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
        gapsRaw: a.gaps.map(function (g) { return g.a + '~' + g.b; }).join(','),   // นาทีดิบ สำหรับกรองช่วงเวลา (~ กันค่าติดลบ)
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


// ===== AutoPlan.gs =====

/**
 * AutoPlan.gs — ตัวช่วยจัดเวรอัตโนมัติ (ข้อเสนอ "อ่านอย่างเดียว" ไม่แตะไฟล์ต้นฉบับ)
 * =============================================================================
 * สร้างแท็บข้อเสนอ "🤖 จัดเวรอัตโนมัติ" จากข้อมูลที่ parse แล้ว 2 โหมด:
 *
 *   A) เติมเฉพาะไฟลท์ที่คนไม่พอ (gap-fill) — ต่อยอดจากตารางจริง
 *      ดูว่าไฟลท์ไหนส่งคนไม่ครบ SLA แล้ว "จัดคนว่าง (ข้ามทีม)" มาเสริมจริง
 *      โดยไม่ให้คนคนเดียวถูกดึงซ้ำ (commit แล้วล็อกเวลาไว้)
 *
 *   B) จัดเวรใหม่ทั้งหมด (full re-plan) — ล้างการ assign เดิม แล้วเอาคนที่
 *      ขึ้นเวรวันนั้นทั้งพูล มาจัดลงไฟลท์/บทบาทใหม่ให้ครบ SLA ทุกไฟลท์
 *
 * ใช้ primitive จาก SLA.gs / AssignCheck.gs ทั้งหมด:
 *   slaCollectFlights_ · slaSupportPool_ · slaTeamSystems_ · slaPhaseWindow_ ·
 *   slaNeedSys_ · slaWinTxt_ · slaReq_ · acOwnerTeams_ · rrFmtMin_
 *
 * หลักการจัด (greedy): ไล่ไฟลท์ตามเวลา → แต่ละ phase ที่ต้องการ → เลือกคนที่
 *   1) ระบบเช็คอินตรง (เฉพาะ CI/SUP, iPort = ใครก็ได้)  2) ตำแหน่งเหมาะกับ phase
 *   3) เวลางานครอบช่วงนั้น & ไม่ติดไฟลท์อื่น  4) งานยังน้อย (กระจายงาน)
 * เลือกได้ก็ "ล็อก" เวลาคนนั้นไว้ กันโดนจัดซ้ำ. ถ้าไม่พอ → บันทึกว่ายังขาดกี่คน.
 *
 * Entry: apFillGaps_(res, ll) · apReplan_(res, ll)
 *        rbWriteFillPlan_ / rbWriteAutoAssign_ (ชีต) · rbFillPlanHtml / rbAutoAssignHtml (เว็บ)
 */

var AP_TOL = 30;   // ผ่อนเวลาเข้า/ออกงานรอบหน้าต่าง phase (นาที)

/** clone พูลคนว่าง ให้พร้อมจัด (ก๊อป busy เพื่อไม่กระทบของจริง + ตัวนับงานที่จัด) */
function apClonePool_(res, ll) {
  var teamSys = slaTeamSystems_(res, ll);
  var pool = slaSupportPool_(res, ll, teamSys);
  pool.forEach(function (p) {
    p.busy = (p.busy || []).map(function (b) { return [b[0], b[1]]; });   // clone กัน mutate ของจริง
    p.plan = 0;                                                           // จำนวนที่จัดให้ในแผนนี้
  });
  return pool;
}

/** คน p ว่างในหน้าต่าง win ไหม (เวลางานครอบ + ไม่ชนงานที่ถือ/จัดไว้แล้ว) */
function apFree_(p, win) {
  if (!win) return true;                                                  // ไม่มีเวลา → ไม่จำกัด
  if (!(p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL)) return false;
  for (var i = 0; i < p.busy.length; i++) {
    var b = p.busy[i];
    if (win[0] < b[1] - 10 && win[1] > b[0] + 10) return false;           // ซ้อนทับ
  }
  return true;
}

/** คน p ทำ phase ph ของไฟลท์ f ได้ไหม (ระบบ + ตำแหน่ง + เวลาว่าง) */
function apEligible_(p, f, ph, win, sameTeamOk) {
  if (!sameTeamOk && f.teams && f.teams[p.team]) return false;            // โหมดเสริม = ข้ามทีมเท่านั้น
  var needSys = slaNeedSys_(f.airline, ph);
  if (needSys && !p.sys[slaSysNorm_(needSys)]) return false;              // CI/SUP ต้องรู้ระบบ (ยกเว้น iPort)
  if (ph === 'SUP' && p.posGroup !== 'PSS') return false;                 // SUP/Flight Controller ต้องเป็น Sup
  return apFree_(p, win);
}

/** คะแนนเลือกคน (น้อย = ดีกว่า): ตำแหน่งเหมาะ + ทีมเดิม + งานน้อย */
function apScore_(p, ph, homeTeam) {
  var s = 0;
  if (ph === 'SUP')      s += (p.posGroup === 'PSS' ? 0 : 6);
  else if (ph === 'CI')  s += (p.posGroup === 'PSA' ? 0 : (p.posGroup === 'SNR' ? 1 : 3));
  else                   s += (p.posGroup === 'PSA' ? 0 : (p.posGroup === 'SNR' ? 1 : 2));   // GATE/ARR
  if (homeTeam && p.team === homeTeam) s -= 3;                            // ลดการสลับข้ามทีม
  s += p.plan * 2;                                                        // กระจายงาน
  return s;
}

/** เลือกคนดีที่สุด 1 คนมาจัด 1 สลอต แล้ว "ล็อก" เวลาไว้ (กันจัดซ้ำ) */
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

/** ข้อมูลคนที่ถูกจัด (พร้อมรายละเอียดงาน/OT/ไฟลท์ สำหรับโชว์ชิพ + popup) */
function apPersonView_(p) {
  return { name: p.name, pos: slaPosShort_(p.posGroup), team: p.team,
           shift: p.shiftDisp, ot: p.otDisp, hrs: p.hrs, n: p.nflt, flts: p.flts || [] };
}

// ─── Common check-in (SU/SQ): เคาน์เตอร์รวมหมุนเวียน + เกทต่อไฟลท์ ────────────
var AP_SU_MAXSIT = 180;                                                 // นั่งเคาน์เตอร์รวมต่อเนื่องสูงสุด 3 ชม./คน
var AP_COMMON_CI = [
  { code: 'SU', team: 'SU',
    counters: (typeof ADV_SU_COUNTERS !== 'undefined' ? ADV_SU_COUNTERS
      : ['G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12','H2','H3','H4','H5','H6']),
    gate: true,  mainExclude: ['SUP', 'CI', 'GATE', 'ARR'] },             // SU: ถอดทั้งไฟลท์จากตารางหลัก (เคาน์เตอร์+เกทคุมเอง)
  { code: 'SQ', team: 'SQ', nCounter: 7,
    gate: false, mainExclude: ['CI'] },                                   // SQ: เฉพาะเช็คอินคอมมอน (เกท/อื่นๆ ยังอยู่ตารางหลัก)
];
function apCfgOf_(code) {
  for (var i = 0; i < AP_COMMON_CI.length; i++) if (AP_COMMON_CI[i].code === code) return AP_COMMON_CI[i];
  return null;
}
function apFlightCode_(f) {                                              // โค้ดสายการบินของไฟลท์ (เทียบ alias)
  var a = f.airline; return (typeof SLA_ALIAS !== 'undefined' && SLA_ALIAS[a]) ? SLA_ALIAS[a] : a;
}
/** จัด common check-in 1 ทีม → {code,team,fc,members,counters,gates,flights} (commit=true → ล็อกเวลาคน, fcName=เลือก FC เอง) */
function apCommonCI_(pool, flights, cfg, commit, fcName) {
  var teamFl = flights.filter(function (f) { return acIsFlight_(f.flight) && !f.noTime && apFlightCode_(f) === cfg.code; });
  if (!teamFl.length) return null;
  var teamSet = {};                                                     // ทีมที่ทำไฟลท์เหล่านี้ (รองรับชื่อแท็บที่ต่างกัน)
  teamFl.forEach(function (f) { Object.keys(f.teams || {}).forEach(function (t) { teamSet[t] = 1; }); });
  var su = pool.filter(function (p) { return (typeof otCanonTeam_ === 'function') && otCanonTeam_(p.team) === cfg.team; });  // เฉพาะคนทีมนี้จริง (ไม่ใช่คนข้ามทีมที่มาช่วย)
  if (!su.length) su = pool.filter(function (p) { return teamSet[p.team]; });   // fallback ถ้าจับทีมไม่ได้
  var ctList = cfg.counters || (function () { var a = []; for (var i = 1; i <= cfg.nCounter; i++) a.push('CT' + i); return a; })();
  var pr = { PSA: 0, SNR: 1, PSS: 2 };
  var view = function (p) { return { name: p.name, pos: slaPosShort_(p.posGroup), shift: p.shiftDisp }; };
  var fmt = function (m) { return rrFmtMin_(((m % 1440) + 1440) % 1440); };
  teamFl.forEach(function (f) { f.ciwin = slaPhaseWindow_(f, 'CI'); });

  // 1) เช็คอินคอมมอน — รวมไฟลท์เวลาใกล้กันเป็นแบทช์ + หมุนเวียนรอบละ ≤3 ชม.
  var ciFl = teamFl.filter(function (f) { return f.ciwin; }).sort(function (a, b) { return a.ciwin[0] - b.ciwin[0]; });
  var batches = [];
  ciFl.forEach(function (f) {
    var b = batches[batches.length - 1];
    if (b && f.ciwin[0] <= b.end + 20) { b.end = Math.max(b.end, f.ciwin[1]); b.flights.push(f.flight); }
    else batches.push({ start: f.ciwin[0], end: f.ciwin[1], flights: [f.flight] });
  });
  // Flight Controller = หัวหน้า 1 คน (PSS ก่อน) คุมเช็คอินตลอดช่วง — ไม่นั่งเคาน์เตอร์ ไม่ลงเกท
  var fc = null;
  if (batches.length) {
    var ciStart = Math.min.apply(null, batches.map(function (b) { return b.start; }));
    var ciEnd = Math.max.apply(null, batches.map(function (b) { return b.end; }));
    var fcAvail = su.filter(function (p) { return p.ds <= ciStart + AP_TOL && p.de >= ciEnd - AP_TOL; });
    if (fcName) fc = fcAvail.filter(function (p) { return p.name === fcName; })[0] || null;   // เลือกเอง
    if (!fc) fc = fcAvail.sort(function (a, c) { return (pr[c.posGroup] == null ? -1 : pr[c.posGroup]) - (pr[a.posGroup] == null ? -1 : pr[a.posGroup]) || a.plan - c.plan; })[0] || null;
    if (fc) { fc.isFC = true; if (commit) { fc.busy.push([ciStart, ciEnd]); fc.plan++; (fc.flts = fc.flts || []).push('Flight Controller เช็คอิน (' + fmt(ciStart) + '-' + fmt(ciEnd) + ')'); } }
  }

  var counters = [];
  batches.forEach(function (b) {
    var avail = su.filter(function (p) { return !p.isFC && p.ds <= b.start + AP_TOL && p.de >= b.end - AP_TOL; })
      .sort(function (a, c) { return (pr[a.posGroup] == null ? 3 : pr[a.posGroup]) - (pr[c.posGroup] == null ? 3 : pr[c.posGroup]) || a.plan - c.plan; });
    var dur = b.end - b.start, nR = Math.max(1, Math.ceil(dur / AP_SU_MAXSIT)), rl = dur / nR;
    var perR = Math.min(ctList.length, Math.ceil(avail.length / nR));
    for (var r = 0; r < nR; r++) {
      var rs = b.start + Math.round(r * rl), re = (r === nR - 1) ? b.end : b.start + Math.round((r + 1) * rl);
      var people = avail.slice(r * perR, (r + 1) * perR);
      if (commit) people.forEach(function (p) { p.busy.push([rs, re]); p.plan++; (p.suCI = p.suCI || []).push([rs, re]); });
      var slots = ctList.map(function (ct, i) {
        if (commit && people[i]) (people[i].flts = people[i].flts || []).push('CI ' + ct + ' (' + fmt(rs) + '-' + fmt(re) + ')');
        return { counter: ct, chosen: people[i] ? view(people[i]) : null };
      });
      counters.push({ time: fmt(rs) + '-' + fmt(re), flights: b.flights.join(', '), round: nR > 1 ? (r + 1) + '/' + nR : 0, nAvail: avail.length, slots: slots });
    }
  });

  // 2) เกทต่อไฟลท์ (เฉพาะ cfg.gate · คนเดิมต่อจากเช็คอินก่อน · FC ไม่ลงเกท)
  var gates = null;
  if (cfg.gate) {
    var sla = (typeof slaGet_ === 'function') ? slaGet_(cfg.code) : null;
    var gdefs = ((sla && sla.roles) || []).filter(function (rr) { return rr[3] === 'GATE' || rr[3] === 'ARR'; })
      .map(function (rr) { var lb = /MONITOR|GM/.test(String(rr[0]) + rr[2]) ? 'GC' : (rr[3] === 'ARR' ? 'ARR' : 'GA'); return { lb: lb, n: rr[1], phase: rr[3], snr: lb === 'GC' }; })
      .sort(function (a, b) { return (b.snr ? 1 : 0) - (a.snr ? 1 : 0); });       // จัด GC ก่อน แล้วค่อย GA
    gates = teamFl.slice().sort(function (a, b) { return String(a.STD || '').localeCompare(String(b.STD || '')); }).map(function (f) {
      var usedF = {};
      var roles = gdefs.map(function (rd) {
        var win = slaPhaseWindow_(f, rd.phase) || [0, 0], picks = [];
        var ord = rd.snr ? { PSS: 0, SNR: 1, PSA: 2 } : { PSA: 0, SNR: 1, PSS: 2 };
        for (var i = 0; i < rd.n; i++) {
          var cand = su.filter(function (p) {
              var pid = p.id || p.name;
              if (p.isFC) return false;                                            // FC ไม่ลงเกท (ไม่ทำ GC/GA/ARR)
              if (rd.lb === 'GA' && !p.suCI) return false;                        // Gate Agent = คนที่เช็คอินแล้ว ต่อเนื่อง
              return !usedF[pid] && apFree_(p, win) && p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL;
            })
            .sort(function (a, c) {
              return ((c.suCI ? 1 : 0) - (a.suCI ? 1 : 0))
                || (ord[a.posGroup] == null ? 3 : ord[a.posGroup]) - (ord[c.posGroup] == null ? 3 : ord[c.posGroup]) || a.plan - c.plan;
            })[0];
          if (cand) { if (commit) { cand.busy.push([win[0], win[1]]); cand.plan++; (cand.flts = cand.flts || []).push(f.flight + ' ' + rd.lb); } usedF[cand.id || cand.name] = 1; picks.push(view(cand)); }
          else picks.push(null);
        }
        return { lb: rd.lb, need: rd.n, win: fmt(win[0]) + '-' + fmt(win[1]), picks: picks };
      });
      return { flight: f.flight, std: f.STD || '', roles: roles };
    });
  }
  return { code: cfg.code, team: cfg.team, fc: fc ? view(fc) : null, members: su.map(view), counters: counters, gates: gates, flights: teamFl.map(function (f) { return f.flight; }) };
}
/** รัน common check-in ทุกทีมที่กำหนด (commit ล็อกเวลา · fcByCode={SU:'ชื่อ'} เลือก FC เอง) → [commons] */
function apRunCommons_(pool, flights, commit, fcByCode) {
  var out = [];
  AP_COMMON_CI.forEach(function (cfg) { var r = apCommonCI_(pool, flights, cfg, commit, (fcByCode || {})[cfg.code]); if (r) out.push(r); });
  return out;
}
/** map: flight → {phase:1} ที่ถูก common check-in จัดไปแล้ว (ให้ตารางหลักข้าม) */
function apCommonExcl_(commons) {
  var m = {};
  (commons || []).forEach(function (cm) {
    var cfg = apCfgOf_(cm.code); if (!cfg) return;
    (cm.flights || []).forEach(function (fl) { m[fl] = m[fl] || {}; (cfg.mainExclude || []).forEach(function (ph) { m[fl][ph] = 1; }); });
  });
  return m;
}

/** โหมด A: เติมเฉพาะไฟลท์ที่คนไม่พอ — เลือกคนว่างข้ามทีมมาเสริมจริง (commit) */
function apFillGaps_(res, ll, fcByCode) {
  var flights = slaCollectFlights_(res, ll);
  var pool = apClonePool_(res, ll);
  var commons = apRunCommons_(pool, flights, true, fcByCode);             // SU/SQ เคาน์เตอร์รวม + เกท (ล็อกเวลาคน)
  var excl = apCommonExcl_(commons);
  var rows = [];
  flights.filter(function (f) { return acIsFlight_(f.flight) && !f.ok; }).forEach(function (f) {   // แสดงไฟลท์ไม่มีเวลาด้วย (ไม่ให้หายจากตาราง) · window=null จัดตามทีมได้
    var ex = excl[f.flight] || {};
    AP_PHASES.forEach(function (ph) {
      if (ex[ph]) return;                                                 // common check-in จัดแล้ว → ข้าม
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
  rows.commons = commons;                                                 // แนบ commons (ไม่กระทบ caller เดิมที่ใช้ array)
  return rows;
}

/** โหมด B: จัดเวรใหม่ทั้งหมด — ล้าง assign เดิม แล้วจัดทุกคนลงไฟลท์ให้ครบ SLA */
function apReplan_(res, ll, fcByCode) {
  var flights = slaCollectFlights_(res, ll);
  var owner = acOwnerTeams_(res, ll);
  var pool = apClonePool_(res, ll);
  pool.forEach(function (p) { p.busy = []; p.plan = 0; });                // จัดใหม่ → ล้างงานเดิมทั้งหมด
  var commons = apRunCommons_(pool, flights, true, fcByCode);             // SU/SQ เคาน์เตอร์รวม + เกท (ล็อกเวลาคนก่อน)
  var excl = apCommonExcl_(commons);

  var fl = flights.filter(function (f) { return acIsFlight_(f.flight); }).sort(function (a, b) {   // รวมไฟลท์ไม่มีเวลา (จัดเวรครบทุกไฟลท์)
    return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz'));
  });

  var plan = [];
  fl.forEach(function (f) {
    var home = owner[f.airline] || (f.teamList || '').split(',')[0] || '';
    var ex = excl[f.flight] || {};
    var assign = { SUP: [], CI: [], ARR: [], GATE: [] };
    var shortx = {};
    var phaseReq = { SUP: f.req.SUP, CI: f.req.CI, ARR: f.req.ARR, GATE: f.req.GATE };
    // TTL เกินผลรวม phase = พนักงานเสริม (เกท "จากเช็คอิน") → ปกติลงเป็น Check-in agent
    // แต่สายการบินที่ "ไม่มีเช็คอิน" (เช่น PG: CI=0 ตาม SLA) ให้ลงเป็น Gate agent แทน
    var sumPh = f.req.SUP + f.req.CI + f.req.ARR + f.req.GATE;
    var extra = Math.max(0, (f.req.total || 0) - sumPh);
    if (f.req.CI > 0) phaseReq.CI += extra; else phaseReq.GATE += extra;
    if (!AP_PHASES.some(function (ph) { return phaseReq[ph] && !ex[ph]; })) return;   // common check-in คุมทั้งไฟลท์ → ไม่ลงตารางหลัก
    AP_PHASES.forEach(function (ph) {
      if (!phaseReq[ph]) return;                                         // ไม่ต้องการ phase นี้ (เช่น PG ไม่มีเช็คอิน)
      if (ex[ph]) return;                                                // common check-in จัดแล้ว → ข้าม
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
  return { plan: plan, bench: bench, commons: commons, nPeople: pool.length,
    nAssigned: pool.filter(function (p) { return p.plan > 0; }).length,
    nFlights: plan.length };
}

// ─── ส่งออกผลจัดคนเป็นไฟล์ชีตแยก (1 แท็บ/ทีม) ส่งให้พนักงาน ──────────────────
/** หา/สร้างแถวพนักงานในกลุ่มทีม (รวมงานหลายไฟลท์ของคนเดียว) */
function apFindMember_(arr, p) {
  for (var i = 0; i < arr.length; i++) if (arr[i].name === p.name && arr[i].pos === p.pos) return arr[i];
  var row = { name: p.name, pos: p.pos, shift: p.shift || '-', jobs: [] };
  arr.push(row); return row;
}
/** ใส่คนที่ทำ common check-in (เคาน์เตอร์/เกท) ลงในกลุ่มทีมของ export */
function apAddCommonsToTeams_(teams, commons, teamFilter) {
  (commons || []).forEach(function (cm) {
    var cfg = apCfgOf_(cm.code); var tn = (cfg && cfg.team) || cm.team || cm.code;
    if (teamFilter && tn !== teamFilter) return;
    var arr = (teams[tn] = teams[tn] || []);
    cm.counters.forEach(function (b) {
      b.slots.forEach(function (s) {
        if (s.chosen) apFindMember_(arr, { name: s.chosen.name, pos: s.chosen.pos, shift: s.chosen.shift }).jobs.push('เช็คอิน ' + s.counter + ' · ' + b.time);
      });
    });
    (cm.gates || []).forEach(function (g) {
      g.roles.forEach(function (rl) {
        rl.picks.forEach(function (pk) {
          if (pk) apFindMember_(arr, { name: pk.name, pos: pk.pos, shift: pk.shift }).jobs.push(g.flight + ' · ' + rl.lb + ' · ' + rl.win);
        });
      });
    });
  });
}
/** เขียน 1 แท็บ/ทีม: ชื่อ · ตำแหน่ง · กะ · งานที่ได้รับ */
function apWriteTeamSheet_(sh, tn, dateStr, members) {
  var rows = [[tn + ' — แจ้ง Assignment วันที่ ' + dateStr, '', '', ''], ['', '', '', '']];
  var hdr = rows.length; rows.push(['ชื่อ', 'ตำแหน่ง', 'กะ', 'งานที่ได้รับ (ไฟลท์ · ตำแหน่ง · เวลา)']);
  members.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); })
    .forEach(function (m) { rows.push([m.name, m.pos, m.shift || '-', (m.jobs || []).join('\n') || '—']); });
  sh.getRange(1, 1, rows.length, 4).setValues(rows).setWrap(true).setVerticalAlignment('top').setFontSize(10);
  sh.getRange(1, 1, 1, 4).merge().setFontWeight('bold').setFontSize(13).setBackground('#1f4e79').setFontColor('#fff').setHorizontalAlignment('left');
  sh.getRange(hdr + 1, 1, 1, 4).setFontWeight('bold').setBackground('#dce9f7').setFontColor('#1f4e79');
  [180, 95, 110, 470].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(hdr + 1);
}
/** สร้างไฟล์ชีตใหม่ 1 แท็บ/ทีม จาก { teamName: [members] } */
function apExportToSheet_(title, teams, dateStr) {
  var names = Object.keys(teams).filter(function (t) { return teams[t].length; }).sort();
  if (!names.length) throw new Error('ไม่มีข้อมูลการจัดคนให้ส่งออก');
  var ss = SpreadsheetApp.create(title);
  var first = true, used = {};
  names.forEach(function (tn) {
    var nm = String(tn).replace(/[\/\\?*\[\]:]/g, '-').slice(0, 26) || 'TEAM';
    var n = nm, k = 2; while (used[n]) n = (nm.slice(0, 22) + ' ' + (k++)); used[n] = 1;
    var sh = first ? ss.getSheets()[0] : ss.insertSheet(); first = false; sh.setName(n);
    apWriteTeamSheet_(sh, tn, dateStr, teams[tn]);
  });
  return ss.getUrl();
}
/** Export "เติม Assign เดิม" (FillPlan) → ไฟล์ชีตรายทีม (team='' = ทุกทีม) */
function apExportFill(dateStr, team) {
  var d = rbLoadResLL_(rbDateFromIso_(dateStr));
  var gaps = apFillGaps_(d.res, d.ll);
  var teams = {};
  gaps.forEach(function (g) {
    (g.picked || []).forEach(function (p) {
      if (team && p.team !== team) return;
      var arr = (teams[p.team] = teams[p.team] || []);
      apFindMember_(arr, p).jobs.push(g.flight + ' · ' + g.phase + ' · ' + g.win + (g.airline ? ' [' + g.airline + ']' : ''));
    });
  });
  apAddCommonsToTeams_(teams, gaps.commons, team);                        // SU/SQ เคาน์เตอร์+เกท
  return apExportToSheet_('แจ้ง Assignment (เติม) ' + dateStr, teams, dateStr);
}
/** Export "Auto Assign" (replan) → ไฟล์ชีตรายทีม (เฉพาะคนที่ถูกจัด ไม่รวม standby; team='' = ทุกทีม) */
function apExportAuto(dateStr, team) {
  var d = rbLoadResLL_(rbDateFromIso_(dateStr));
  var rp = apReplan_(d.res, d.ll);
  var PHL = { SUP: 'SUP', CI: 'Check-in', ARR: 'Arrival', GATE: 'Gate' };
  var teams = {};
  rp.plan.forEach(function (f) {
    AP_PHASES.forEach(function (ph) {
      (f.assign[ph] || []).forEach(function (p) {
        if (team && p.team !== team) return;
        var arr = (teams[p.team] = teams[p.team] || []);
        apFindMember_(arr, p).jobs.push(f.flight + ' · ' + PHL[ph] + ' · ' + (f.std || f.sta || ''));
      });
    });
  });
  apAddCommonsToTeams_(teams, rp.commons, team);                          // SU/SQ เคาน์เตอร์+เกท
  return apExportToSheet_('แจ้ง Assignment (Auto) ' + dateStr, teams, dateStr);
}

/** รวมรายชื่อคนเป็นข้อความสั้น (จัดกลุ่มตามทีม) */
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

/** รายชื่อคน (จัดกลุ่มทีม) แบบมีรายละเอียดงาน/OT/ไฟลท์ — สำหรับเซลล์ในชีต */
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


// ===== AdvancePlan.gs =====

/**
 * AdvancePlan.gs — จัดเวร/Assignment "ล่วงหน้า" จากข้อมูลจริง (ลิงก์ 3 ชีต)
 * =============================================================================
 * แหล่งข้อมูล (ลิงก์สด ผ่าน SpreadsheetApp.openById — ตั้ง ID ได้ใน Script Properties):
 *   · ROSTER  : ปฏิทินกะล่วงหน้า (รหัส | ชื่อ | วันที่→[รหัสกะ, ชนิดวัน])
 *   · FLIGHT  : ตารางบินล่วงหน้า (วันที่ | สายการบิน | เลขไฟลท์ | routing | STA | STD ...)
 *   · EMPLOYEE: รายชื่อพนักงานจริง ชีต "Total" (รหัส | ทีม | ตำแหน่ง | Name | Surname | สถานะ)
 *
 * แนวทาง (ตามที่ตกลง): ใช้กะที่มีอยู่แล้วใน ROSTER เป็นพูลคนว่างของวันนั้น แล้ว
 *   "จัด assignment ตามจำนวนไฟลท์ + SLA" — เป็นข้อเสนอ (ไม่เขียนทับไฟล์จริง),
 *   เลือก/แก้ชื่อคนในแต่ละช่องได้ (เหมาะสมก่อน → หรือเลือกจากพนักงานทั้งหมด).
 *
 * รหัสกะ → เวลา: ตัวอักษรตัวแรก = ชั่วโมงเริ่ม (E=05, F=06, G=07, J=10 ...),
 *   ตัวเลขท้าย = จำนวนชั่วโมง (เช่น G12 = 07:00–19:00, M6 = 13:00–19:00).
 *   รหัสกะดึก/พิเศษ (อักษรซ้ำ NN0/GG2 ฯลฯ) ที่แปลงเวลาไม่ได้ → ไม่นำเข้าพูลจัดงาน.
 *
 * ใช้ greedy ตัวเดียวกับ AutoPlan (apPick_/apEligible_/apScore_).
 * Entry: advPlan_(date) · rbAdvanceHtml(iso) · advTest_() (debug live reads)
 */

var ADV_ROSTER_ID = '1varvj0xmFPbyB7zMYCisTDOwmYGcWAoKHPVkIuC_9I0';
var ADV_FLIGHT_ID = '1Y3ft-vkHQ5Rm2LVmq1Zz_2j8n5T8wLgCJtdBKhqfBAA';
var ADV_EMP_ID    = '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8';
function advCfg_(key, dflt) {
  try { var v = PropertiesService.getScriptProperties().getProperty(key); return v || dflt; } catch (e) { return dflt; }
}

var ADV_MAX_OPT = 40;   // จำกัดตัวเลือกในแต่ละ dropdown

// ── ทีม → สายการบินที่ดูแล (ตารางทางการ 16 ทีม) ─────────────────────────────
var ADV_TEAMS = [
  { name: 'JQ',  airlines: ['AI', 'IX', 'JQ', 'IT'] },
  { name: 'AK',  airlines: ['AK', 'QZ', '8M'] },
  { name: 'SQ',  airlines: ['SQ', 'CX', 'LY'] },
  { name: 'ZF',  airlines: ['ZF', 'LO', 'HH', 'EO', 'N4', 'G2', 'H4', 'S7', 'C6', 'WZ', 'HB'] },
  { name: 'EK',  airlines: ['UO', 'EK', 'FY', '6B', 'BY'] },
  { name: 'QR',  airlines: ['QR', 'MH', 'DE', 'OM'] },
  { name: 'CHN', airlines: ['CA', '3U', 'MU', 'FM', 'HU', 'HO', 'HX', 'AQ', 'CZ', 'ZH', 'PN', '9H', 'OQ', 'BK', 'GX'] },
  { name: 'KE',  airlines: ['KC', 'KE', 'OZ', 'NO', 'AF', 'LJ', 'OV'] },   // ทีมจริงในชีตชื่อ KE (ไม่ใช่ KC)
  { name: 'PVT', airlines: [], sys: ['Gonow', 'ASTRA', 'TWD', 'iPort', 'TravelSky', 'Angel Lite'] },   // PVT = Private/VIP/LP
  { name: 'TR',  airlines: ['TR', '6E', 'QP', '3K'] },
  { name: 'PG',  airlines: ['PG'] },
  { name: 'SU',  airlines: ['SU', 'W5', 'B2'] },
  { name: 'TK',  airlines: ['OD', 'VJ', 'SG', 'HY', 'TK', 'N0', 'VN'] },
  { name: 'EY',  airlines: ['EY', 'DV', 'AY'] },
  { name: 'WY/WK', airlines: ['WY', 'G9', '9C', 'DK', 'SV', 'WK', 'KA'] },   // ทีมจริงรวม WY+WK เป็นทีมเดียว
];
var ADV_AIRLINE_TEAMS = (function () { var m = {}; ADV_TEAMS.forEach(function (t, i) { t.airlines.forEach(function (a) { (m[a] = m[a] || []).push(i); }); }); return m; })();
var ADV_VIP_IDX = (function () { for (var i = 0; i < ADV_TEAMS.length; i++) if (ADV_TEAMS[i].name === 'PVT') return i; return -1; })();
// SU เช็คอินคอมมอน 16 เคาน์เตอร์
var ADV_SU_COUNTERS = ['G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'H2', 'H3', 'H4', 'H5', 'H6'];
/** จับคนเข้าทีมทางการจากสตริง "ทีม" ใน Total (เลือกทีมที่สายการบินทับซ้อนมากสุด) */
function advTeamIdxOf_(teamStr) {
  var t = String(teamStr || '').toUpperCase();
  if (/\bVIP\b|PRIVATE|\bPVT\b|\bLP\b/.test(t)) return ADV_VIP_IDX;     // ทีม PVT = Private/VIP/LP (ใช้ได้หลายระบบ)
  var as = t.split(/[\/,\s]+/).filter(function (a) { return a.length >= 2 && a.length <= 3 && /[A-Z]/.test(a); });
  if (!as.length) return -1;
  var best = -1, bestN = 0;
  ADV_TEAMS.forEach(function (t, i) {
    var n = 0; as.forEach(function (a) { if (t.airlines.indexOf(a) >= 0) n++; });
    if (n > bestN) { bestN = n; best = i; }
  });
  return best;
}

/** รหัสกะ → [นาทีเริ่ม, นาทีเลิก] (อักษรแรก=ชม.เริ่ม, เลข=จำนวน ชม.) */
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

/** แปลงค่าเซลล์วันที่ (Date object / "D/M/YYYY" / "D เดือนไทย YYYY") → {y,m,d} */
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

/** อ่านรายชื่อพนักงานจริง (ชีต Total) → { id: {id,team,pos,name,active} } */
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

/** อ่านปฏิทินกะ ROSTER สำหรับวันที่ tgt → [{id,name,shift,dayType,off}] */
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

/** อ่านตารางบิน FLIGHT สำหรับวันที่ tgt (อ่านทุกแท็บ) → [{flight,airline,STA,STD,OP,CL}] */
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
      var key = flight.replace(/\s+/g, '').toUpperCase();              // เลขไฟลท์ซ้ำ → ตัดออก (เก็บตัวแรก, จับซ้ำแบบไม่สนช่องว่าง/ตัวพิมพ์)
      if (seen[key]) return; seen[key] = 1;
      out.push({ flight: flight, airline: airline, STA: advHHMM_(row[4]), STD: advHHMM_(row[5]), gate: String(row[15] == null ? '' : row[15]).trim(), OP: '', CL: '',
        _nums: (fltno.match(/\d+/g) || []).map(Number) });                // เลขไฟลท์ทุกตัว (สำหรับจับขาซ้ำ)
    });
  });
  // ตัดขาซ้ำ: ถ้า "เลขไฟลท์ทุกตัว" ของไฟลท์หนึ่งเป็นสับเซ็ตของอีกไฟลท์ (สายการบินเดียวกัน) = ไฟลท์เดียวกัน → ไม่จัดซ้ำ
  // เช่น EK396/397 มี {396,397}, EK397 มี {397} ⊂ {396,397} → ตัด EK397 (เก็บตัวที่ครบกว่า)
  var dedup = out.filter(function (f, i) {
    if (!f._nums.length) return true;
    var drop = out.some(function (g, j) {
      if (j === i || g.airline !== f.airline || !g._nums.length) return false;
      var subset = f._nums.every(function (n) { return g._nums.indexOf(n) >= 0; });
      if (!subset) return false;
      if (g._nums.length > f._nums.length) return true;               // g ครบกว่า → f เป็นขาซ้ำ → ตัด f
      return j < i;                                                   // เลขชุดเดียวกันเป๊ะ → เก็บตัวแรก
    });
    return !drop;
  });
  dedup.forEach(function (f) { delete f._nums; });
  return dedup;
}

var ADV_EN_MON = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
/** ดึงเลขวันจากป้ายหัวคอลัมน์ (เช่น "1/MON/TIME" หรือ "SAT/30/TIME") */
function advHdrDay_(s) { var m = String(s || '').match(/\d{1,2}/); return m ? +m[0] : null; }
/** ดึงรหัสสายการบินจากชื่อบล็อก (เช่น "JUNE 2026 /EK UO FY 6B BY") */
function advBlockAirlines_(s) {
  s = String(s || '');
  var m = s.match(/\d{4}\s*\/?\s*(.+)$/);                      // เอาส่วนหลังปี
  var tail = (m ? m[1] : s).replace(/\/(NO|POS|ID|NAME)\s*$/i, '');
  return (tail.match(/[A-Z0-9]{2,3}/g) || []).filter(function (c) { return !/^\d+$/.test(c); });
}

/** อ่าน ROSTER แบบ "บล็อกหน้างาน" (No|Pos|ID|Name|Sur| ต่อวัน [TIME|CODE|HR|OT|OTHR|REMARK])
 *  คืนพนักงานหน้างานที่ขึ้นเวรวันที่ tgt → [{id,name,pos,team,airlines,range,off}] */
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
/** สแกน rows (1 ชีต) หาบล็อกหน้างาน + คนที่ขึ้นเวรวัน tgt — แยกไว้เพื่อทดสอบ offline ได้ */
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

/** วันที่ทั้งหมดที่มีในตารางบิน (ISO เรียง, อ่านทุกแท็บ) */
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
/** วันที่มีไฟลท์ที่ "ใกล้ที่สุด" กับ iso ที่ขอ (เสมอกันเลือกวันถัดไป) */
function advNearestFlightDate_(iso, dates) {
  dates = dates || advFlightDates_();
  if (!dates.length) return null;
  if (dates.indexOf(iso) >= 0) return iso;
  var t = new Date(iso).getTime();
  return dates.slice().sort(function (a, b) {
    return Math.abs(new Date(a).getTime() - t) - Math.abs(new Date(b).getTime() - t) || (a < b ? 1 : -1);
  })[0];
}

/** บันทึกข้อเสนอ (รวมชื่อที่แก้ในหน้าจอ) ลง "ชีตใหม่" — ไม่เขียนทับไฟล์ต้นฉบับ. คืน URL */
function advSaveProposal(dateStr, rowsJson) {
  var rows = JSON.parse(rowsJson || '[]');
  var ss = SpreadsheetApp.create('Advance Plan ' + dateStr);
  var sh = ss.getSheets()[0];
  sh.setName(('Plan ' + dateStr).slice(0, 30));
  var head = ['Flight', 'สายการบิน', 'STA', 'STD', 'เปิด-ปิดเคาน์เตอร์', 'SUP', 'FC', 'Check-in', 'Arrival', 'Standby', 'Gate Monitor', 'Gate Agent'];
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff').setHorizontalAlignment('center');
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows).setWrap(true).setVerticalAlignment('top').setFontSize(9);
  sh.setFrozenRows(1);
  [90, 70, 50, 50, 120, 130, 130, 200, 150, 90, 150, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return ss.getUrl();
}

/** แจ้ง Assignment: สร้าง Google Sheet ใหม่ ผังเต็มต่อทีม (ASSIGNMENT คนในทีม + SUPPORT คนข้ามทีมที่มาช่วย) — เรียกจากปุ่ม UI */
function advExportAssignment(dateStr) {
  var d = dateStr ? rbDateFromIso_(dateStr) : new Date();
  var tgt = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };  // advPlan_ ต้องการ {y,m,d} ไม่ใช่ Date
  var R = advPlan_(tgt);
  var teams = advPivotTeams_(R);
  var names = Object.keys(teams).filter(function (t) { return teams[t].members.length; }).sort();
  if (!names.length) throw new Error('วันที่ ' + dateStr + ' ยังไม่มีการจัดคน');
  var ss = SpreadsheetApp.create('แจ้ง Assignment ' + dateStr);
  var first = true, used = {};
  names.forEach(function (tn) {
    var nm = tn.replace(/[\/\\?*\[\]:]/g, '-').slice(0, 26) || 'TEAM';
    var n = nm; var k = 2; while (used[n]) n = (nm.slice(0, 22) + ' ' + (k++)); used[n] = 1;
    var sh = first ? ss.getSheets()[0] : ss.insertSheet(); first = false;
    sh.setName(n);
    advWriteTeamSheet_(sh, tn, dateStr, teams[tn]);
  });
  return ss.getUrl();
}

/** รวมแผน → ต่อทีม: {teamName: {members:[{name,pos,shift,jobs[]}], support:[{name,pos,team,job}]}} */
function advPivotTeams_(R) {
  var flTeam = {};
  (R.plan || []).forEach(function (p) { if (p.team) flTeam[p.flight] = p.team; });
  (R.commons || []).forEach(function (cm) {                            // ไฟลท์ของทีม common (SU เกท) → ผูกกับทีมนั้น
    (cm.gates || []).forEach(function (g) { flTeam[g.flight] = cm.code === 'SU' ? 'SU' : cm.code; });
  });
  var teams = {};
  var ens = function (tn) { return teams[tn] || (teams[tn] = { members: [], support: [] }); };
  (R.pool || []).forEach(function (p) {
    if (!p.team || !p.plan) return;                                    // เฉพาะคนที่ถูกจัดงาน
    var jobs = (p.flts || []).slice(), pos = slaPosShort_(p.posGroup);
    ens(p.team).members.push({ name: p.name, pos: pos, shift: p.shiftDisp, jobs: jobs });
    jobs.forEach(function (j) {                                        // งานบนไฟลท์ของทีมอื่น = ไปช่วย (support ของทีมเจ้าของไฟลท์)
      var owner = flTeam[String(j).split(' ')[0]];
      if (owner && owner !== p.team) ens(owner).support.push({ name: p.name, pos: pos, team: p.team, job: j });
    });
  });
  return teams;
}

/** เขียนชีตผังต่อทีม (ASSIGNMENT + SUPPORT) */
function advWriteTeamSheet_(sh, tn, dateStr, data) {
  var rows = [[tn + ' — แจ้ง Assignment วันที่ ' + dateStr, '', '', ''], ['', '', '', '']];
  var secRows = [], hdrRows = [];
  secRows.push(rows.length); rows.push(['📋 ASSIGNMENT (พนักงานในทีม)', '', '', '']);
  hdrRows.push(rows.length); rows.push(['ชื่อ', 'ตำแหน่ง', 'กะ', 'งานที่ได้รับ (ไฟลท์ · บทบาท)']);
  data.members.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
    .forEach(function (m) { rows.push([m.name, m.pos, m.shift, m.jobs.join('   |   ') || '— standby —']); });
  rows.push(['', '', '', '']);
  secRows.push(rows.length); rows.push(['🤝 SUPPORT — พนักงานข้ามทีมที่มาช่วยทีมนี้', '', '', '']);
  hdrRows.push(rows.length); rows.push(['ชื่อ', 'ตำแหน่ง', 'ทีมเดิม', 'งานที่ช่วย']);
  if (data.support.length) data.support.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
    .forEach(function (s) { rows.push([s.name, s.pos, s.team, s.job]); });
  else rows.push(['— ไม่มีพนักงานข้ามทีม —', '', '', '']);

  sh.getRange(1, 1, rows.length, 4).setValues(rows).setWrap(true).setVerticalAlignment('top').setFontSize(10);
  sh.getRange(1, 1, 1, 4).merge().setFontWeight('bold').setFontSize(13).setBackground('#1f4e79').setFontColor('#fff').setHorizontalAlignment('left');
  secRows.forEach(function (r) { sh.getRange(r + 1, 1, 1, 4).merge().setFontWeight('bold').setBackground('#dce9f7').setFontColor('#1f4e79'); });
  hdrRows.forEach(function (r) { sh.getRange(r + 1, 1, 1, 4).setFontWeight('bold').setBackground('#f0f4f9'); });
  [180, 90, 120, 430].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
}

/** ระบบเช็คอินที่พนักงานทำได้ = ระบบของสายการบินในทีมตัวเอง (เช่น "JQ/IT/IX/AI") */
function advSysForTeam_(teamStr) {
  var sys = {};
  String(teamStr || '').split(/[\/,\s]+/).forEach(function (code) {
    if (!code) return;
    var s = slaSystemOf_(code.toUpperCase());
    if (s) sys[slaSysNorm_(s)] = true;
  });
  return sys;
}

/** สร้างพูลคนว่างของวันนั้น (พนักงานหน้างานจาก ROSTER + ทีม/ระบบจากทะเบียน Total)
 *  ทีม = จับเข้า "ทีมทางการ 16 ทีม" จากสตริงทีมใน Total → ได้สายการบิน+ระบบครบ
 *  คืน { pool, airlineTeams } */
function advBuildPool_(tgt) {
  var emp = advReadEmployees_();
  var ros = advReadRosterFrontline_(tgt);
  var pool = [], seen = {};
  ros.forEach(function (p) {
    if (p.off || seen[p.id]) return;
    var rr = rrRangeStr_(p.range);
    if (rr[0] == null || rr[1] == null) return;                        // ไม่มีช่วงเวลา → ไม่จัด
    var ds = rr[0], de = rr[1]; if (de <= ds) de += 1440;
    var e = emp[p.id] || {};
    if (e.active === false) return;                                    // ลาออก/พ้นสภาพ → ข้าม
    seen[p.id] = 1;
    var ti = advTeamIdxOf_(String(e.team || p.team || ''));            // จับเข้าทีมทางการ
    var teamName = ti >= 0 ? ADV_TEAMS[ti].name : (String(e.team || p.team || '').toUpperCase() || '-');
    var airlines = ti >= 0 ? ADV_TEAMS[ti].airlines : [];
    var sys = {};
    airlines.forEach(function (a) { var s = slaSystemOf_(a); if (s) sys[slaSysNorm_(s)] = true; });
    if (ti >= 0 && ADV_TEAMS[ti].sys) ADV_TEAMS[ti].sys.forEach(function (s) { sys[slaSysNorm_(s)] = true; });  // ทีมที่กำหนดระบบเอง (VIP)
    pool.push({
      id: p.id, name: e.name || p.name, team: teamName, teamIdx: ti, pos: p.pos || e.pos || '',
      posGroup: rrPosGroup_(p.pos || e.pos || '', ''),
      ds: ds, de: de, busy: [], plan: 0, nflt: 0, sys: sys, airlines: airlines,
      shiftDisp: rrFmtMin_(rr[0]) + '-' + rrFmtMin_(((de) % 1440 + 1440) % 1440),
      otDisp: '-', hrs: Math.round((de - ds) / 6) / 10, flts: [],
    });
  });
  return { pool: pool, airlineTeams: ADV_AIRLINE_TEAMS };
}

// บทบาทเต็ม 7 อย่าง (ตามตาราง SLA) — win=phase สำหรับช่วงเวลา, sys=ต้องรู้ระบบ, pos=เงื่อนไขตำแหน่ง
var ADV_ROLES = [
  { k: 'SUP', lb: 'SUP',          win: 'CI',   sys: true,  pos: 'PSS', sc: 'SUP' },
  { k: 'FC',  lb: 'FC',           win: 'CI',   sys: true,  pos: 'SNR', sc: 'SUP' },   // Flight Controller = Sup/Snr
  { k: 'CI',  lb: 'Check-in',     win: 'CI',   sys: true,  pos: '',    sc: 'CI' },
  { k: 'ARR', lb: 'Arrival',      win: 'ARR',  sys: false, pos: '',    sc: 'ARR' },
  { k: 'STB', lb: 'Standby',      win: '',     sys: false, pos: '',    sc: 'ARR' },
  { k: 'GM',  lb: 'Gate Monitor', win: 'GATE', sys: false, pos: '',    sc: 'GATE' },
  { k: 'GA',  lb: 'Gate Agent',   win: 'GATE', sys: false, pos: '',    sc: 'GATE', fromCI: true },
];
var ADV_ROLE_KEYS = ADV_ROLES.map(function (r) { return r.k; });

function advPosOK_(p, posRule) {
  if (posRule === 'PSS') return p.posGroup === 'PSS';
  if (posRule === 'SNR') return p.posGroup === 'PSS' || p.posGroup === 'SNR';
  return true;
}

/** เลือกคน 1 คนสำหรับ 1 สลอตของบทบาท role — ทีมเจ้าของไฟลท์ก่อน แล้วข้ามทีม */
function advPickSlot_(pool, f, role, win, used) {
  var nn = role.sys ? (function () { var s = slaNeedSys_(f.airline, 'CI'); return s ? slaSysNorm_(s) : ''; })() : '';
  var best = null, bs = 1e9;
  for (var i = 0; i < pool.length; i++) {
    var p = pool[i];
    if (used && used[p.id]) continue;                                  // ห้ามคนเดิมซ้ำในไฟลท์เดียวกัน
    if (nn && !p.sys[nn]) continue;                                    // SUP/FC/Check-in ต้องรู้ระบบ
    if (!advPosOK_(p, role.pos)) continue;
    if (!apFree_(p, win)) continue;
    var sc = apScore_(p, role.sc, null) + (f.homeTeam[p.teamIdx] ? 0 : 1e6); // ดึงคนในทีมเจ้าของไฟลท์ให้หมดก่อน แล้วค่อยข้ามทีม
    if (sc < bs) { bs = sc; best = p; }
  }
  if (best) {
    if (win) best.busy.push([win[0], win[1]]);
    best.plan++; best.nflt = best.plan;
    (best.flts = best.flts || []).push(f.flight + ' ' + role.lb);
    if (used) used[best.id] = 1;
  }
  return best;
}

/** ผู้สมัครสำรองของสลอต (สำหรับ dropdown) ตามบทบาท */
function advSlotCandidates_(pool, f, role, win) {
  var nn = role.sys ? (function () { var s = slaNeedSys_(f.airline, 'CI'); return s ? slaSysNorm_(s) : ''; })() : '', seen = {};
  return pool.filter(function (p) {
    if (seen[p.id]) return false; seen[p.id] = 1;                       // กันรายชื่อซ้ำใน dropdown
    if (nn && !p.sys[nn]) return false;
    if (!advPosOK_(p, role.pos)) return false;
    if (win && !(p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL)) return false;
    return true;
  }).sort(function (a, b) {
    return (f.homeTeam[a.teamIdx] ? 0 : 1) - (f.homeTeam[b.teamIdx] ? 0 : 1) || a.plan - b.plan || String(a.name).localeCompare(b.name);
  });
}

/** ทีมที่ทำ "common check-in" (รวมไฟลท์ที่เวลาใกล้กัน นั่งเคาน์เตอร์รวม)
 *  full=true: จัดเต็ม (ล็อกเวลา+ถอดจากตารางหลัก+มีการ์ดเกท) · full=false: เฉพาะเคาน์เตอร์ (ไม่แตะตารางหลัก) */
var ADV_SU_MAXSIT = 180;                                              // นั่งต่อเนื่องสูงสุด 3 ชม./คน
var ADV_COMMON_CI = [
  { code: 'SU', team: 'SU', counters: ADV_SU_COUNTERS, gate: true,  full: true },   // SU: 16 เคาน์เตอร์ + เกท + ถอดจากตารางหลัก
  { code: 'SQ', team: 'SQ', nCounter: 7,               gate: false, full: false }    // SQ: ~7 เคาน์เตอร์ เฉพาะเคาน์เตอร์ (เกทอยู่ตารางหลัก)
];

/** common check-in ของทีมหนึ่ง: (1) เคาน์เตอร์รวม หมุนเวียนรอบละ ≤3 ชม. (2) เกทต่อไฟลท์ (เฉพาะ cfg.gate)
 *  cfg.full=true → ล็อกเวลาคน (busy) กันชนตารางหลัก · คืน {code, counters, gates} หรือ null ถ้าทีมนี้ไม่มีไฟลท์ */
function advCommonCIPlan_(pool, flights, cfg) {
  var teamIdx = advTeamIdxOf_(cfg.team);
  var ctList = cfg.counters || (function () { var a = []; for (var i = 1; i <= cfg.nCounter; i++) a.push('CT' + i); return a; })();
  var teamFl = flights.filter(function (f) { return f.homeTeam && f.homeTeam[teamIdx] && acIsFlight_(f.flight); });
  if (!teamFl.length) return null;
  teamFl.forEach(function (f) { f.ciwin = slaPhaseWindow_(f, 'CI'); });
  var su = pool.filter(function (p) { return p.teamIdx === teamIdx; }), pr = { PSA: 0, SNR: 1, PSS: 2 };
  var view = function (p) { return { name: p.name, pos: slaPosShort_(p.posGroup), shift: p.shiftDisp }; };
  var fmt = function (m) { return rrFmtMin_(((m % 1440) + 1440) % 1440); };

  // ---------- 1) เช็คอินคอมมอน (หมุนเวียนรอบละ ≤3 ชม.) ----------
  var ciFl = teamFl.filter(function (f) { return f.ciwin; }).sort(function (a, b) { return a.ciwin[0] - b.ciwin[0]; });
  var batches = [];
  ciFl.forEach(function (f) {                                          // รวมไฟลท์ที่ช่วงเช็คอินซ้อน/ใกล้กัน (≤20 น.) = แบทช์เดียว
    var b = batches[batches.length - 1];
    if (b && f.ciwin[0] <= b.end + 20) { b.end = Math.max(b.end, f.ciwin[1]); b.flights.push(f.flight); }
    else batches.push({ start: f.ciwin[0], end: f.ciwin[1], flights: [f.flight] });
  });
  // Flight Controller = หัวหน้า 1 คน (PSS ก่อน) คุมเช็คอินตลอดช่วง — ไม่นั่งเคาน์เตอร์ ไม่ลงเกท (เฉพาะ full)
  var fc = null;
  if (cfg.full && batches.length) {
    var ciStart = Math.min.apply(null, batches.map(function (b) { return b.start; }));
    var ciEnd = Math.max.apply(null, batches.map(function (b) { return b.end; }));
    fc = su.filter(function (p) { return p.ds <= ciStart + AP_TOL && p.de >= ciEnd - AP_TOL; })
      .sort(function (a, c) { return (pr[c.posGroup] == null ? -1 : pr[c.posGroup]) - (pr[a.posGroup] == null ? -1 : pr[a.posGroup]) || a.plan - c.plan; })[0] || null;
    if (fc) { fc.isFC = true; fc.busy.push([ciStart, ciEnd]); fc.plan++; (fc.flts = fc.flts || []).push('Flight Controller เช็คอิน (' + fmt(ciStart) + '-' + fmt(ciEnd) + ')'); }
  }

  var counters = [];
  batches.forEach(function (b) {
    var avail = su.filter(function (p) { return !p.isFC && p.ds <= b.start + AP_TOL && p.de >= b.end - AP_TOL; })  // กะคลุมช่วงแบทช์ (ไม่รวม FC)
      .sort(function (a, c) { return (pr[a.posGroup] == null ? 3 : pr[a.posGroup]) - (pr[c.posGroup] == null ? 3 : pr[c.posGroup]) || a.plan - c.plan; });
    var dur = b.end - b.start, nR = Math.max(1, Math.ceil(dur / ADV_SU_MAXSIT)), rl = dur / nR;
    var perR = Math.min(ctList.length, Math.ceil(avail.length / nR));                  // คนต่อรอบ (ต่างคน → ไม่มีใครนั่งซ้อนรอบ)
    var cands = avail.map(view);
    for (var r = 0; r < nR; r++) {
      var rs = b.start + Math.round(r * rl), re = (r === nR - 1) ? b.end : b.start + Math.round((r + 1) * rl);
      var people = avail.slice(r * perR, (r + 1) * perR);
      if (cfg.full) people.forEach(function (p) { p.busy.push([rs, re]); p.plan++; (p.suCI = p.suCI || []).push([rs, re]); });  // ล็อกเวลา (เฉพาะ full)
      var slots = ctList.map(function (ct, i) {
        if (cfg.full && people[i]) (people[i].flts = people[i].flts || []).push('CI ' + ct + ' (' + fmt(rs) + '-' + fmt(re) + ')');
        return { counter: ct, chosen: people[i] ? view(people[i]) : null, cands: cands };
      });
      counters.push({ time: fmt(rs) + '-' + fmt(re), flights: b.flights.join(', '), round: nR > 1 ? (r + 1) + '/' + nR : 0, nAvail: avail.length, slots: slots });
    }
  });

  // ---------- 2) เกทต่อไฟลท์ (เฉพาะ cfg.gate · คนเดิมต่อเนื่องจากเช็คอิน · FC ไม่ลงเกท) ----------
  var gates = null;
  if (cfg.gate) {
    var sla = (typeof slaGet_ === 'function') ? slaGet_(cfg.code) : null;
    var gdefs = ((sla && sla.roles) || []).filter(function (rr) { return rr[3] === 'GATE' || rr[3] === 'ARR'; })
      .map(function (rr) { var lb = /MONITOR|GM/.test(String(rr[0]) + rr[2]) ? 'GC' : (rr[3] === 'ARR' ? 'ARR' : 'GA'); return { lb: lb, n: rr[1], phase: rr[3], snr: lb === 'GC' }; })
      .sort(function (a, b) { return (b.snr ? 1 : 0) - (a.snr ? 1 : 0); });       // จัด GC (Flight Controller) ก่อน แล้วค่อย GA
    gates = teamFl.slice().sort(function (a, b) { return String(a.STD || '').localeCompare(String(b.STD || '')); }).map(function (f) {
      var usedF = {};
      var roles = gdefs.map(function (rd) {
        var win = slaPhaseWindow_(f, rd.phase) || [0, 0], picks = [];
        var ord = rd.snr ? { PSS: 0, SNR: 1, PSA: 2 } : { PSA: 0, SNR: 1, PSS: 2 };
        for (var i = 0; i < rd.n; i++) {
          var cand = su.filter(function (p) { if (p.isFC) return false; if (rd.lb === 'GA' && !p.suCI) return false; return !usedF[p.id] && apFree_(p, win) && p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL; })
            .sort(function (a, c) {
              return ((c.suCI ? 1 : 0) - (a.suCI ? 1 : 0))              // คนที่เช็คอินแล้วมาก่อน = ต่อเนื่อง
                || (ord[a.posGroup] == null ? 3 : ord[a.posGroup]) - (ord[c.posGroup] == null ? 3 : ord[c.posGroup]) || a.plan - c.plan;
            })[0];
          if (cand) { cand.busy.push([win[0], win[1]]); cand.plan++; usedF[cand.id] = 1; (cand.flts = cand.flts || []).push(f.flight + ' ' + rd.lb); picks.push(view(cand)); }
          else picks.push(null);
        }
        return { lb: rd.lb, need: rd.n, win: fmt(win[0]) + '-' + fmt(win[1]), picks: picks,
          cands: su.filter(function (p) { return p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL; }).map(view) };
      });
      return { flight: f.flight, std: f.STD || '', roles: roles };
    });
  }

  return { code: cfg.code, fc: fc ? view(fc) : null, counters: counters, gates: gates };
}

/** จัด assignment ล่วงหน้า — แยกตามบทบาทเต็ม SLA (SUP/FC/Check-in/Arrival/Standby/Gate Monitor/Gate Agent) */
function advPlan_(tgt) {
  var built = advBuildPool_(tgt);
  var pool = built.pool, airlineTeams = built.airlineTeams;            // สายการบิน → ทีมที่ดูแล (รวมคนหยุด)
  var flights = advReadFlights_(tgt).filter(function (f) { return acIsFlight_(f.flight); });
  flights.forEach(function (f) {
    f.airline = slaAirlineOf_(f.flight);
    f.system = slaSystemOf_(f.airline);
    f.homeTeam = {}; (ADV_AIRLINE_TEAMS[f.airline] || []).forEach(function (i) { f.homeTeam[i] = true; });
    f.teamName = (ADV_AIRLINE_TEAMS[f.airline] || []).map(function (i) { return ADV_TEAMS[i].name; }).join(' / ');
    f.roles = slaRoles_(f.airline);
    f.counter = slaCounterTime_(f);
  });
  flights.sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });

  var commons = [], removeIdx = {};                                    // ทีม common check-in
  ADV_COMMON_CI.forEach(function (cfg) {
    var r = advCommonCIPlan_(pool, flights, cfg);
    if (r) commons.push(r);
    if (cfg.full) removeIdx[advTeamIdxOf_(cfg.team)] = 1;              // ทีม full → ถอดออกจากตารางหลัก
  });
  var mainFlights = flights.filter(function (f) {                      // ถอดไฟลท์ของทีม full (เช่น SU) ออกจากตารางหลัก
    return !Object.keys(removeIdx).some(function (i) { return f.homeTeam && f.homeTeam[i]; });
  });

  var plan = [];
  mainFlights.forEach(function (f) {
    var assign = {}, shortx = {}, win = {}, used = {}, req = {};
    ADV_ROLES.forEach(function (role) {
      var need = f.roles[role.k] || 0;
      req[role.k] = need; assign[role.k] = [];
      if (!need) return;
      win[role.k] = role.win ? slaPhaseWindow_(f, role.win) : null;
      if (role.fromCI && !f.roles.sep) {                                // Gate Agent = คนเช็คอินย้ายไปเกท (ใช้คนเดิม)
        assign[role.k] = (assign.CI || []).slice(0, need);
        if (assign[role.k].length < need) shortx[role.k] = need - assign[role.k].length;
        return;
      }
      for (var k = 0; k < need; k++) {
        var p = advPickSlot_(pool, f, role, win[role.k], used);
        if (p) assign[role.k].push(p);
        else { shortx[role.k] = need - k; break; }
      }
    });
    plan.push({ flight: f.flight, airline: f.airline, system: f.system || '', team: f.teamName,
      homeTeam: f.homeTeam, sta: f.STA || '', std: f.STD || '', gate: f.gate || '', counter: f.counter, req: req,
      assign: assign, shortx: shortx, win: win, _f: f });
  });

  // nflt สรุปครบแล้ว → แปลง ref เป็นวิว + สร้างรายชื่อสำรองของแต่ละสลอต
  plan.forEach(function (row) {
    ADV_ROLES.forEach(function (role) {
      if (!row.req[role.k]) return;
      row.assign[role.k] = row.assign[role.k].map(apPersonView_);
      row['cand' + role.k] = advSlotCandidates_(pool, row._f, role, row.win[role.k]);
    });
    delete row._f; delete row.win;
  });

  var bench = pool.filter(function (p) { return p.plan === 0; })
    .map(function (p) { return { id: p.id, name: p.name, pos: slaPosShort_(p.posGroup), team: p.team, shift: p.shiftDisp }; });
  return { plan: plan, bench: bench, pool: pool, commons: commons,
    nPeople: pool.length, nAssigned: pool.filter(function (p) { return p.plan > 0; }).length, nFlights: plan.length };
}

/** รายชื่อพนักงาน Active ทั้งหมด (เรียง) — สำหรับ datalist เลือกข้ามได้ทุกคน */
function advActiveNames_() {
  var emp = advReadEmployees_(), names = {};
  Object.keys(emp).forEach(function (id) { var e = emp[id]; if (e.active !== false && e.name) names[e.name] = 1; });
  return Object.keys(names).sort();
}

/** ข้อความตัวเลือก: รองรับทั้ง view (pos/shift/n) และ pool (posGroup/shiftDisp/nflt) */
function advOptText_(c) {
  var pos = c.posGroup ? slaPosShort_(c.posGroup) : (c.pos || '');
  var shift = c.shiftDisp || c.shift || '';
  var n = (c.nflt != null ? c.nflt : (c.n != null ? c.n : 0));
  return c.name + ' · ' + pos + ' · ' + (c.team || '-') + ' · ' + shift + ' · ' + n + ' ไฟลท์';
}
/** dropdown เลือกชื่อ: คนที่จัดให้ = ตัวเลือกแรก (selected) เสมอ แล้วตามด้วยทีมเจ้าของไฟลท์ → ข้ามทีม
 *  (สำคัญ: ต้องโชว์คนที่จัดให้เสมอ แม้จะไม่อยู่ใน 30 ตัวแรกของรายชื่อข้ามทีม) */
function advBuildSelect_(chosen, cands, home) {
  var inT = [], ot = [];
  (cands || []).forEach(function (c) {
    if (c.name === chosen.name) return;                                // ตัวที่จัดอยู่แล้ว แสดงแยกเป็นตัวแรก
    (home[c.teamIdx] ? inT : ot).push(c);
  });
  function opt(c) { return '<option value="' + rbAttr_(c.name) + '">' + rbEsc_(advOptText_(c)) + '</option>'; }
  var h = '<select class="namepick" oninput="this.classList.add(\'edited\')">' +
    '<option value="' + rbAttr_(chosen.name) + '" selected>' + rbEsc_(advOptText_(chosen)) + '</option>';
  if (inT.length) h += '<optgroup label="● ทีมเจ้าของไฟลท์ (' + inT.length + ')">' + inT.map(opt).join('') + '</optgroup>';
  if (ot.length) h += '<optgroup label="○ ข้ามทีม · ระบบตรง (' + ot.length + ')">' + ot.slice(0, 30).map(opt).join('') + '</optgroup>';
  return h + '</select>';
}

/** Lazy tab: 📅 จัดเวรล่วงหน้า — อ่าน ROSTER+FLIGHT+Total สด แล้วจัด assignment ตามไฟลท์ */
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
      ' <button class="btn" onclick="advExport()" style="margin-left:6px">📤 สร้างไฟล์แจ้งทีม</button>' +
      ' <span id="advsavemsg" class="okk" style="margin-left:6px"></span><span id="advexportmsg" class="okk" style="margin-left:6px"></span>' +
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
      if (!req) return '<span class="muted">—</span>';
      var picks = (arr || []).map(function (v) { return advBuildSelect_(v, cands, home); }).join('');
      return '<div><b>' + (arr ? arr.length : 0) + '/' + req + '</b> ' + (shortN ? '<span class="badd">⚠️-' + shortN + '</span>' : '<span class="okk">✓</span>') +
        '</div>' + (arr && arr.length ? '<div class="pickwrap">' + picks + '</div>' : '');
    }
    var body = plan.plan.map(function (p) {
      var ok = Object.keys(p.shortx).length === 0, hm = p.homeTeam || {};
      var roleCells = ADV_ROLES.map(function (role) {
        return '<td>' + cell(p.assign[role.k], p.req[role.k], p.shortx[role.k], p['cand' + role.k], hm) + '</td>';
      }).join('');
      return '<tr class="' + (ok ? '' : 'rowbad') + '" data-team="' + rbEsc_(p.airline) + '"><td class="b">' + rbEsc_(p.flight) +
        '</td><td>' + rbEsc_(p.airline) + (p.team ? '<div class="muted" style="font-size:10px">ทีม ' + rbEsc_(p.team) + '</div>' : '<div class="badd" style="font-size:10px">ไม่มีทีม</div>') +
        '</td><td>' + rbEsc_(p.system || 'iPort') + '</td><td class="tnum">' + rbEsc_(p.sta) + '</td><td class="tnum">' + rbEsc_(p.std) +
        (p.gate ? '<div class="muted" style="font-size:9px">Bay ' + rbEsc_(p.gate) + '</div>' : '') +
        '</td><td class="tnum" style="white-space:nowrap">' + rbEsc_(p.counter || '-') + '</td>' + roleCells + '</tr>';
    }).join('');
    var roleTh = ADV_ROLES.map(function (role) { return '<th>' + role.lb + '</th>'; }).join('');
    var tbl = rbTblCard_('📅 จัด Assignment ล่วงหน้าตาม SLA (จัดคนในทีมก่อน) — ' + dstr,
      '<tr><th>Flight</th><th>สายการบิน / ทีม</th><th>ระบบ</th><th>STA</th><th>STD</th><th>เปิด-ปิด<br>เคาน์เตอร์</th>' + roleTh + '</tr>',
      body, rbCtrls_('view-adv', true));

    var benchHtml = '';
    if (plan.bench.length) {
      benchHtml = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>😴 คนขึ้นเวรที่ยังไม่ถูกจัด — ' + plan.bench.length + ' คน</h3></div>' +
        '<div style="padding:10px 14px">' + plan.bench.map(function (b) {
          return '<span class="chip">' + rbEsc_(b.name) + ' <span class="muted">' + rbEsc_(b.pos) + ' · ' + rbEsc_(b.shift) + '</span></span>';
        }).join('') + '</div></div>';
    }
    var commonHtml = '';
    (plan.commons || []).forEach(function (cm) {
      if (cm.counters && cm.counters.length) {
        var nCt = cm.counters[0] ? cm.counters[0].slots.length : 0;
        commonHtml += '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>🛄 ' + rbEsc_(cm.code) + ' — เช็คอินคอมมอน ' + nCt + ' เคาน์เตอร์ (หมุนเวียน ≤3 ชม./คน)</h3></div>';
        cm.counters.forEach(function (b) {
          var filled = b.slots.filter(function (s) { return s.chosen; });
          commonHtml += '<div class="sectionlabel" style="margin:8px 14px 2px">⏱️ ช่วง <b>' + rbEsc_(b.time) + '</b>' +
            (b.round ? ' · รอบ <b>' + rbEsc_(b.round) + '</b>' : '') + ' · ไฟลท์ ' + rbEsc_(b.flights) +
            ' · คนว่าง <b>' + b.nAvail + '</b> · ใช้เคาน์เตอร์ ' + filled.length + '/' + nCt + '</div>' +
            '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>เคาน์เตอร์</th><th>พนักงาน (เลือกได้)</th><th>ตำแหน่ง</th><th>กะ</th></tr></thead><tbody>';
          b.slots.forEach(function (s) {
            if (!s.chosen) return;
            var sel = '<select class="namepick">' + s.cands.map(function (c) {
              return '<option' + (c.name === s.chosen.name ? ' selected' : '') + '>' + rbEsc_(c.name + ' · ' + c.pos + ' · ' + c.shift) + '</option>';
            }).join('') + '</select>';
            commonHtml += '<tr><td class="b">' + rbEsc_(s.counter) + '</td><td>' + sel + '</td><td>' + rbEsc_(s.chosen.pos) + '</td><td class="tnum">' + rbEsc_(s.chosen.shift) + '</td></tr>';
          });
          commonHtml += '</tbody></table></div>';
        });
        commonHtml += '</div>';
      }
      if (cm.gates && cm.gates.length) {
        commonHtml += '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>🚪 ' + rbEsc_(cm.code) + ' — Gate ต่อไฟลท์ (คนต่อเนื่องจากเช็คอิน)</h3></div>';
        cm.gates.forEach(function (g) {
          commonHtml += '<div class="sectionlabel" style="margin:8px 14px 2px">✈️ <b>' + rbEsc_(g.flight) + '</b> · STD ' + rbEsc_(g.std) + '</div>' +
            '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>หน้าที่</th><th>ช่วงเวลา</th><th>พนักงาน (เลือกได้)</th></tr></thead><tbody>';
          g.roles.forEach(function (rl) {
            rl.picks.forEach(function (pk, idx) {
              var opts = rl.cands.map(function (c) {
                return '<option' + (pk && c.name === pk.name ? ' selected' : '') + '>' + rbEsc_(c.name + ' · ' + c.pos + ' · ' + c.shift) + '</option>';
              }).join('');
              var who = pk ? '<select class="namepick">' + opts + '</select>'
                : (rl.cands.length ? '<span class="badd">⚠️ </span><select class="namepick"><option>— เลือกคนเอง —</option>' + opts + '</select>' : '<span class="badd">⚠️ ไม่มีคนว่าง</span>');
              commonHtml += '<tr><td class="b">' + rbEsc_(rl.lb) + (rl.need > 1 ? ' ' + (idx + 1) : '') + '</td><td class="tnum">' + rbEsc_(rl.win) + '</td><td>' + who + '</td></tr>';
            });
          });
          commonHtml += '</tbody></table></div>';
        });
        commonHtml += '</div>';
      }
    });
    return datebar + hd + tbl + commonHtml + benchHtml;
  } catch (e) { return '<div class="panel">โหลด "จัดเวรล่วงหน้า" ไม่ได้: ' + rbEsc_(e.message) + ' <div class="muted">— ตรวจสิทธิ์เข้าถึง 3 ชีต (ROSTER/FLIGHT/Total) และรหัสชีตใน Script Properties</div></div>'; }
}

/** ทดสอบการอ่านลิงก์สด (รันใน Apps Script editor เพื่อตรวจสิทธิ์/โครงสร้าง) — ไม่มี _ ท้าย จะได้ขึ้นใน Run */
function advTest() {
  var d = new Date(); d.setMonth(d.getMonth()); var tgt = { y: 2026, m: 6, d: 1 };
  var emp = advReadEmployees_(), ros = advReadRosterFrontline_(tgt), flt = advReadFlights_(tgt), built = advBuildPool_(tgt), plan = advPlan_(tgt);
  Logger.log('employees=%s frontlineRows=%s working=%s flights=%s pool=%s teams=%s | plan: flights=%s assigned=%s bench=%s',
    Object.keys(emp).length, ros.length, ros.filter(function (r) { return !r.off; }).length, flt.length, built.pool.length,
    Object.keys(built.airlineTeams).length, plan.nFlights, plan.nAssigned, plan.bench.length);
  return { employees: Object.keys(emp).length, rosterRows: ros.length, flights: flt.length, pool: built.pool.length, nFlights: plan.nFlights, nAssigned: plan.nAssigned };
}


// ===== OTDashboard.gs =====

/** OT Dashboard (รายทีม) — คำนวณสดจาก Assignment (เวรรายวัน) → สรุปต่อทีม × สัปดาห์/เดือน + baked fallback
 *  เดิมดึงจาก OT Yearly · ชีต5 (ยังเก็บ otReadSheet5_/otParseSheet5_ ไว้เป็น fallback)
 *  ใหม่: วนอ่านไฟล์เวรรายวันผ่าน rbOpenTodayRoster_ + readRosterFromSpreadsheet → OT/ทีม/วัน = otHours + otHolHrs
 *        เก็บผลต่อวันถาวรในชีตซ่อน OT_DASH_CACHE (1 แถว/วัน) แล้วทยอยคำนวณวันที่ยังไม่มี cache ทีละ budget */
var OT_YEARLY_ID = '1zESOKHDpNqbkXxd3YV0EqVHv6JDeyPjKKpjwJsOMVQ0';
var OT_CACHE_SHEET = 'OT_DASH_CACHE';
var OT_DASH_BUILD = '2026-06-12c';  // build marker — เช็คได้ว่าเวอร์ชันไหนขึ้นระบบจริง (otDashBuild())
var OT_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var OT_ASSIGN_MONTH = 6;   // เดือนแรกที่นับจาก Assignment (มิ.ย.) — ก่อนหน้านี้ (ม.ค.-พ.ค.) ใช้ OT Yearly
var OT_SHEET_NAME = 'สรุป';   // ชื่อชีตสรุป OT ต่อทีม ใน OT Yearly (override ด้วย Script Property OT_SHEET_NAME)
function otSheetName_() { try { return PropertiesService.getScriptProperties().getProperty('OT_SHEET_NAME') || OT_SHEET_NAME; } catch (e) { return OT_SHEET_NAME; } }
function otDashBuild() { return OT_DASH_BUILD; }

/** แปลงค่าเวลา/ระยะเวลาในชีต → ชั่วโมง (ทศนิยม) */
function otHrs_(v) {
  if (v == null || v === '') return 0;
  if (Object.prototype.toString.call(v) === '[object Date]') return Math.round((v.getHours() + v.getMinutes() / 60) * 100) / 100;
  if (typeof v === 'number') return Math.round(v * 24 * 100) / 100;       // duration เก็บเป็นเศษวัน → ×24
  var s = String(v).trim(), m = s.match(/^(\d+):(\d{2})(?::\d{2})?$/);
  if (m) return Math.round((+m[1] + (+m[2]) / 60) * 100) / 100;
  var f = parseFloat(s.replace(/[^0-9.]/g, '')); return isNaN(f) ? 0 : f;
}
function otMonth_(h) { var m = String(h).match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : ''; }

/** parse ชีต "OT Weekly" — OT รายคน×รายวัน (คอลัมน์: ทีม|ลำดับ|รหัส|ชื่อ|ตำแหน่ง| [Code,Hrs]×วันที่)
 *  รวม Hrs ของทุกคน → ทีม × เดือน × สัปดาห์ (ตามวันที่ DD/MM/YYYY ของหัวคอลัมน์) */
function otParseWeekly_(data) {
  // หาแถวหัว 'ทีม' + คอลัมน์ทีม
  var hdr = -1, teamCol = 0;
  for (var i = 0; i < Math.min(8, data.length) && hdr < 0; i++) {
    for (var c = 0; c < Math.min(8, data[i].length); c++) {
      if (String(data[i][c]).trim() === 'ทีม') { hdr = i; teamCol = c; break; }
    }
  }
  if (hdr < 0) throw new Error('ไม่พบคอลัมน์ "ทีม" ในชีต OT Weekly');
  // แถว Code/Hrs (ภายใน hdr..hdr+2) — แถวที่มี 'Hrs'
  var subRow = -1;
  for (var i = hdr; i < Math.min(hdr + 3, data.length) && subRow < 0; i++) {
    if (data[i].some(function (v) { return String(v).trim() === 'Hrs'; })) subRow = i;
  }
  if (subRow < 0) throw new Error('ไม่พบหัวคอลัมน์ "Hrs" ในชีต OT Weekly');
  var dateRow = Math.max(hdr, subRow - 1);                                  // แถววันที่ = เหนือ Code/Hrs
  // map คอลัมน์ → วันที่ (carry-forward เผื่อ merge cell)
  var colDate = [], last = '';
  for (var c = 0; c < data[dateRow].length; c++) {
    var dv = String(data[dateRow][c] == null ? '' : data[dateRow][c]).trim();
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(dv)) last = dv;
    colDate[c] = last;
  }
  var agg = {}, MORD = OT_MONTH_ABBR;
  function bucket(team, dateStr, hrs) {
    var m = String(dateStr).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return;
    var day = +m[1], mon = +m[2] - 1; if (mon < 0 || mon > 11) return;     // DD/MM/YYYY
    var ab = MORD[mon], wk = Math.min(3, Math.floor((day - 1) / 7));
    var T = agg[team] || (agg[team] = {});
    var M = T[ab] || (T[ab] = { weeks: [0, 0, 0, 0], total: 0 });
    M.weeks[wk] = Math.round((M.weeks[wk] + hrs) * 10) / 10;
    M.total = Math.round((M.total + hrs) * 10) / 10;
  }
  for (var r = subRow + 1; r < data.length; r++) {
    var team = String(data[r][teamCol] == null ? '' : data[r][teamCol]).trim();
    if (!team) continue;
    var canon = (typeof otCanonTeam_ === 'function') ? otCanonTeam_(team) : team;
    var row = data[r];
    for (var c = teamCol + 1; c < row.length; c++) {
      if (String(data[subRow][c]).trim() !== 'Hrs') continue;
      var hrs = otHrs_(row[c]);
      if (hrs > 0) bucket(canon, colDate[c], hrs);
    }
  }
  var monthsSet = {}, teams = [];
  Object.keys(agg).forEach(function (tn) {
    var months = agg[tn], total = 0;
    Object.keys(months).forEach(function (m) { monthsSet[m] = 1; total = Math.round((total + months[m].total) * 10) / 10; });
    teams.push({ team: tn, total: total, months: months });
  });
  var months = Object.keys(monthsSet).sort(function (a, b) { return MORD.indexOf(a) - MORD.indexOf(b); });
  teams.sort(function (a, b) { return b.total - a.total; });
  return { months: months, teams: teams };
}
function otParseSheet5_(data) {
  var hr = -1;
  for (var i = 0; i < Math.min(6, data.length); i++) { if (data[i].indexOf('Team/Week') >= 0) { hr = i; break; } }
  if (hr < 0) throw new Error('ไม่พบหัวตาราง Team/Week ในชีต OT');
  var blocks = [];
  for (var c = 0; c < data[hr].length; c++) {
    if (String(data[hr][c]).trim() === 'Team/Week') {
      var wk = []; for (var k = 1; k <= 4; k++) wk.push(String(data[hr][c + k] == null ? '' : data[hr][c + k]).trim());
      blocks.push({ col: c, weeks: wk, month: otMonth_(wk[0]) });
    }
  }
  if (!blocks.length) throw new Error('ไม่พบบล็อกเดือนในชีต OT');
  var teams = {}, order = [];
  for (var r = hr + 1; r < data.length; r++) {
    var first = String(data[r][blocks[0].col] == null ? '' : data[r][blocks[0].col]).trim();
    if (first === 'รวม' || first === 'Code / Week' || first === 'Code/Week' || !first) break;
    blocks.forEach(function (b) {
      var team = String(data[r][b.col] == null ? '' : data[r][b.col]).trim(); if (!team) return;
      if (!teams[team]) { teams[team] = { team: team, months: {}, total: 0 }; order.push(team); }
      var weeks = []; for (var k = 1; k <= 4; k++) weeks.push(otHrs_(data[r][b.col + k]));
      var tot = otHrs_(data[r][b.col + 5]);
      teams[team].months[b.month] = { weeks: weeks, total: tot };
      teams[team].total = Math.round((teams[team].total + tot) * 10) / 10;
    });
  }
  return { months: blocks.map(function (b) { return b.month; }), teams: order.map(function (t) { return teams[t]; }) };
}

/** ดึง gviz CSV (เฉพาะช่วง range ถ้าระบุ) → 2D array */
function otGvizCsv_(id, name, range) {
  var url = 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(name);
  if (range) url += '&range=' + encodeURIComponent(range);
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: true });
  var code = res.getResponseCode(), txt = res.getContentText();
  if (code !== 200) throw new Error('gviz HTTP ' + code + ' (' + (range || 'full') + ')');
  if (/<html|<!DOCTYPE/i.test(txt.slice(0, 200))) throw new Error('เข้าถึงชีตไม่ได้ (หน้า login) — ตรวจสิทธิ์ไฟล์ OT Yearly');
  return Utilities.parseCsv(txt) || [];
}
/** index คอลัมน์ (0-based) → ตัวอักษร A1 (0→A, 26→AA) */
function otColA1_(n) { var s = '', x = n + 1; while (x > 0) { var r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; }

/** อ่านชีต OT → สรุป OT/ทีม/เดือน/สัปดาห์
 *  ชีตสรุปเล็ก (เช่น "สรุป") → อ่านผ่าน SpreadsheetApp ตรงๆ (อ่านค่า cache ในช่วงข้อมูลจริง
 *  ไม่ recalc ทั้งไฟล์เหมือน gviz ที่ทำให้ timeout) · auto-detect รูปแบบ Team/Week หรือ ทีม+Hrs
 *  ชีตใหญ่มาก (OT Weekly ดิบ) → fallback gviz batch */
function otReadSheet5_() {
  var id = otYearlyId_(), name = otSheetName_();
  var sh = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต "' + name + '" ในไฟล์ OT Yearly');
  var lastR = sh.getLastRow(), lastC = sh.getLastColumn();
  if (lastR < 1 || lastC < 1) throw new Error('ชีต "' + name + '" ว่าง (ไม่มีข้อมูล)');
  if (lastR * lastC <= 200000) {                                            // ชีตเล็ก → อ่านทั้งชีตทีเดียว
    var data = sh.getRange(1, 1, lastR, lastC).getValues();
    if (data.slice(0, 8).some(function (r) { return (r || []).indexOf('Team/Week') >= 0; }))
      return otParseSheet5_(data);                                          // รูปแบบ Team/Week
    return otParseWeekly_(data);                                            // รูปแบบ ทีม + Code/Hrs รายวัน
  }
  return otReadWeeklyBatched_(id, name);                                     // ชีตใหญ่ → gviz batch
}

/** อ่าน OT Weekly ดิบ (รายคน×รายวัน) แบบแบ่ง batch คอลัมน์ผ่าน gviz — กัน timeout จากชีตใหญ่ */
function otReadWeeklyBatched_(id, name) {
  var hd = otGvizCsv_(id, name, 'A1:' + otColA1_(900) + '10');               // header probe (กว้างพอครอบคอลัมน์วันที่)
  // OT Weekly ดิบ: หา 'ทีม' + 'Hrs' + แถววันที่
  var hdr = -1, teamCol = 0;
  for (var i = 0; i < Math.min(8, hd.length) && hdr < 0; i++)
    for (var c = 0; c < Math.min(8, (hd[i] || []).length); c++)
      if (String(hd[i][c]).trim() === 'ทีม') { hdr = i; teamCol = c; break; }
  if (hdr < 0) throw new Error('ไม่พบคอลัมน์ "ทีม" ในชีต ' + name);
  var subRow = -1;
  for (var i = hdr; i < Math.min(hdr + 3, hd.length) && subRow < 0; i++)
    if ((hd[i] || []).some(function (v) { return String(v).trim() === 'Hrs'; })) subRow = i;
  if (subRow < 0) throw new Error('ไม่พบหัวคอลัมน์ "Hrs" ในชีต ' + name);
  var dateRow = Math.max(hdr, subRow - 1), colDate = [], last = '';
  for (var c = 0; c < (hd[dateRow] || []).length; c++) {
    var dv = String(hd[dateRow][c] == null ? '' : hd[dateRow][c]).trim();
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(dv)) last = dv;
    colDate[c] = last;
  }
  var hrsCols = [];
  for (var c = teamCol + 1; c < (hd[subRow] || []).length; c++)
    if (String(hd[subRow][c]).trim() === 'Hrs' && colDate[c]) hrsCols.push({ col: c, date: colDate[c] });
  if (!hrsCols.length) throw new Error('ไม่พบคอลัมน์ Hrs ที่มีวันที่ในชีต ' + name);
  // ทีมต่อแถว
  var tcl = otColA1_(teamCol);
  var teamRows = otGvizCsv_(id, name, tcl + '1:' + tcl + '2000');
  var teamByRow = teamRows.map(function (r) { var t = String((r && r[0]) || '').trim(); return t ? otCanonTeam_(t) : ''; });
  // รวมยอดทีละ batch คอลัมน์
  var agg = {}, MORD = OT_MONTH_ABBR;
  function bucket(team, dateStr, hrs) {
    var m = String(dateStr).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return;
    var day = +m[1], mon = +m[2] - 1; if (mon < 0 || mon > 11) return;
    var ab = MORD[mon], wk = Math.min(3, Math.floor((day - 1) / 7));
    var T = agg[team] || (agg[team] = {});
    var M = T[ab] || (T[ab] = { weeks: [0, 0, 0, 0], total: 0 });
    M.weeks[wk] = Math.round((M.weeks[wk] + hrs) * 10) / 10;
    M.total = Math.round((M.total + hrs) * 10) / 10;
  }
  var minC = hrsCols[0].col, maxC = hrsCols[hrsCols.length - 1].col, BATCH = 60;
  for (var start = minC; start <= maxC; start += BATCH) {
    var end = Math.min(maxC, start + BATCH - 1);
    var chunk = otGvizCsv_(id, name, otColA1_(start) + '1:' + otColA1_(end) + '2000');
    var bh = hrsCols.filter(function (h) { return h.col >= start && h.col <= end; });
    for (var r = subRow + 1; r < chunk.length; r++) {
      var team = teamByRow[r]; if (!team) continue;
      var row = chunk[r]; if (!row) continue;
      for (var k = 0; k < bh.length; k++) { var hv = otHrs_(row[bh[k].col - start]); if (hv > 0) bucket(team, bh[k].date, hv); }
    }
  }
  var monthsSet = {}, teams = [];
  Object.keys(agg).forEach(function (tn) {
    var months = agg[tn], total = 0;
    Object.keys(months).forEach(function (m) { monthsSet[m] = 1; total = Math.round((total + months[m].total) * 10) / 10; });
    teams.push({ team: tn, total: total, months: months });
  });
  var months = Object.keys(monthsSet).sort(function (a, b) { return MORD.indexOf(a) - MORD.indexOf(b); });
  teams.sort(function (a, b) { return b.total - a.total; });
  return { months: months, teams: teams };
}

// ─── คำนวณ OT จาก Assignment (เวรรายวัน) ────────────────────────────────────
function otYearlyId_() {
  try { var p = PropertiesService.getScriptProperties().getProperty('OT_YEARLY_ID'); return p || OT_YEARLY_ID; }
  catch (e) { return OT_YEARLY_ID; }
}
function otDateKey_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
}
/** จุดเริ่มช่วงคำนวณจาก Assignment — override ด้วย Script Property OT_DASH_START ; ค่าเริ่มต้น = 1 ของเดือน OT_ASSIGN_MONTH (มิ.ย.) */
function otRangeStart_(now) {
  try {
    var p = PropertiesService.getScriptProperties().getProperty('OT_DASH_START');
    var m = p && String(p).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  } catch (e) {}
  return new Date(now.getFullYear(), OT_ASSIGN_MONTH - 1, 1);
}
/** จำนวนวัน (อดีต) สูงสุดที่จะคำนวณใหม่ต่อการเรียก live 1 ครั้ง — override ด้วย OT_DASH_BUDGET
 *  ค่าน้อยเพื่อให้หน้าเว็บตอบไว (ที่เหลือเติมเบื้องหลังด้วย otWarmCache/trigger) */
function otBudget_() {
  try { var p = parseInt(PropertiesService.getScriptProperties().getProperty('OT_DASH_BUDGET'), 10); if (p > 0) return p; }
  catch (e) {}
  return 12;
}
/** ตัด REV ออกจากชื่อแท็บทีม (ชื่อแท็บใน Assignment = ชื่อกลุ่มทีมอยู่แล้ว เช่น CHINA, QR/MH/OM/DE, PORTER) */
function otTeamName_(nm) {
  return String(nm).replace(/REV\.?\s*\d+\s*/ig, '').replace(/\s+/g, ' ').trim();
}

/** เลขทีม → ชื่อทีมมาตรฐาน (ยืนยันจากข้อมูลจริง; เลข 7 ปล่อยให้สายการบินตัดสิน=AK, 1/2 ยังไม่ทราบ) */
var OT_TEAM_NUM = { '3': 'TR', '4': 'JQ', '5': 'KE', '6': 'QR', '8': 'CHN', '9': 'CHARTER' };
/** รหัสสายการบิน[] → ชื่อทีมมาตรฐานที่ทับซ้อนมากสุด (อ้างอิง ADV_TEAMS · SU→SU/W5/B2) */
function otAirlineTeam_(air) {
  var best = -1, bestN = 0;
  for (var i = 0; i < ADV_TEAMS.length; i++) {
    var n = 0; for (var j = 0; j < air.length; j++) if (ADV_TEAMS[i].airlines.indexOf(air[j]) >= 0) n++;
    if (n > bestN) { bestN = n; best = i; }
  }
  return best >= 0 ? ADV_TEAMS[best].name : '';
}
/** รวมชื่อแท็บที่สะกดต่างกัน (REV/สำเนา/วันที่/ชีต/ลำดับสลับ) ให้เป็นทีมมาตรฐานเดียว — ใช้ตอนแสดงผล */
function otCanonTeam_(raw) {
  var s0 = String(raw || '').replace(/([A-Za-z0-9])x([A-Za-z0-9])/g, '$1 $2');   // JQxTK → JQ TK
  var s = ' ' + s0.toUpperCase() + ' ';
  s = s.replace(/สำเนาของ/g, ' ')
       .replace(/\bREV\b[\s.\-]*\d*/g, ' ')
       .replace(/NORMAL\s*FLT|IF\s*FLT\s*CANCELL?ED|VER\.?\s*FLT\s*CANCEL|DAILY|ASSIGNMENT|\bON\b/g, ' ')
       .replace(/\d{1,2}\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\w*\s*\d{0,4}/g, ' ')   // 03JAN26
       .replace(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/g, ' ')
       .replace(/ชีต\S*/g, ' ').replace(/_CONFLICT\d*/g, ' ');
  if (/CHARTER/.test(s)) return 'CHARTER';
  if (/PORTER/.test(s)) return 'PORTER';
  if (/PVT|PRIVATE|\bVIP\b|\bLP\b/.test(s)) return 'PVT';               // ทีม PVT = Private/VIP/LP (รวมเป็นทีมเดียว)
  if (/\bCHN\b|CHINA/.test(s)) return 'CHN';
  var num = s.match(/TEAM\s*0*(\d{1,2})/);
  if (num && OT_TEAM_NUM[num[1]]) return OT_TEAM_NUM[num[1]];           // เลขทีมที่มั่นใจ
  var air = [];                                                         // รวมรหัสสายการบิน (รวมแบบติดกัน EYAYDV→EY AY DV)
  s.replace(/[^A-Z0-9]+/g, ' ').split(/\s+/).forEach(function (tk) {
    if (!tk || tk === 'TEAM') return;
    if (tk.length >= 2 && tk.length <= 3) air.push(tk);
    else if (tk.length >= 4 && tk.length % 2 === 0) for (var i = 0; i < tk.length; i += 2) air.push(tk.substr(i, 2));
  });
  var byAir = otAirlineTeam_(air);
  if (byAir) return byAir;                                              // SU → SU/W5/B2 (ไม่ใช่ Charter)
  if (num) return 'TEAM ' + num[1];                                    // เลขทีมที่ยังไม่ทราบสายการบิน
  var c = s.replace(/\s+/g, ' ').trim();
  return c || 'อื่นๆ';
}

/** error ชั่วคราว (service timeout/quota/rate) → ควรลองใหม่ ไม่ใช่ cache เป็นว่าง */
function otTransient_(e) {
  return /timed?\s*out|timeout|too many|rate limit|quota|temporarily|try again|service error|internal error/i
    .test(String(e && (e.message || e)));
}
/** อ่านเวรของวันเดียว → {teamName: otHours} ; OT/ทีม = otHours + otHolHrs (รวม OT นักขัต X1)
 *  คืน {} = ไม่มีไฟล์/โครงสร้างผิด (cache กันลองซ้ำ) ; คืน null = error ชั่วคราว (อย่า cache, ลองใหม่รอบหน้า) */
function otComputeDay_(date) {
  var roster;
  try { roster = rbOpenTodayRoster_(date); }
  catch (e) { return otTransient_(e) ? null : {}; }          // ไม่พบไฟล์ → {} ; timeout → null
  if (!roster || !roster.ss) return {};
  var res = null, err = null;
  try { res = readRosterFromSpreadsheet(roster.ss, date); } catch (e2) { err = e2; }
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e3) {} }
  if (err) return otTransient_(err) ? null : {};
  if (!res || !res.teams) return {};
  var out = {};
  Object.keys(res.teams).forEach(function (t) {
    var b = res.teams[t];
    var hrs = Math.round(((b.otHours || 0) + (b.otHolHrs || 0)) * 10) / 10;
    if (hrs > 0) { var nm = otTeamName_(t); out[nm] = Math.round(((out[nm] || 0) + hrs) * 10) / 10; }
  });
  return out;
}

/** cache เก็บใน Script Properties (key = otc_YYYY-MM-DD, value = JSON {team:hrs})
 *  เร็ว ไม่ต้องเปิด spreadsheet ใดๆ — เลิกพึ่งไฟล์ OT Yearly ที่หนัก/timeout */
var OT_CACHE_PREFIX = 'otc_';
function otCacheLoad_() {
  var all = {};
  try { all = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) {}
  var map = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(OT_CACHE_PREFIX) !== 0) return;
    var key = k.slice(OT_CACHE_PREFIX.length);
    try { map[key] = JSON.parse(all[k]) || {}; } catch (e2) { map[key] = {}; }
  });
  return map;
}

/** วนช่วงวัน start→end : ใช้ cache ถ้ามี, ไม่งั้นคำนวณ (จำกัด budget + deadline) ; วันนี้คำนวณสดเสมอ
 *  - เขียน cache ลง Properties ทีละ 8 วัน → ถ้า service timeout กลางคัน ผลที่ทำแล้วไม่หาย (resumable จริง)
 *  - otComputeDay_ คืน null = error ชั่วคราว → นับเป็น pending ไม่ cache ว่าง
 *  คืน { days:[{date,teams}], pending } */
function otComputeRange_(start, end, budget, deadline) {
  var props = PropertiesService.getScriptProperties();
  var map = otCacheLoad_();
  var todayKey = otDateKey_(new Date());
  var batch = {}, batchN = 0, days = [], pending = 0, computed = 0;
  function flush() { if (batchN) { try { props.setProperties(batch, false); } catch (e) {} batch = {}; batchN = 0; } }
  var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  var endT = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  while (d.getTime() <= endT) {
    var key = otDateKey_(d), isToday = (key === todayKey), teams = null;
    if (map.hasOwnProperty(key) && !isToday) {
      teams = map[key];
    } else if (isToday || (computed < budget && Date.now() < deadline)) {
      if (!isToday) computed++;
      teams = otComputeDay_(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      if (teams === null) {                                   // error ชั่วคราว → ลองใหม่รอบหน้า
        pending++;
      } else {
        map[key] = teams; batch[OT_CACHE_PREFIX + key] = JSON.stringify(teams);
        if (++batchN >= 8) flush();                            // flush ระหว่างทาง
      }
    } else {
      pending++;
    }
    if (teams && Object.keys(teams).length) days.push({ date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), teams: teams });
    d.setDate(d.getDate() + 1);
  }
  flush();
  return { days: days, pending: pending };
}

/** รวมผลรายวัน → โครงสร้างเดียวกับ ชีต5 เดิม: { months:['Jan'..], teams:[{team,total,months:{m:{weeks:[4],total}}}] }
 *  สัปดาห์: 1-7, 8-14, 15-21, 22-สิ้นเดือน (index 0-3) */
function otAggregate_(days) {
  var teamMap = {}, order = [], monthsSet = [];
  days.forEach(function (rec) {
    var dt = rec.date, mAbbr = OT_MONTH_ABBR[dt.getMonth()], wkIdx = Math.min(3, Math.floor((dt.getDate() - 1) / 7));
    if (monthsSet.indexOf(mAbbr) < 0) monthsSet.push(mAbbr);
    Object.keys(rec.teams).forEach(function (rawTeam) {
      var hrs = rec.teams[rawTeam]; if (!(hrs > 0)) return;
      var team = otCanonTeam_(rawTeam);                       // รวมชื่อแท็บที่สะกดต่างกัน → ทีมมาตรฐาน
      if (!teamMap[team]) { teamMap[team] = { team: team, total: 0, months: {} }; order.push(team); }
      var T = teamMap[team];
      if (!T.months[mAbbr]) T.months[mAbbr] = { weeks: [0, 0, 0, 0], total: 0 };
      T.months[mAbbr].weeks[wkIdx] = Math.round((T.months[mAbbr].weeks[wkIdx] + hrs) * 10) / 10;
      T.months[mAbbr].total = Math.round((T.months[mAbbr].total + hrs) * 10) / 10;
      T.total = Math.round((T.total + hrs) * 10) / 10;
    });
  });
  monthsSet.sort(function (a, b) { return OT_MONTH_ABBR.indexOf(a) - OT_MONTH_ABBR.indexOf(b); });
  var teams = order.map(function (t) { return teamMap[t]; }).sort(function (a, b) { return b.total - a.total; });
  return { months: monthsSet, teams: teams };
}

/** อ่าน ชีต5 (OT Yearly) → ใช้ค่าที่เก็บถาวรใน Properties ก่อน (เร็ว/ไม่เปิดไฟล์หนัก)
 *  ไฟล์ OT Yearly หนักมาก เปิดสดในหน้าเว็บมักจะ timeout → ต้องรัน otCacheSheet5() ครั้งเดียวก่อน */
var OT_S5_PREFIX = 'ot_s5_';
function otSheet5Cached_() {
  var stored = otSheet5Stored_();
  return (stored && stored.teams && stored.teams.length) ? stored : { months: [], teams: [] };
}
/** อ่านค่า ชีต5 ที่เก็บไว้ (ต่อ chunk) จาก Properties */
function otSheet5Stored_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var n = parseInt(props.getProperty(OT_S5_PREFIX + 'n'), 10);
    if (!(n > 0)) return null;
    var all = props.getProperties(), js = '';
    for (var i = 0; i < n; i++) { var c = all[OT_S5_PREFIX + i]; if (c == null) return null; js += c; }
    return JSON.parse(js);
  } catch (e) { return null; }
}
/** เก็บผล ชีต5 ลง Properties (แบ่ง chunk ละ 8000 ตัวอักษร) */
function otStoreSheet5_(d) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf(OT_S5_PREFIX) === 0) props.deleteProperty(k); });
  var js = JSON.stringify(d), size = 8000, n = Math.max(1, Math.ceil(js.length / size)), set = {};
  for (var i = 0; i < n; i++) set[OT_S5_PREFIX + i] = js.substr(i * size, size);
  set[OT_S5_PREFIX + 'n'] = String(n);
  props.setProperties(set, false);
  return n;
}
/** รันมือครั้งเดียว (มี budget 6 นาที): อ่าน ชีต5 จาก OT Yearly แล้วเก็บถาวร — ให้หน้าเว็บแสดง ม.ค.-พ.ค. */
function otCacheSheet5() {
  var d = otReadSheet5_();
  var n = otStoreSheet5_(d);
  Logger.log('otCacheSheet5: เก็บ ชีต5 สำเร็จ — %s ทีม, %s เดือน, %s chunks', (d.teams || []).length, (d.months || []).length, n);
  return (d.teams || []).length;
}
/** รีเฟรช ชีต5 (อ่านใหม่จาก OT Yearly แล้วเก็บถาวร) — ใช้เมื่อแก้ ม.ค.-พ.ค. ใน OT Yearly */
function otRefreshSheet5() { try { CacheService.getScriptCache().remove('ot_sheet5'); } catch (e) {} return otCacheSheet5(); }

/** รวมข้อมูล ชีต5 (เฉพาะเดือนก่อน OT_ASSIGN_MONTH) + Assignment (เดือน OT_ASSIGN_MONTH ขึ้นไป)
 *  จัดชื่อทีมให้ตรงกันด้วย otCanonTeam_ ; คืน {months, teams} */
function otMergeData_(sheet5, assign) {
  var teamMap = {}, order = [], monthsSet = {};
  function add(src, keepMonth) {
    (src && src.teams || []).forEach(function (t) {
      var name = (typeof otCanonTeam_ === 'function') ? otCanonTeam_(t.team) : t.team;
      var T = teamMap[name]; if (!T) { T = teamMap[name] = { team: name, total: 0, months: {} }; order.push(name); }
      Object.keys(t.months || {}).forEach(function (m) {
        if (keepMonth && !keepMonth(m)) return;
        var mm = t.months[m]; if (!mm) return;
        monthsSet[m] = 1;
        if (!T.months[m]) T.months[m] = { weeks: (mm.weeks || []).slice(0, 4), total: mm.total || 0 };
        else {
          var w = T.months[m].weeks; (mm.weeks || []).forEach(function (x, i) { w[i] = Math.round(((w[i] || 0) + (x || 0)) * 10) / 10; });
          T.months[m].total = Math.round((T.months[m].total + (mm.total || 0)) * 10) / 10;
        }
        T.total = Math.round((T.total + (mm.total || 0)) * 10) / 10;
      });
    });
  }
  var cut = OT_ASSIGN_MONTH - 1;                                           // index เดือนแรกของ Assignment (มิ.ย.=5)
  add(sheet5, function (m) { var i = OT_MONTH_ABBR.indexOf(m); return i >= 0 && i < cut; });   // ชีต5: เฉพาะ ม.ค.-พ.ค.
  add(assign, null);                                                       // Assignment: ทุกเดือนที่คำนวณ (มิ.ย.+)
  var months = Object.keys(monthsSet).sort(function (a, b) { return OT_MONTH_ABBR.indexOf(a) - OT_MONTH_ABBR.indexOf(b); });
  var teams = order.map(function (k) { return teamMap[k]; }).sort(function (a, b) { return b.total - a.total; });
  return { months: months, teams: teams };
}

/** เรียกจาก client (google.script.run) — OT รายทีม: ม.ค.-พ.ค. จาก ชีต5 · มิ.ย.+ จาก Assignment */
function otLiveData() {
  try {
    var now = new Date();
    var r = otComputeRange_(otRangeStart_(now), now, otBudget_(), Date.now() + 150000);
    var assign = otAggregate_(r.days);
    var sheet5 = otSheet5Cached_();
    var merged = otMergeData_(sheet5, assign);
    return { ok: true, months: merged.months, teams: merged.teams, pending: r.pending, source: 'hybrid' };
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}

/** อุ่น cache ทีละชุด (≤24 วัน/รอบ, ตัดที่ 4 นาที กัน service timeout) แล้วตั้ง trigger ทำต่อเองทุก 10 นาที
 *  จนกว่า pending=0 จึงลบ trigger ทิ้ง — เรียกครั้งเดียวจาก editor พอ (resumable เต็มรูปแบบ) */
function otWarmCache() {
  var now = new Date();
  var r = otComputeRange_(otRangeStart_(now), now, 24, Date.now() + 240000);
  Logger.log('otWarmCache: คำนวณรอบนี้เสร็จ, เหลือค้าง pending=%s วัน', r.pending);
  if (r.pending > 0) otEnsureWarmTrigger_(); else { otRemoveWarmTriggers_(); Logger.log('otWarmCache: cache ครบแล้ว ✅ ลบ trigger ทิ้ง'); }
  return r.pending;
}
function otEnsureWarmTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'otWarmCache'; });
  if (!has) ScriptApp.newTrigger('otWarmCache').timeBased().everyMinutes(10).create();
}
function otRemoveWarmTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'otWarmCache') ScriptApp.deleteTrigger(t);
  });
}
/** สั่งหยุดการอุ่น cache อัตโนมัติ (ลบ trigger) */
function otStopWarmCache() { otRemoveWarmTriggers_(); Logger.log('หยุด trigger otWarmCache แล้ว'); }
/** ล้าง cache OT ทั้งหมด (otc_*) — ใช้เมื่อต้องการคำนวณใหม่ทั้งหมด */
function otClearCache() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties() || {}, n = 0;
  Object.keys(all).forEach(function (k) { if (k.indexOf(OT_CACHE_PREFIX) === 0) { props.deleteProperty(k); n++; } });
  Logger.log('otClearCache: ลบ cache %s วัน', n);
  return n;
}

function otDashData_() { return {"months":["(สะสม)"],"teams":[{"team":"CHINA","total":3876.0,"months":{"(สะสม)":{"weeks":[],"total":3876.0}}},{"team":"QR/MH/OM/DE","total":3873.5,"months":{"(สะสม)":{"weeks":[],"total":3873.5}}},{"team":"SQ/CX/LY","total":1914.5,"months":{"(สะสม)":{"weeks":[],"total":1914.5}}},{"team":"JQ/IT/IX/AI/N0","total":1434.5,"months":{"(สะสม)":{"weeks":[],"total":1434.5}}},{"team":"EY/AY/DV","total":1367.5,"months":{"(สะสม)":{"weeks":[],"total":1367.5}}},{"team":"WY/G9/9C/DK","total":964.0,"months":{"(สะสม)":{"weeks":[],"total":964.0}}},{"team":"TK/VJ/SG/HY/OD","total":641.0,"months":{"(สะสม)":{"weeks":[],"total":641.0}}},{"team":"SV/WK/KA","total":462.5,"months":{"(สะสม)":{"weeks":[],"total":462.5}}},{"team":"PORTER","total":146.5,"months":{"(สะสม)":{"weeks":[],"total":146.5}}}]}; }
function otDashCss_() { return OT_DASH_CSS_; }
function otDashHtml_() { return OT_DASH_HTML_; }
function otDashScript_() {
  return '<scr' + 'ipt>(function(){var BAKED=' + JSON.stringify(otDashData_()) + ';' + OT_DASH_JS_ + '})();</scr' + 'ipt>';
}
var OT_DASH_HTML_ = `<div class="ot-head"><div><div class="ot-title">OT <span>Dashboard</span> · รายทีม</div><div class="ot-sub">แผนก การโดยสาร · ม.ค.-พ.ค. จาก OT Yearly · มิ.ย.+ จาก Assignment</div></div><div class="ot-badge">ระบบติดตาม OT</div></div><div class="ot-subtabs"><div class="ot-subtab tab active" data-t="monthly" onclick="otSwitchTab('monthly')">📆 รายเดือน</div><div class="ot-subtab tab" data-t="weekly" onclick="otSwitchTab('weekly')">📅 รายสัปดาห์</div></div><div id="ot-tab-monthly" class="tab-panel active"></div><div id="ot-tab-weekly" class="tab-panel"></div>`;
var OT_DASH_CSS_ = `#view-ot{--surface:#fff;--surface2:#eef3f9;--border:#dbe3ee;--accent:#f97316;--accent2:#3b82f6;--accent3:#0891b2;--danger:#ef4444;--warn:#d97706;--ok:#16a34a;--text:#1f2d3d;--muted:#73839a;color:var(--text)}
#view-ot .ot-head{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#eef3fb,#f6f0ff);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:14px}
#view-ot .ot-title{font-size:20px;font-weight:800;letter-spacing:-.3px}
#view-ot .ot-title span{color:var(--accent)}
#view-ot .ot-sub{font-size:12px;color:var(--muted);margin-top:2px}
#view-ot .ot-badge{background:var(--accent);color:#fff;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;letter-spacing:.5px}
#view-ot .ot-subtabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:18px}
#view-ot .tab{padding:9px 22px;cursor:pointer;border-radius:8px 8px 0 0;font-weight:600;font-size:14px;border:1px solid transparent;border-bottom:none;color:var(--muted)}
#view-ot .tab.active{background:var(--surface);border-color:var(--border);color:var(--text)}
#view-ot .tab:hover:not(.active){color:var(--text);background:var(--surface2)}
#view-ot .tab-panel{display:none}
#view-ot .tab-panel.active{display:block}
#view-ot .info-panel{background:linear-gradient(135deg,rgba(249,115,22,.08),rgba(59,130,246,.06));border:1px solid rgba(249,115,22,.25);border-radius:10px;padding:12px 18px;margin-bottom:18px;display:flex;gap:24px;flex-wrap:wrap}
#view-ot .info-item{font-size:12px;color:var(--muted)}
#view-ot .info-item strong{color:var(--accent);font-size:14px}
#view-ot .stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:26px}
#view-ot .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;position:relative;overflow:hidden;box-shadow:0 1px 4px rgba(20,40,80,.05)}
#view-ot .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent-color,var(--accent))}
#view-ot .stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px}
#view-ot .stat-val{font-size:26px;font-weight:800;color:var(--accent-color,var(--text))}
#view-ot .stat-sub{font-size:11px;color:var(--muted);margin-top:4px}
#view-ot .section{margin-bottom:28px}
#view-ot .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
#view-ot .section-title{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}
#view-ot .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block}
#view-ot .bar-chart{display:flex;flex-direction:column;gap:7px}
#view-ot .bar-row{display:flex;align-items:center;gap:10px}
#view-ot .bar-label{width:150px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
#view-ot .bar-track{flex:1;background:var(--surface2);border-radius:4px;height:22px;position:relative;overflow:hidden}
#view-ot .bar-fill{height:100%;border-radius:4px;background:var(--fill-color,var(--accent));transition:width .6s cubic-bezier(.25,.8,.25,1);display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;min-width:40px}
#view-ot .bar-extra{width:78px;text-align:right;font-size:11px;color:var(--muted);flex-shrink:0}
#view-ot .filter-row{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
#view-ot .search-box{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 14px;font-size:14px;outline:none;flex:1;min-width:200px}
#view-ot .search-box:focus{border-color:var(--accent)}
#view-ot .filter-select{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;font-size:14px;outline:none;cursor:pointer;min-width:170px}
#view-ot .result-count{font-size:12px;color:var(--muted)}
#view-ot .emp-table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px}
#view-ot table{width:100%;border-collapse:collapse;font-size:13px}
#view-ot thead tr{background:var(--surface2)}
#view-ot th{padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;color:var(--muted);text-transform:uppercase;white-space:nowrap;cursor:pointer;user-select:none}
#view-ot th:hover{color:var(--text)}
#view-ot th.sorted{color:var(--accent)}
#view-ot th .sort-icon{margin-left:4px;opacity:.5}
#view-ot th.sorted .sort-icon{opacity:1}
#view-ot tbody tr{border-top:1px solid var(--border);cursor:pointer;transition:background .15s}
#view-ot tbody tr:hover{background:var(--surface2)}
#view-ot tbody tr.expanded{background:var(--surface2)}
#view-ot td{padding:9px 14px}
#view-ot .ot-code{color:var(--muted);font-size:11px;font-family:ui-monospace,monospace}
#view-ot .mono{font-family:ui-monospace,monospace;font-size:13px}
#view-ot .badge-repeat{display:inline-block;background:var(--danger);color:#fff;border-radius:20px;padding:2px 10px;font-weight:700;font-size:12px}
#view-ot .badge-repeat.mid{background:var(--warn)}
#view-ot .badge-repeat.low{background:var(--ok)}
#view-ot .badge-hours{display:inline-block;background:rgba(59,130,246,.13);color:var(--accent2);border-radius:6px;padding:2px 8px;font-weight:700;font-size:12px}
#view-ot .team-tag{display:inline-block;border-radius:4px;padding:1px 7px;font-size:11px}
#view-ot .expand-row{display:none}
#view-ot .expand-row.visible{display:table-row}
#view-ot .expand-row td{padding:0}
#view-ot .expand-inner{background:#f3f8ff;border-left:3px solid var(--accent);padding:12px 18px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#view-ot .detail-chip{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:5px 12px;font-size:12px}
#view-ot .detail-chip span{color:var(--accent);font-weight:700}
#view-ot .detail-chip .ot-over{color:var(--danger);font-size:10px;font-weight:600}
#view-ot .detail-label{font-size:11px;color:var(--muted);margin-right:8px}
#view-ot .chevron{display:inline-block;transition:transform .2s;color:var(--muted);font-size:16px}
#view-ot .chevron.open{transform:rotate(90deg);color:var(--accent)}
#view-ot .empty-state{text-align:center;padding:34px;color:var(--muted)}
@media(max-width:600px){#view-ot .stat-row{grid-template-columns:1fr 1fr}#view-ot .bar-label{width:96px}}
#view-ot .ot-live{background:rgba(22,163,74,.12);color:#16a34a;border-radius:6px;padding:2px 10px;font-weight:700;font-size:12px}
#view-ot .ot-baked{background:rgba(115,131,154,.12);color:#73839a;border-radius:6px;padding:2px 10px;font-weight:700;font-size:12px}`;
var OT_DASH_JS_ = `function fmt(v){return Number(v).toLocaleString('th-TH',{maximumFractionDigits:1});}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
var COLORS=['#f97316','#3b82f6','#0891b2','#a855f7','#16a34a','#ec4899','#f59e0b','#14b8a6','#ef4444','#6366f1','#84cc16','#06b6d4','#e879f9','#fb7185','#fbbf24','#4ade80','#818cf8','#7c3aed','#2dd4bf','#f43f5e'];
var MTH={Jan:'ม.ค.',Feb:'ก.พ.',Mar:'มี.ค.',Apr:'เม.ย.',May:'พ.ค.',Jun:'มิ.ย.',Jul:'ก.ค.',Aug:'ส.ค.',Sep:'ก.ย.',Oct:'ต.ค.',Nov:'พ.ย.',Dec:'ธ.ค.'};
var DATA=BAKED, LIVE=false, selMonth='';
function thM(m){return MTH[m]||m;}
function tcol(team){var i=DATA.teams.map(function(t){return t.team;}).indexOf(team);return COLORS[(i<0?0:i)%COLORS.length];}
function card(c,l,v,s){return '<div class="stat-card" style="--accent-color:'+c+'"><div class="stat-label">'+l+'</div><div class="stat-val">'+v+'</div><div class="stat-sub">'+esc(s)+'</div></div>';}
function section(title,body){return '<div class="section"><div class="section-header"><div class="section-title"><span class="dot"></span> '+title+'</div></div>'+body+'</div>';}
function srcBadge(){if(LIVE){var p=window.__otPending||0;return p>0?'<span class="ot-live">🟢 ประมวลผลอีก '+p+' วัน…</span>':'<span class="ot-live">🟢 ข้อมูลสด</span>';}return '<span class="ot-baked">● ข้อมูลสำรอง (ยังไม่เชื่อมสด)</span>';}
function infoP(type){var crit=type==='weekly'?'รายสัปดาห์ (1-7, 8-14, 15-21, 22-สิ้นเดือน)':'รายเดือน (รวมทั้งเดือน)';return '<div class="info-panel"><div class="info-item">มุมมอง: <strong>'+crit+'</strong></div><div class="info-item">'+srcBadge()+'</div></div>';}
function bars(items){var mx=Math.max.apply(null,items.map(function(t){return t.v;}).concat([1]));return '<div class="bar-chart">'+items.slice().sort(function(a,b){return b.v-a.v;}).map(function(t){var pct=(t.v/mx*100).toFixed(1),col=tcol(t.team);return '<div class="bar-row"><div class="bar-label" title="'+esc(t.team)+'">'+esc(t.team)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;--fill-color:'+col+'">'+fmt(t.v)+' ชม.</div></div></div>';}).join('')+'</div>';}
function buildMonthly(){
  var teams=DATA.teams,months=DATA.months;
  var grand=teams.reduce(function(a,t){return a+t.total;},0);
  var top=teams.slice().sort(function(a,b){return b.total-a.total;})[0]||{team:'-',total:0};
  var cards='<div class="stat-row">'+card('#f97316','OT รวมทั้งหมด',fmt(grand),'ชม. (ทุกทีม ทุกเดือน)')+card('#3b82f6','จำนวนทีม',teams.length,'ทีมที่มี OT')+card('#a855f7','จำนวนเดือน',months.length,months.map(thM).join(' '))+card('#ef4444','ทีมสูงสุด',fmt(top.total),top.team)+'</div>';
  var bar=bars(teams.map(function(t){return {team:t.team,v:t.total};}));
  var thm=months.map(function(m){return '<th>'+thM(m)+'</th>';}).join('');
  var trs=teams.slice().sort(function(a,b){return b.total-a.total;}).map(function(t){var tds=months.map(function(m){var mm=t.months[m];return '<td class="mono">'+(mm&&mm.total?fmt(mm.total):'·')+'</td>';}).join('');return '<tr><td class="b" style="border-left:3px solid '+tcol(t.team)+'">'+esc(t.team)+'</td>'+tds+'<td class="mono b">'+fmt(t.total)+'</td></tr>';}).join('');
  var table='<div class="emp-table-wrap"><table><thead><tr><th>ทีม</th>'+thm+'<th>รวม</th></tr></thead><tbody>'+(trs||'<tr><td colspan="9" class="empty-state">ไม่มีข้อมูล</td></tr>')+'</tbody></table></div>';
  document.getElementById('ot-tab-monthly').innerHTML=infoP('monthly')+cards+section('OT รวมรายทีม (ทั้งช่วง)',bar)+section('ตาราง OT · ทีม × เดือน (ชม.)',table);
}
function buildWeekly(){
  var teams=DATA.teams,months=DATA.months;
  if(!selMonth||months.indexOf(selMonth)<0)selMonth=months[months.length-1]||'';
  var sel='<select class="filter-select" onchange="otSelMonth(this.value)">'+months.map(function(m){return '<option value="'+m+'"'+(m===selMonth?' selected':'')+'>'+thM(m)+'</option>';}).join('')+'</select>';
  var wk=teams.map(function(t){var mm=t.months[selMonth];return {team:t.team,weeks:mm?mm.weeks:[0,0,0,0],total:mm?mm.total:0};}).filter(function(x){return x.total>0;}).sort(function(a,b){return b.total-a.total;});
  var trs=wk.map(function(t){var tds=(t.weeks||[]).map(function(w){return '<td class="mono">'+(w?fmt(w):'·')+'</td>';}).join('');return '<tr><td class="b" style="border-left:3px solid '+tcol(t.team)+'">'+esc(t.team)+'</td>'+tds+'<td class="mono b">'+fmt(t.total)+'</td></tr>';}).join('');
  var table='<div class="emp-table-wrap"><table><thead><tr><th>ทีม</th><th>1-7</th><th>8-14</th><th>15-21</th><th>22-สิ้นเดือน</th><th>รวม</th></tr></thead><tbody>'+(trs||'<tr><td colspan="6" class="empty-state">ไม่มีข้อมูลเดือนนี้</td></tr>')+'</tbody></table></div>';
  var bar=bars(wk.map(function(t){return {team:t.team,v:t.total};}));
  document.getElementById('ot-tab-weekly').innerHTML=infoP('weekly')+'<div class="filter-row"><span style="font-size:13px;color:var(--muted)">เลือกเดือน:</span>'+sel+'</div>'+section('OT รายทีม · เดือน '+thM(selMonth),bar)+section('ตาราง OT · ทีม × สัปดาห์ ('+thM(selMonth)+')',table);
}
function render(){buildMonthly();buildWeekly();}
window.otSelMonth=function(m){selMonth=m;buildWeekly();};
window.otSwitchTab=function(tab){var root=document.getElementById('view-ot');if(!root)return;[].forEach.call(root.querySelectorAll('.ot-subtab'),function(t){t.classList.toggle('active',t.getAttribute('data-t')===tab);});[].forEach.call(root.querySelectorAll('.tab-panel'),function(p){p.classList.remove('active');});var el=document.getElementById('ot-tab-'+tab);if(el)el.classList.add('active');if(tab==='weekly')buildWeekly();else buildMonthly();};
function otFetch(){if(!(window.google&&google.script&&google.script.run))return;google.script.run.withSuccessHandler(function(d){if(d&&d.ok){if(d.teams&&d.teams.length)DATA=d;LIVE=true;window.__otPending=d.pending||0;render();if(d.pending>0&&(window.__otTries=(window.__otTries||0)+1)<80)setTimeout(otFetch,400);}}).withFailureHandler(function(){}).otLiveData();}
function otInit(){if(!document.getElementById('ot-tab-weekly')||window.__otBuilt)return;window.__otBuilt=1;render();otFetch();}
if(document.readyState!=='loading')otInit();else window.addEventListener('load',otInit);
`;


// ===== RosterBot.gs =====

/**
 * RosterBot.gs — integration layer on top of RosterReader.gs
 * =============================================================================
 * Turns the validated roster reader into the actual outputs:
 *   • a Dashboard tab  — per-team headcount + OT + flight counts (+ grand total)
 *   • a Timetable tab  — per-team, per-employee flights with shift / OT and each
 *                        flight's task and open–close (OP/CL) or STA/STD times,
 *                        for judging schedule appropriateness
 *   • a Google Chat summary
 *
 * Requires RosterReader.gs in the same Apps Script project
 * (uses readRosterFromSpreadsheet()).
 *
 * Quick test against a real roster file (recommended first step):
 *   1. put a roster spreadsheet's ID in testRosterFromId()
 *   2. Run → testRosterFromId  → it writes "📊 Dashboard" and "🕓 Timetable"
 *      tabs into a fresh output spreadsheet and logs the link.
 * Daily automation: set CONFIG_RB + a time trigger on runDailyRosterReport.
 */

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

/**
 * รันครั้งเดียวเพื่อตั้ง trigger ให้รายงานออกอัตโนมัติทุกวัน 08:00 และ 14:00
 * (เวลาอิงตาม Time zone ของโปรเจกต์ — ตั้งเป็น Asia/Bangkok ใน Project Settings)
 * แต่ละรอบจะอ่านไฟล์ของวันนั้น + อัปเดตแท็บ + ส่งเข้า Google Chat
 */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyRosterReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyRosterReport').timeBased().atHour(8).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('runDailyRosterReport').timeBased().atHour(14).nearMinute(0).everyDays(1).create();
  var w = PropertiesService.getScriptProperties().getProperty(CONFIG_RB.CHAT_WEBHOOK_PROP) ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง (ใส่ใน Script Properties)';
  Logger.log('✅ ตั้ง trigger รันทุกวัน 08:00 และ 14:00 แล้ว · Google Chat webhook: ' + w);
}

/**
 * รันครั้งเดียวเพื่อบันทึก Google Chat webhook ลง Script Properties
 * (อย่าใส่ URL ลงในโค้ดที่ commit ขึ้น GitHub — เป็นความลับ)
 * วิธีใช้: วาง URL ในตัวแปร url ด้านล่าง → Run setupChatWebhook → แล้วลบ URL ออก
 * หรือไปที่ Project Settings → Script Properties → เพิ่ม GCHAT_WEBHOOK_REPORT เอง
 */
function setupChatWebhook() {
  var url = 'PASTE_GOOGLE_CHAT_WEBHOOK_URL_HERE';
  if (url.indexOf('http') !== 0) { Logger.log('⚠️ วาง URL webhook ในฟังก์ชัน setupChatWebhook ก่อน'); return; }
  PropertiesService.getScriptProperties().setProperty(CONFIG_RB.CHAT_WEBHOOK_PROP, url);
  Logger.log('✅ บันทึก webhook แล้ว → รายงานรายวันจะส่งเข้า Google Chat');
}

/**
 * Open any spreadsheet by id whether it is a native Google Sheet OR an uploaded
 * .xlsx (which SpreadsheetApp.openById cannot read). Returns { ss, tempId }.
 * Requires the Drive API advanced service for the .xlsx case.
 */
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

/**
 * Simplest manual test: read ONE PSA roster file by ID, write the reports.
 * Works on a native Google Sheet OR an .xlsx assignment file.
 * Pass an LL file id + date to include the LL department, e.g.
 *   testRosterFromId('<psaId>', '<llId>', 2026, 6, 6);
 */
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
  var res = readRosterFromSpreadsheet(roster.ss, date);

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

/** Write a row of KPI cards: label row + big value row, one card per column. */
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

/** Manpower-by-X table: X | Total | Working | OT-Off | OT ก่อนกะ | OT หลังกะ | %Working */
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
/** [OT ก่อนกะ, OT หลังกะ, OT OFF] cell strings for one record. */
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

/** บล็อกสัปดาห์ 7 วันในเดือน เริ่มวันที่ 1 (1-7, 8-14, 15-21, …)
 *  ตั้งแต่ มิ.ย. 2026 เป็นต้นไป: สัปดาห์สุดท้าย = 22 ถึงสิ้นเดือน (รวมวัน 29-31 เข้าสัปดาห์เดียว)
 *  ก่อน มิ.ย. 2026: คงเดิม (1-7, 8-14, 15-21, 22-28, 29-สิ้นเดือน) */
function rbWeekRange_(date) {
  var d = date.getDate();
  var daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  var startDay = Math.floor((d - 1) / 7) * 7 + 1;
  var endDay = Math.min(startDay + 6, daysInMonth);
  var fromJun2026 = (date.getFullYear() > 2026) || (date.getFullYear() === 2026 && date.getMonth() >= 5);  // มิ.ย. = month index 5
  if (fromJun2026 && d >= 22) { startDay = 22; endDay = daysInMonth; }   // สัปดาห์สุดท้าย 22-สิ้นเดือน (รวมทั้งสัปดาห์)
  return { startDay: startDay, endDay: endDay };
}

/** Accumulate OT hours per employee across the week (week-to-date up to `date`). */
function rbWeeklyOT_(date) {
  var wr = rbWeekRange_(date);
  var upto = Math.min(date.getDate(), wr.endDay);
  var people = {}, daysRead = [];
  for (var day = wr.startDay; day <= upto; day++) {
    var dt = new Date(date.getFullYear(), date.getMonth(), day);
    var roster;
    try { roster = rbOpenTodayRoster_(dt); } catch (e) { continue; }
    var res;
    try { res = readRosterFromSpreadsheet(roster.ss, dt); } catch (e2) { res = null; }
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

/** Sheet tab: ⏱️ OT รายสัปดาห์ — per-person weekly OT + >36h flag. */
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

/** Standalone: build the weekly-OT tab for a date into the monthly file. */
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


// ===== WebDashboard.gs =====

/**
 * WebDashboard.gs — AOTGA Daily Manpower Dashboard web app (doGet).
 * =============================================================================
 * Visual design adopted from the AOTGA dashboard design system (corporate CI,
 * Kanit, appbar / week nav / KPI hero / panels / tables). Server-rendered so it
 * runs as an Apps Script web app. Deploy → Web app → open the /exec URL.
 * Requires RosterReader.gs / LLReader.gs / MasterReader.gs / RosterBot.gs / SLA.gs.
 */

var AOTGA_LOGO_URL = '';          // ใส่ URL รูป/data-URI ตรงๆ ได้ (มาก่อน)
var PWMS_LOGO_ID   = '1Ya7VigvuEutlL3oECJQj8dJkiM2of30i';   // Google Drive file ID ของโลโก้ AOTGA → สคริปต์อ่าน+แปลง base64 ให้เอง (cache 6 ชม.)
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
  return HtmlService.createHtmlOutput(html).setTitle('PWMS · PSA-HKT Workforce Management System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Load the PSA roster (+ LL) for a date — cached ~3 นาที (CacheService) เพื่อให้สลับแท็บเร็ว
 *  ไม่ต้องไล่หาไฟล์ใน Drive / แปลง xlsx / parse ซ้ำทุกแท็บ · กดปุ่ม 🔄 รีเฟรช = ล้างแคชดึงใหม่ */
function rbLoadResLL_(date) {
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var iso = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  var hit = rbCacheGetBig_('resll_' + iso);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var out = rbLoadResLLraw_(date);
  try { rbCachePutBig_('resll_' + iso, JSON.stringify(out), 180); } catch (e2) {}
  return out;
}
function rbLoadResLLraw_(date) {
  var roster = rbOpenTodayRoster_(date);
  var res = readRosterFromSpreadsheet(roster.ss, date);
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }
  var ll = null;
  if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e2) {} }
  return { res: res, ll: ll };
}
/** CacheService แบบแบ่งชิ้น (รองรับค่า >100KB) */
function rbCachePutBig_(key, str, ttl) {
  var c = CacheService.getScriptCache(), CH = 95000, n = Math.ceil(str.length / CH), parts = {};
  parts[key + '_n'] = String(n);
  for (var i = 0; i < n; i++) parts[key + '_' + i] = str.substr(i * CH, CH);
  c.putAll(parts, ttl || 180);
}
function rbCacheGetBig_(key) {
  var c = CacheService.getScriptCache(), nn = c.get(key + '_n');
  if (!nn) return null;
  var n = +nn, keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { var v = got[key + '_' + j]; if (v == null) return null; s += v; }
  return s;
}
/** ล้างแคชของวันที่นั้น (เรียกจากปุ่ม 🔄 รีเฟรช) */
function rbClearCache(iso) {
  try {
    var c = CacheService.getScriptCache(), nn = c.get('resll_' + iso + '_n'), keys = ['resll_' + iso + '_n'];
    if (nn) for (var i = 0; i < +nn; i++) keys.push('resll_' + iso + '_' + i);
    c.removeAll(keys);
  } catch (e) {}
  return true;
}
function rbDateFromIso_(iso) { var a = String(iso).split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }

/** โลโก้: ใช้ AOTGA_LOGO_URL (URL/data-URI) ก่อน · ไม่งั้นอ่านจาก Google Drive (PWMS_LOGO_ID / Script Property)
 *  แปลงเป็น base64 data-URI แล้ว cache 6 ชม. (สคริปต์มีสิทธิ์ Drive อยู่แล้ว) */
function rbLogoDataUri_() {
  if (AOTGA_LOGO_URL) return AOTGA_LOGO_URL;
  var id = PWMS_LOGO_ID;
  if (!id) { try { id = PropertiesService.getScriptProperties().getProperty('PWMS_LOGO_ID') || ''; } catch (e) {} }
  if (!id) return '';
  var hit = rbCacheGetBig_('pwms_logo'); if (hit) return hit;
  try {
    var b = DriveApp.getFileById(id).getBlob();
    var uri = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    try { rbCachePutBig_('pwms_logo', uri, 21600); } catch (e2) {}
    return uri;
  } catch (e3) { return ''; }
}

/** Lazy tab: Timetable HTML (called from client via google.script.run). */
function rbTimetableHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    return rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
      '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
      rbTtRows_(d.res, d.ll),
      rbCtrls_('view-tt', true));
  } catch (e) { return '<div class="panel">โหลด Timetable ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
/** Lazy tab: Flights & SLA HTML. */
function rbFlightsHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    return rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>จัด/รวม</th><th>SUP</th><th>FC</th><th>Check-in</th><th>Arrival</th><th>Gate<br>Monitor</th><th>Gate<br>Agent</th><th>สถานะ</th></tr>',
      rbFltRows_(d.res, d.ll), rbCtrls_('view-flt', true));
  } catch (e) { return '<div class="panel">โหลด Flights ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

/** Lazy tab: ตรวจความเหมาะสมการ Assign (ครอบคลุมไฟลท์ / OT / ช่วงว่าง). */
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
      return '<tr class="' + (r.status === 'bad' ? 'rowbad' : '') + '" data-team="' + rbEsc_(r.team) + '" data-gaps="' + rbEsc_(r.gapsRaw || '') + '"><td>' + emo + '</td><td class="b">' +
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
      rows, rbCtrls_('view-ac', true) + rbGapCtrl_('view-ac'));
  } catch (e) { return '<div class="panel">โหลดตรวจ Assign ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbEsc_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function rbAttr_(s){ return rbEsc_(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function rbOtTxt_(n,h){ return n>0 ? (n+' <span class="muted">('+h+'h)</span>') : '·'; }

/** chip คนที่ถูกจัด: ชื่อ "แก้ไขได้" (contenteditable) + คลิกที่ตำแหน่ง/ℹ ดูงาน/OT/ไฟลท์ (popup) */
function rbPlanChip_(p) {
  var busyCls = p.n >= 5 ? ' sup--busy' : (p.n === 0 ? ' sup--free' : '');
  return '<span class="chip chip--duty supchip planchip' + busyCls + '"' +
    ' data-nm="' + rbAttr_(p.name) + '" data-pos="' + rbAttr_(p.pos) + '" data-pteam="' + rbAttr_(p.team) + '"' +
    ' data-shift="' + rbAttr_(p.shift || '-') + '" data-ot="' + rbAttr_(p.ot || '-') + '" data-hrs="' + (p.hrs || 0) + '" data-n="' + (p.n || 0) + '"' +
    ' data-flts="' + rbAttr_((p.flts || []).join('‖')) + '">' +
    '<span class="editnm" contenteditable="true" spellcheck="false" onclick="event.stopPropagation()"' +
    ' oninput="var c=this.closest(\'.supchip\');c.dataset.nm=this.textContent;c.classList.add(\'edited\')" title="' + rbAttr_(p.name) + ' · คลิกแก้ไข">' + rbEsc_(p.name) + '</span>' +
    '<span class="planchip__i" onclick="showPsn(this.closest(\'.supchip\'))" title="ดูงาน/OT/ไฟลท์ที่ทำ"> ' + rbEsc_(p.pos) + ' ⓘ</span></span>';
}

/** กลุ่มรายชื่อคน (จัดกลุ่มตามทีม) เป็น chip แบบแก้ไขได้ + มี popup งาน/OT/ไฟลท์ */
function rbPlanNames_(arr) {
  if (!arr || !arr.length) return '<span class="muted">—</span>';
  var by = {}, order = [];
  arr.forEach(function (p) { if (!by[p.team]) { by[p.team] = []; order.push(p.team); } by[p.team].push(p); });
  return order.map(function (t) {
    return '<span class="supgrp"><span class="supgrp__t">' + rbEsc_(t) + ' ' + by[t].length + '</span>' +
      by[t].map(rbPlanChip_).join('') + '</span>';
  }).join('');
}

/** Lazy tab 1: 🤖 เติมจาก Assign เดิม (โหมด A — gap-fill) */
function rbFillPlanHtml(iso, fcJson) {
  try {
    var fcBy = {}; try { fcBy = fcJson ? JSON.parse(fcJson) : {}; } catch (e0) {}
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var gaps = apFillGaps_(d.res, d.ll, fcBy);
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
    return hd + rbExpBar_('fill') + rbCommonsHtml_(gaps.commons, 'fill') + rbTblCard_('🤖 เติมคนเสริมไฟลท์ที่ขาด (ข้ามทีม)',
      '<tr><th>Flight</th><th>สายการบิน</th><th>STD/STA</th><th>ตำแหน่งที่ขาด</th><th>ช่วงเวลา</th><th>ระบบที่ต้องใช้</th><th>คนที่จัดให้</th><th>สถานะ</th></tr>',
      bodyA, rbCtrls_('view-fill', true));
  } catch (e) { return '<div class="panel">โหลด "เติม Assign เดิม" ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

/** Lazy tab 2: 🤖 Auto Assign (โหมด B — จัดใหม่ทั้งหมด) */
function rbAutoAssignHtml(iso, fcJson) {
  try {
    var fcBy = {}; try { fcBy = fcJson ? JSON.parse(fcJson) : {}; } catch (e0) {}
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rp = apReplan_(d.res, d.ll, fcBy);
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
    return hd + rbExpBar_('auto') + rbCommonsHtml_(rp.commons, 'auto') + tblB + benchHtml;
  } catch (e) { return '<div class="panel">โหลด "Auto Assign" ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

/** Lazy tab: 🆘 Support — ไฟลท์ที่คนไม่ครบ + คนที่ว่าง & รู้ระบบเช็คอินมาช่วยได้ */
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
      var who;
      if (r.cands.length) {
        var grps = slaGroupCands_(r.cands);
        function sel(defName) {
          var h = '<select class="namepick"><option value=""' + (defName ? '' : ' selected') + '>— เลือกคน —</option>';
          grps.forEach(function (g) {
            h += '<optgroup label="' + rbEsc_(g.team) + ' (' + g.people.length + ')">';
            g.people.forEach(function (p) {
              h += '<option value="' + rbAttr_(p.name) + '"' + (p.name === defName ? ' selected' : '') + '>' +
                rbEsc_(p.name + ' · ' + (p.pos || '') + ' · ' + (p.shift || '') + ' · ' + (p.n || 0) + ' ไฟลท์') + '</option>';
            });
            h += '</optgroup>';
          });
          return h + '</select>';
        }
        // 1 ช่อง = 1 คน · ตั้งค่าเริ่มเป็นคนละคน (cands[i]) ช่องที่เกินจำนวนคนว่าง = ปล่อยว่าง (ไม่ซ้ำคนเดิม)
        var slots = [];
        for (var i = 0; i < r.shortN; i++) slots.push(sel(r.cands[i] ? r.cands[i].name : ''));
        who = '<div class="pickwrap">' + slots.join('') + '</div>';
      } else {
        who = '<span class="badd">' + (r.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + rbEsc_(r.needSys) : 'ไม่มีคนว่าง') + '</span>';
      }
      return '<tr class="' + (r.cands.length ? '' : 'rowbad') + '" data-team="' + rbEsc_(r.team) + '"><td class="b">' + rbEsc_(r.flight) +
        '</td><td>' + rbEsc_(r.airline) + '</td><td>' + rbEsc_(r.system || '-') + '</td><td>' + rbEsc_(r.team) + '</td><td class="tnum">' + rbEsc_(r.STD) +
        '</td><td class="badd">' + rbEsc_(r.phase) + ' ขาด ' + r.shortN + (r.needSys ? ' <span class="muted">(' + rbEsc_(r.needSys) + ')</span>' : '') +
        '</td><td class="tnum">' + rbEsc_(r.win) + '</td><td>' + who + '</td></tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="8" class="okk" style="text-align:center;padding:20px">✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA</td></tr>';
    var sosTxt = ''; try { sosTxt = slaSOSText_(d.res, d.ll, iso); } catch (es) { sosTxt = ''; }
    var sosBlock = '<details class="tablecard" style="margin-bottom:10px"><summary style="cursor:pointer;padding:10px 14px;font-weight:700">📋 ข้อความ SOS (คัดลอกส่งไลน์ได้เลย · เฉพาะคนทีมอื่น)</summary>' +
      '<div style="padding:8px 14px"><button class="btn btn--accent" onclick="(function(b){var t=b.parentNode.querySelector(\'textarea\');t.focus();t.select();if(navigator.clipboard){navigator.clipboard.writeText(t.value);}else{document.execCommand(\'copy\');}b.textContent=\'✓ คัดลอกแล้ว\';setTimeout(function(){b.textContent=\'📋 คัดลอกข้อความ\';},1500);})(this)">📋 คัดลอกข้อความ</button>' +
      '<textarea readonly rows="16" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px;white-space:pre;overflow:auto">' + rbEsc_(sosTxt) + '</textarea></div></details>';
    return hd + sosBlock + rbTblCard_('🆘 ไฟลท์คนไม่ครบ + เลือกคนมาช่วย (แสดงกะ · จำนวนไฟลท์)',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ระบบเช็คอิน</th><th>ทีม</th><th>STD</th><th>ตำแหน่งที่ขาด</th><th>ช่วงเวลา</th><th>เลือกคนมาช่วย (ทีมเจ้าของก่อน · กะ · จำนวนไฟลท์)</th></tr>',
      body, rbCtrls_('view-sup', true));
  } catch (e) { return '<div class="panel">โหลด Support ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
/** ตัวกรองหัวการ์ด: ช่องค้นหา + dropdown เลือกทีม (เติม option ด้วย JS หลังโหลด) */
function rbCtrls_(viewId, withSearch){
  return (withSearch ? '<input class="search" placeholder="🔎 ค้นหา" oninput="applyFilter(\''+viewId+'\')">' : '') +
    '<select class="teamsel" onchange="applyFilter(\''+viewId+'\')"><option value="">ทุกทีม</option></select>';
}
/** ตัวกรอง "หาคนว่างในช่วงเวลา" — แสดงเฉพาะแถวที่มีช่วงว่างคาบเกี่ยวเวลาที่เลือก */
function rbGapCtrl_(viewId){
  return '<span class="gapfilter" style="display:inline-flex;align-items:center;gap:4px;margin-left:8px">' +
    '🕓 ว่างช่วง <input type="time" class="gapfrom" onchange="applyFilter(\''+viewId+'\')" style="padding:4px 6px;border:1px solid #cdd8e6;border-radius:6px">' +
    '– <input type="time" class="gapto" onchange="applyFilter(\''+viewId+'\')" style="padding:4px 6px;border:1px solid #cdd8e6;border-radius:6px">' +
    '<button class="btn" onclick="clearGap(\''+viewId+'\')" style="padding:4px 10px">ล้าง</button> <span class="gapcount" style="font-size:12px;color:var(--good);font-weight:600"></span></span>';
}
/** แสดงผล common check-in (SU/SQ): เคาน์เตอร์รวมหมุนเวียน + เกทต่อไฟลท์ · kind = "fill"|"auto" */
function rbCommonsHtml_(commons, kind){
  if (!commons || !commons.length) return '';
  return commons.map(function(cm){
    var nCt = (cm.counters[0] && cm.counters[0].slots.length) || 0;
    var fcSel = cm.fc ? ' <span class="muted" style="font-weight:400;font-size:12px">· 🎧 Flight Controller:</span> <select class="fcpick" data-code="'+rbEsc_(cm.code)+'" onchange="fcPick(\''+(kind||'fill')+'\')" style="padding:3px 6px;border:1px solid #cdd8e6;border-radius:6px;font-size:12px">'+(cm.members||[]).map(function(m){return '<option value="'+rbAttr_(m.name)+'"'+(m.name===cm.fc.name?' selected':'')+'>'+rbEsc_(m.name)+' ('+rbEsc_(m.pos)+')</option>';}).join('')+'</select>' : '';
    var h = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>🛄 '+rbEsc_(cm.code)+' — เช็คอินคอมมอน '+nCt+' เคาน์เตอร์ (หมุนเวียน ≤3 ชม./คน)'+fcSel+'</h3></div><div style="padding:6px 14px 12px">';
    cm.counters.forEach(function(b){
      h += '<div class="sectionlabel" style="margin:8px 0 4px">⏱️ ช่วง <b>'+rbEsc_(b.time)+'</b>'+(b.round?' · รอบ '+rbEsc_(b.round):'')+' · ไฟลท์ '+rbEsc_(b.flights)+' · <span class="muted">คนว่าง '+b.nAvail+'</span></div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px">'+b.slots.map(function(s){
        return '<span class="chip">'+rbEsc_(s.counter)+': '+(s.chosen?rbEsc_(s.chosen.name)+' <span class="muted">'+rbEsc_(s.chosen.pos)+'</span>':'<span class="muted">— ว่าง —</span>')+'</span>';
      }).join('')+'</div>';
    });
    h += '</div></div>';
    if (cm.gates && cm.gates.length){
      h += '<div class="tablecard" style="margin-top:10px"><div class="tablecard__hd"><h3>🚪 '+rbEsc_(cm.code)+' — Gate ต่อไฟลท์ (คนต่อเนื่องจากเช็คอิน)</h3></div><div style="padding:6px 14px 12px">';
      cm.gates.forEach(function(g){
        h += '<div class="sectionlabel" style="margin:8px 0 4px">✈️ <b>'+rbEsc_(g.flight)+'</b> · STD '+rbEsc_(g.std)+'</div>';
        h += '<div style="display:flex;flex-wrap:wrap;gap:6px">'+g.roles.map(function(rl){
          return rl.picks.map(function(pk,idx){
            return '<span class="chip">'+rbEsc_(rl.lb)+(rl.need>1?' '+(idx+1):'')+' <span class="muted">'+rbEsc_(rl.win)+'</span>: '+(pk?rbEsc_(pk.name)+' <span class="muted">'+rbEsc_(pk.pos)+'</span>':'<span class="badd">— ขาด —</span>')+'</span>';
          }).join('');
        }).join('')+'</div>';
      });
      h += '</div></div>';
    }
    return h;
  }).join('');
}
/** แถบส่งออกไฟล์ชีตรายทีม (FillPlan / AutoAssign) — kind = "fill" | "auto" */
function rbExpBar_(kind){
  return '<div class="expbar" style="margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<b>📤 ส่งให้พนักงาน:</b> <select class="expteam"><option value="">ทุกทีม</option></select> ' +
    '<button class="btn btn--accent" onclick="'+kind+'Export()">สร้างไฟล์ชีต (1 แท็บ/ทีม)</button>' +
    '<span class="expmsg muted"></span></div>';
}

// ── header + week nav + tabs ────────────────────────────────────────────────
function rbAppbar_(date) {
  var be = date.getFullYear()+543;
  var logo = ''; try { logo = rbLogoDataUri_(); } catch (elg) {}
  return '<div class="appbar rise"><div class="appbar__row">' +
    '<div class="brand">' + (logo ? '<img class="brand__logo" src="' + logo + '" alt="AOTGA">' : '<div class="brand__mark">✈</div>') + '<div><h1>P<span>WMS</span></h1>' +
    '<p>PSA-HKT Workforce Management System</p></div></div>' +
    '<div class="appbar__meta"><div class="datepill"><div class="d tnum">' + date.getDate()+' '+MONW[date.getMonth()]+' '+be +
    '</div><div class="s">Daily Manpower · ตารางกำลังพลรายวัน</div></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">' +
    '<div class="livedot"><i></i>Live</div>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn" onclick="pwmsHelp(1)" title="คู่มือการใช้งาน">ℹ️ ช่วยเหลือ</button>' +
    '<button class="btn btn--accent" onclick="window.print()">⬇ Export PDF</button></div></div></div></div></div>';
}
/** หน้าต่างคู่มือการใช้งาน (เปิดด้วยปุ่ม ℹ️ ช่วยเหลือ) */
function rbHelpModal_() {
  return '<div id="helpov" class="helpov" style="display:none" onclick="if(event.target===this)pwmsHelp(0)">' +
    '<div class="helpbox">' +
    '<div class="helpbox__hd"><h3>ℹ️ คู่มือการใช้งาน PWMS</h3><button class="helpx" onclick="pwmsHelp(0)">✕</button></div>' +
    '<div class="helpbox__bd">' +
    '<p class="muted">ระบบอ่านไฟล์ assignment รายวันจาก Drive แล้วสรุปกำลังพล · ตรวจ SLA · หาคนช่วยข้ามทีม — เลือกวันที่ได้จากแถบบน · กด 🔄 เมื่อแก้ไฟล์แล้วอยากให้ดึงใหม่</p>' +

    '<h4>📑 แท็บต่าง ๆ</h4><ul class="helpul">' +
    '<li><b>▦ Dashboard</b> — ภาพรวมกำลังพล แยกราย<b>ทีม</b>/<b>ตำแหน่ง</b> (Total · มาทำงาน · หยุด · OT)</li>' +
    '<li><b>🕓 Timetable</b> — รายคน: กะเข้า-ออก · OT · ไฟลท์ที่รับผิดชอบ (ค้นหาชื่อได้)</li>' +
    '<li><b>✈️ Flights & SLA</b> — ราย<b>ไฟลท์</b>: จัดจริง vs SLA ต้องการ → ✅ ครบ / ⚠️ ขาด</li>' +
    '<li><b>🆘 ไฟลท์คนไม่ครบ</b> — ไฟลท์ที่ขาด + แนะคนมาช่วยข้ามทีม</li>' +
    '<li><b>📅 จัดล่วงหน้า</b> — จัดเวรอัตโนมัติลงเคาน์เตอร์/เกท + export 1 แท็บ/ทีม</li>' +
    '<li><b>🔧 ตรวจ Assign</b> — ตรวจ OT เกิน · ช่วงว่าง · ครอบคลุมไฟลท์</li>' +
    '<li><b>OT Dashboard</b> — สรุปชั่วโมง OT สะสมรายทีม</li></ul>' +

    '<h4>🆘 วิธีอ่านแท็บ "ไฟลท์คนไม่ครบ"</h4>' +
    '<p>คอลัมน์: <code>Flight · สายการบิน · ระบบเช็คอิน · ทีม · STD · ตำแหน่งที่ขาด · ช่วงเวลา · เลือกคนมาช่วย</code></p>' +
    '<ul class="helpul">' +
    '<li><b>ตำแหน่งที่ขาด</b> เช่น "Check-in ขาด 3 (Sabre)" = ขาดคนเช็คอิน 3 · ต้องรู้ระบบ Sabre</li>' +
    '<li><b>ช่วงเวลา</b> = คนช่วยต้องว่างครอบช่วงนี้</li>' +
    '<li>ป้ายคนช่วย: <code>ชื่อ · ตำแหน่ง · กะ · X ไฟลท์</code> → <b>"0 ไฟลท์" = ว่างสุด เลือกก่อน</b></li>' +
    '<li><b>OFF · re-sked 08:00-20:00</b> = คนหยุด เรียกมาช่วยได้ตามกะเดิม (ทางเลือกท้ายสุด)</li>' +
    '<li>ลำดับแนะ: <b>ทีมลอย (PVTLP/STBY) ก่อน</b> → คนทำงาน → คนหยุด</li></ul>' +

    '<h4>🟢 สถานะคน (นับเป็น "มาทำงาน" ไหม)</h4><ul class="helpul">' +
    '<li><b>working</b> (Onduty) → ✅ &nbsp; <b>ot_off</b> (วันหยุดมาทำ OT จริง) → ✅</li>' +
    '<li><b>off</b> (รวม "OT OFF" ที่ยังไม่มีชั่วโมง OT) → ❌ &nbsp; <b>sick/vac/ลา</b> → ❌</li>' +
    '<li><b>on-duty = working + ot_off</b></li></ul>' +

    '<h4>✈️ SLA — คนต่อไฟลท์ (ตัวอย่าง)</h4>' +
    '<table class="helptb"><tr><th>สาย</th><th>ระบบ</th><th>SUP</th><th>Check-in</th><th>Arr</th><th>Gate</th><th>รวม</th></tr>' +
    '<tr><td>EK</td><td>AS Connect</td><td>1</td><td>7</td><td>3</td><td>2</td><td>13</td></tr>' +
    '<tr><td>EY</td><td>Altea</td><td>1</td><td>9</td><td>1</td><td>2</td><td>13</td></tr>' +
    '<tr><td>QR</td><td>Altea</td><td>1</td><td>9</td><td>2</td><td>2</td><td>14</td></tr>' +
    '<tr><td>SQ</td><td>Altea</td><td>1</td><td>5</td><td>1</td><td>2</td><td>9</td></tr>' +
    '<tr><td>AK</td><td>Gonow</td><td>1</td><td>3</td><td>1</td><td>2</td><td>7</td></tr>' +
    '<tr><td>PG</td><td>Altea</td><td>1</td><td>0</td><td>1</td><td>2</td><td>5</td></tr></table>' +
    '<p class="muted">Gate Agent ใช้คนจากเช็คอินย้ายไปเกท (ไม่นับซ้ำใน "รวม") · ขาออกอย่างเดียว→ไม่นับ Arrival · ขาเข้าอย่างเดียว→ไม่นับ Check-in/Gate · ตารางเต็มดูในเอกสาร docs/</p>' +

    '<h4>⚠️ ตัวเลขเพี้ยน เช็คก่อน</h4><ul class="helpul">' +
    '<li>แก้ไฟล์แล้วยังเห็นของเก่า → กด <b>🔄 รีเฟรช</b></li>' +
    '<li>ทีมมาทำงานเยอะผิดปกติ → ไฟล์เปลี่ยนฟอร์ม / คอลัมน์สถานะชื่อแปลก</li>' +
    '<li>ไฟลท์จัดคนซ้ำ → เลขไฟลท์เขียน 2 แถว (เช่น EK396/397 กับ EK397)</li></ul>' +

    '</div></div></div>';
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
    '<button class="tab" id="tab-ot" onclick="showView(\'ot\')">⏱️ OT Dashboard</button>' +
    '<button class="tab" onclick="rbRefresh(this)" title="ล้างแคช ดึงข้อมูลล่าสุดจากชีต" style="margin-left:auto">🔄 รีเฟรช</button></div>';
}

/** Called from the client (google.script.run) when the OT-week tab is opened.
 *  Computes weekly OT (reads the week's files) and returns the table HTML. */
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
  return slaCollectFlights_(res, ll).filter(function (f) { return !(f.noTime && f.fragment); }).map(function (f) {   // ซ่อนเศษขา (ขาที่สองซ้ำของไฟลท์ที่มีอยู่แล้ว)
    var R = slaRoles_(f.airline);
    function rc(n){ return '<td class="tnum">'+(n||0)+'</td>'; }
    var st = f.noTime ? '<span class="badd">⚠️ ขาด STA/STD — เติมเวลาในชีต</span>'
           : (f.ok ? '<span class="okk">✅ ครบ</span>' : '<span class="badd">⚠️ '+rbEsc_(slaShortText_(f))+'</span>');
    return '<tr class="'+(f.ok&&!f.noTime?'':'rowbad')+'" data-team="'+rbEsc_(f.teamList)+'"><td class="b">'+rbEsc_(f.flight)+'</td><td>'+f.airline+'</td><td>'+rbEsc_(f.teamList)+
      '</td><td class="tnum">'+(f.STA||'')+'</td><td class="tnum">'+(f.STD||'')+'</td><td class="tnum"><b>'+f.assigned.total+'</b>/'+(R.total||f.req.total)+'</td>'+
      rc(R.SUP)+rc(R.FC)+rc(R.CI)+rc(R.ARR)+rc(R.GM)+rc(R.GA)+'<td>'+st+'</td></tr>';
  }).join('');
}

function rbTblCard_(title, headHtml, bodyHtml, extraHd) {
  return '<div class="tablecard"><div class="tablecard__hd"><h3>'+title+'</h3>'+(extraHd||'')+'</div>' +
    '<div style="overflow-x:auto"><table class="tbl"><thead>'+headHtml+'</thead><tbody>'+bodyHtml+'</tbody></table></div></div>';
}

function rbBuildDashboardHtml_(res, ll, master, date, iso, base, tz, staticMode) {
  var logo = ''; try { logo = rbLogoDataUri_(); } catch (elg) {}
  var P = res.totals, L = ll && ll.totals.staff>0 ? ll.totals : null;
  function comb(k){ return P[k] + (L?L[k]:0); }
  var C = { staff:comb('staff'), working:comb('working')+comb('ot_off'), off:comb('off'), sick:comb('sick'),
            leave:comb('leave'), ot_off:comb('ot_off'), otOffHrs:Math.round(comb('otOffHrs')*10)/10,
            otPeople:comb('otPeople'), otHours:Math.round(comb('otHours')*10)/10,
            otPre:comb('otPre'), otPreHrs:Math.round(comb('otPreHrs')*10)/10,
            otPost:comb('otPost'), otPostHrs:Math.round(comb('otPostHrs')*10)/10 };
  var teamOrder = Object.keys(res.teams).sort(function(a,b){ return (res.teams[b].working+res.teams[b].ot_off)-(res.teams[a].working+res.teams[a].ot_off); });
  var shortCount = 0; try { shortCount = slaCollectFlights_(res, ll).filter(function(f){return !f.ok && !f.noTime;}).length; } catch (esc) {}
  var acCount = 0; try { acCount = acAnalyze_(res, ll).summary.bad; } catch (eac) {}

  var cd = { tn:teamOrder, tw:teamOrder.map(function(t){return res.teams[t].working+res.teams[t].ot_off;}),
    tt:teamOrder.map(function(t){return res.teams[t].staff;}), work:C.working, off:C.off, sick:C.sick, leave:C.leave,
    otPreN:C.otPre, otPostN:C.otPost, otOffN:C.ot_off, otPreH:C.otPreHrs, otPostH:C.otPostHrs, otOffH:C.otOffHrs,
    otHolN:C.otHol, otHolH:C.otHolHrs, c:CI };

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
    (C.otHolHrs > 0 ? '<div class="otrow"><span>🎉 OT นักขัต ×1</span><b class="tnum">'+C.otHol+' คน · '+C.otHolHrs+'h</b></div>' : '') +
    '<div class="otrow"><span>รวม OT</span><b class="tnum">'+C.otPeople+' คน · '+C.otHours+'h</b></div></div>';
  var holBanner = res.holiday ? '<div class="sectionlabel" style="background:#fff4e6;border-left:4px solid #f97316;padding:9px 12px;border-radius:8px;margin-bottom:4px">🎉 วันนี้เป็น<b>วันหยุดประเพณี</b>: '+rbEsc_(res.holiday)+' — ผู้ที่มาทำงานได้ <b>OT นักขัต ×1</b> เท่าชั่วโมงกะ ('+C.otHol+' คน · '+C.otHolHrs+'h)</div>' : '';

  // tab contents: inline (offline file) or lazy placeholders (web app)
  var ttInner = staticMode
    ? rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
        '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
        rbTtRows_(res, ll), rbCtrls_('view-tt', true))
    : '<div id="ttbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Timetable…</div></div>';
  var fltInner = staticMode
    ? rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
        '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>จัด/รวม</th><th>SUP</th><th>FC</th><th>Check-in</th><th>Arrival</th><th>Gate<br>Monitor</th><th>Gate<br>Agent</th><th>สถานะ</th></tr>',
        rbFltRows_(res, ll), rbCtrls_('view-flt', true))
    : '<div id="fltbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Flights &amp; SLA…</div></div>';
  var otInner = otDashHtml_();                                         // OT Dashboard (baked-in, client-side) แทนแท็บ OT เดิม
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
    '<style>' + rbDesignCss_() + otDashCss_() + '</style></head><body><div class="wrap">' +
    rbAppbar_(date) + rbWeekNav_(date, iso, base, tz) + rbTabs_(shortCount, acCount) +
    '<div id="view-dash">' +
    holBanner + rbKpiHero_(C, master) + masterLine +
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
    '<div class="foot">' + (logo ? '<img class="foot__logo" src="' + logo + '" alt="AOTGA">' : '') + '<span>แผนกการโดยสาร ท่าอากาศยานภูเก็ต · บริษัท บริการภาคพื้น ท่าอากาศยานไทย จำกัด (AOTGA)</span></div>' +
    '</div>' +
    '<div id="psnpop" class="psnpop" style="display:none" onclick="event.stopPropagation()"></div>' +
    rbHelpModal_() +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>' +
    '<script>var CD=' + JSON.stringify(cd) + ';var ISO=' + JSON.stringify(iso) + ';var STATIC=' + (staticMode ? 'true' : 'false') + ';' +
    'function showView(v){["dash","tt","flt","sup","ac","fill","auto","adv","ot"].forEach(function(x){document.getElementById("view-"+x).style.display=v===x?"":"none";document.getElementById("tab-"+x).className="tab"+(v===x?" active":"");});}' +
    'function pwmsHelp(s){var o=document.getElementById("helpov");if(o){o.style.display=s?"flex":"none";document.body.style.overflow=s?"hidden":"";}}' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape")pwmsHelp(0);});' +
    'var LD={};function lazy(box,fn,id){if(STATIC||LD[id])return;LD[id]=1;if(!(window.google&&google.script&&google.script.run)){document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">เปิดผ่าน Web App URL (/exec) เพื่อดูส่วนนี้</div>";return;}' +
    'google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){LD[id]=0;document.getElementById(box).innerHTML="<div class=\\"panel\\">โหลดไม่ได้: "+e.message+"</div>";})[fn](ISO);}' +
    'function loadTT(){lazy("ttbox","rbTimetableHtml","tt");}function loadFlt(){lazy("fltbox","rbFlightsHtml","flt");}function loadOT(){}function loadAC(){lazy("acbox","rbAssignHtml","ac");}function loadSup(){lazy("supbox","rbSupportHtml","sup");}function loadFill(){lazy("fillbox","rbFillPlanHtml","fill");}function loadAuto(){lazy("autobox","rbAutoAssignHtml","auto");}' +
    'function rbRefresh(b){if(b){b.textContent="⏳ กำลังรีเฟรช…";}if(window.google&&google.script&&google.script.run){google.script.run.withSuccessHandler(function(){location.reload();}).withFailureHandler(function(){location.reload();}).rbClearCache(ISO);}else{location.reload();}}' +
    'function loadAdv(){lazy("advbox","rbAdvanceHtml","adv");}function advGo(v){var b=document.getElementById("advbox");if(!b||!(window.google&&google.script))return;b.innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">⏳ กำลังจัดเวร "+v+"…</div>";google.script.run.withSuccessHandler(function(h){b.innerHTML=h;makeSortable();}).withFailureHandler(function(e){b.innerHTML="<div class=\\"panel\\">"+e.message+"</div>";}).rbAdvanceHtml(v);}' +
    'function advSave(){var v=document.getElementById("view-adv");if(!v)return;var tb=v.querySelector("table.tbl");var di=v.querySelector("input[type=date]");var date=di?di.value:ISO;if(!tb){alert("เลือกวันที่ที่มีไฟลท์ก่อน");return;}var rows=[];[].forEach.call(tb.tBodies[0].rows,function(tr){if(tr.cells.length<13)return;var c=[];for(var i=0;i<7;i++){var ns=[];[].forEach.call(tr.cells[6+i].querySelectorAll(".namepick"),function(x){if(x.value.trim())ns.push(x.value.trim());});c.push(ns.join(", "));}function f(n){return tr.cells[n].innerText.trim().split("\\n")[0];}rows.push([f(0),f(1),f(3),f(4),f(5),c[0],c[1],c[2],c[3],c[4],c[5],c[6]]);});if(!rows.length){alert("ไม่มีไฟลท์ให้บันทึก");return;}if(!(window.google&&google.script)){alert("เปิดผ่าน /exec เพื่อบันทึก");return;}var m=document.getElementById("advsavemsg");if(m)m.innerHTML="⏳ กำลังบันทึก…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="✅ บันทึกแล้ว: <a href=\\""+url+"\\" target=\\"_blank\\">เปิดชีต</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("บันทึกไม่ได้: "+e.message);}).advSaveProposal(date,JSON.stringify(rows));}' +
    'function advExport(){var di=document.querySelector("#view-adv input[type=date]");var date=di?di.value:ISO;if(!(window.google&&google.script)){alert("เปิดผ่าน /exec เพื่อสร้างไฟล์");return;}var m=document.getElementById("advexportmsg");if(m)m.innerHTML="⏳ กำลังสร้างไฟล์แจ้งทีม…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดไฟล์แจ้ง Assignment</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างไฟล์ไม่ได้: "+e.message);}).advExportAssignment(date);}' +
    'function hm2m(s){var m=String(s).match(/(\\d{1,2}):(\\d{2})/);return m?(+m[1]*60+ +m[2]):null;}' +
    'function gapOverlap(raw,f,t){if(!raw)return false;return raw.split(",").some(function(seg){var p=seg.split("~");if(p.length<2)return false;var a=+p[0],b=+p[1];if(isNaN(a)||isNaN(b))return false;function ov(x,y){return x<t&&y>f;}a=((a%1440)+1440)%1440;b=((b%1440)+1440)%1440;if(b===0)b=1440;return a<=b?ov(a,b):(ov(a,1440)||ov(0,b));});}' +
    'function applyFilter(viewId){var v=document.getElementById(viewId);if(!v)return;var sb=v.querySelector(".search"),q=sb?sb.value.toLowerCase():"";var ts=v.querySelector(".teamsel"),team=ts?ts.value:"";var gf=v.querySelector(".gapfrom"),gt=v.querySelector(".gapto");var gfrom=gf&&gf.value?hm2m(gf.value):null,gto=gt&&gt.value?hm2m(gt.value):null;var gOn=(gfrom!=null||gto!=null),gLo=gfrom!=null?gfrom:0,gHi=gto!=null?gto:1440,visN=0;[].forEach.call(v.querySelectorAll("tbody tr"),function(r){var dt=r.getAttribute("data-team")||"";var okT=!team||dt===team||dt.split(",").indexOf(team)>=0;var okQ=!q||r.textContent.toLowerCase().indexOf(q)>=0;var okG=!gOn||gapOverlap(r.getAttribute("data-gaps")||"",gLo,gHi);var show=okT&&okQ&&okG;if(show&&r.getAttribute("data-gaps")!=null&&r.cells.length>1)visN++;r.style.display=show?"":"none";});var gc=v.querySelector(".gapcount");if(gc)gc.textContent=gOn?("· พบ "+visN+" คนว่างช่วงนี้"):"";}' +
    'function clearGap(viewId){var v=document.getElementById(viewId);if(!v)return;var gf=v.querySelector(".gapfrom"),gt=v.querySelector(".gapto");if(gf)gf.value="";if(gt)gt.value="";applyFilter(viewId);}' +
    'function buildExpTeams(){[].forEach.call(document.querySelectorAll("select.expteam"),function(sel){if(sel.options.length>1)return;var v=sel.closest("div[id^=view-]");if(!v)return;var set={};[].forEach.call(v.querySelectorAll(".supchip[data-pteam]"),function(c){var t=c.getAttribute("data-pteam");if(t)set[t]=1;});Object.keys(set).sort().forEach(function(t){var o=document.createElement("option");o.text=t;o.value=t;sel.add(o);});});}' +
    'function fillExport(){expRun("fill","apExportFill");}function autoExport(){expRun("auto","apExportAuto");}' +
    'function expRun(view,fn){var v=document.getElementById("view-"+view);if(!v)return;var sel=v.querySelector(".expteam"),team=sel?sel.value:"";var m=v.querySelector(".expmsg");if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อสร้างไฟล์");return;}if(m)m.innerHTML="⏳ กำลังสร้างไฟล์ชีต…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดไฟล์แจ้ง Assignment"+(team?" ("+team+")":"")+"</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างไฟล์ไม่ได้: "+e.message);})[fn](ISO,team);}' +
    'function fcPick(view){var v=document.getElementById("view-"+view);if(!v||!(window.google&&google.script&&google.script.run))return;var fcBy={};[].forEach.call(v.querySelectorAll(".fcpick"),function(s){fcBy[s.getAttribute("data-code")]=s.value;});var box=view+"box",fn=view==="auto"?"rbAutoAssignHtml":"rbFillPlanHtml";document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:20px;text-align:center\\">⏳ จัดใหม่ตาม Flight Controller…</div>";google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){document.getElementById(box).innerHTML="<div class=\\"panel\\">"+e.message+"</div>";})[fn](ISO,JSON.stringify(fcBy));}' +
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
    'if(CD.otHolH>0){OTL.push("นักขัต ×1");OTC.push("#f97316");}' +
    'new Chart(c3,{type:"bar",data:{labels:OTL,datasets:[{data:CD.otHolH>0?[CD.otPreN,CD.otPostN,CD.otOffN,CD.otHolN]:[CD.otPreN,CD.otPostN,CD.otOffN],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+" คน";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});' +
    'new Chart(c4,{type:"bar",data:{labels:OTL,datasets:[{data:CD.otHolH>0?[CD.otPreH,CD.otPostH,CD.otOffH,CD.otHolH]:[CD.otPreH,CD.otPostH,CD.otOffH],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+"h";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});});' +
    '</script>' + otDashScript_() + '</body></html>';
}

function rbDesignCss_() { return rbDESIGN_CSS_; }
var rbDESIGN_CSS_ = `/* ============================================================================
 * AOTGA Daily Manpower Dashboard — design system
 * Aviation operations aesthetic on the AOTGA corporate identity.
 * Themeable via [data-theme] on <html>: corporate | vibrant | soft
 * ==========================================================================*/

:root {
  /* AOTGA CI */
  --royal: #1D428A;
  --bosch: #236192;
  --sky: #4EC3E0;
  --teal: #3FBCBE;
  --yellow: #FEC909;
  --red: #D92526;
  --grey: #7C878F;

  /* semantic */
  --brand: var(--royal);
  --brand-2: var(--bosch);
  --accent: var(--sky);
  --good: #1BA37A;
  --warn: #E8A400;
  --alert: var(--red);

  /* surfaces */
  --bg: #eef3fa;
  --bg-2: #e3ecf7;
  --card: #ffffff;
  --ink: #15233f;
  --ink-2: #5a6b86;
  --ink-3: #93a1b8;
  --line: #e4ebf4;
  --line-2: #eef2f8;

  --radius: 16px;
  --radius-sm: 11px;
  --radius-lg: 22px;
  --shadow: 0 2px 4px rgba(20,40,80,.04), 0 12px 28px rgba(20,40,80,.07);
  --shadow-sm: 0 1px 2px rgba(20,40,80,.05), 0 4px 12px rgba(20,40,80,.05);
  --shadow-lg: 0 8px 18px rgba(20,40,80,.08), 0 30px 60px rgba(20,40,80,.12);

  --header-grad: linear-gradient(118deg, #16315f 0%, var(--royal) 46%, var(--bosch) 100%);
  --maxw: 1320px;
  --font: 'Kanit', -apple-system, 'Segoe UI', sans-serif;
}

/* ---- Theme: VIBRANT (modern & colorful) ---------------------------------- */
[data-theme="vibrant"] {
  --bg: #eaf1fb;
  --bg-2: #dfeafb;
  --header-grad: linear-gradient(120deg, #1b2a6b 0%, var(--royal) 38%, var(--teal) 100%);
  --shadow: 0 2px 6px rgba(29,66,138,.06), 0 16px 36px rgba(29,66,138,.12);
  --shadow-lg: 0 10px 24px rgba(29,66,138,.12), 0 36px 70px rgba(29,66,138,.18);
}

/* ---- Theme: SOFT (friendly & rounded) ------------------------------------ */
[data-theme="soft"] {
  --bg: #f4f6fb;
  --bg-2: #eef1f8;
  --card: #ffffff;
  --line: #eceff6;
  --radius: 22px;
  --radius-sm: 15px;
  --radius-lg: 28px;
  --header-grad: linear-gradient(125deg, #2a4f97 0%, #3a6fc0 60%, #5aa9d8 100%);
  --shadow: 0 3px 8px rgba(40,60,100,.05), 0 16px 40px rgba(40,60,100,.08);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body { background: var(--bg); }
body {
  font-family: var(--font);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  background:
    radial-gradient(1200px 600px at 85% -10%, rgba(78,195,224,.18), transparent 60%),
    radial-gradient(1000px 500px at -5% 0%, rgba(29,66,138,.10), transparent 55%),
    var(--bg);
}

.wrap { max-width: var(--maxw); margin: 0 auto; padding: 20px 24px 56px; }

/* tabular numerals everywhere numbers matter */
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

/* ============================ HEADER ====================================== */
.appbar {
  position: relative;
  background: var(--header-grad);
  border-radius: var(--radius-lg);
  padding: 20px 28px;
  color: #fff;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}
.appbar::before {
  /* subtle radar / flight-path arcs */
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(520px 520px at 88% -120%, rgba(255,255,255,.14), transparent 60%),
    repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 64px);
  pointer-events: none;
}
.appbar__row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 15px; }
.brand__mark {
  width: 52px; height: 52px; border-radius: 14px;
  background: rgba(255,255,255,.12);
  border: 1.5px solid rgba(255,255,255,.4);
  display: grid; place-items: center; flex: 0 0 auto;
  backdrop-filter: blur(4px);
}
.brand__mark svg { width: 30px; height: 30px; }
.brand h1 { font-size: 21px; font-weight: 800; letter-spacing: .6px; line-height: 1.05; }
.brand h1 span { color: var(--sky); }
.brand p { font-size: 12px; font-weight: 300; color: #cfe1f5; margin-top: 3px; letter-spacing: .2px; white-space: nowrap; }

.appbar__meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.datepill {
  display: flex; flex-direction: column; align-items: flex-end;
  padding-right: 16px; border-right: 1px solid rgba(255,255,255,.22);
}
.datepill .d { font-size: 19px; font-weight: 700; line-height: 1.1; white-space: nowrap; }
.datepill .s { font-size: 11px; color: #cfe1f5; font-weight: 300; white-space: nowrap; }
.livedot { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #d8e8f8; font-weight: 400; }
.livedot i { width: 8px; height: 8px; border-radius: 50%; background: #58e6a0; box-shadow: 0 0 0 0 rgba(88,230,160,.6); animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(88,230,160,.5); } 70% { box-shadow: 0 0 0 7px rgba(88,230,160,0); } 100% { box-shadow: 0 0 0 0 rgba(88,230,160,0); } }

.btn {
  font-family: inherit; cursor: pointer; border: 0; border-radius: 11px;
  padding: 10px 15px; font-size: 13px; font-weight: 600; display: inline-flex;
  align-items: center; gap: 7px; transition: transform .12s ease, box-shadow .12s ease, background .12s;
}
.btn:active { transform: translateY(1px); }
.btn--ghost { background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.28); }
.btn--ghost:hover { background: rgba(255,255,255,.24); }
.btn--accent { background: var(--sky); color: #0c2c45; }
.btn--accent:hover { box-shadow: 0 6px 16px rgba(78,195,224,.4); }

/* ============================ WEEK NAV ==================================== */
.weeknav { display: flex; align-items: center; gap: 12px; margin: 16px 0 18px; }
.weeknav__strip { display: flex; gap: 7px; overflow-x: auto; flex: 1; padding: 3px 1px 6px; scrollbar-width: thin; }
.weeknav__strip::-webkit-scrollbar { height: 5px; }
.weeknav__strip::-webkit-scrollbar-thumb { background: #c7d4e6; border-radius: 4px; }
.wk {
  flex: 0 0 auto; min-width: 50px; text-align: center; cursor: pointer;
  background: var(--card); border: 1px solid var(--line); border-radius: 13px;
  padding: 7px 6px 8px; line-height: 1.1; transition: all .14s ease; user-select: none;
}
.wk:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-sm); }
.wk .wd { display: block; font-size: 9.5px; color: var(--ink-3); font-weight: 500; letter-spacing: .4px; }
.wk .wn { display: block; font-size: 18px; font-weight: 700; color: var(--ink); }
.wk .wm { display: block; font-size: 9px; color: var(--ink-3); font-weight: 400; }
.wk.sel { background: var(--brand); border-color: var(--brand); box-shadow: 0 8px 18px rgba(29,66,138,.28); }
.wk.sel .wd, .wk.sel .wm { color: #bcd2ef; }
.wk.sel .wn { color: #fff; }
.wk.today:not(.sel) { border-color: var(--accent); }
.wk.today:not(.sel) .wn { color: var(--brand); }
.weeknav__date { display: flex; align-items: center; gap: 8px; }
.weeknav__date input {
  font-family: inherit; background: var(--card); border: 1px solid var(--line);
  color: var(--ink); border-radius: 11px; padding: 9px 11px; font-size: 13px; font-weight: 500;
}
.iconbtn {
  width: 38px; height: 38px; flex: 0 0 auto; border-radius: 11px; border: 1px solid var(--line);
  background: var(--card); color: var(--brand); cursor: pointer; display: grid; place-items: center;
  font-size: 16px; transition: all .14s;
}
.iconbtn:hover { border-color: var(--accent); color: var(--accent); }

/* ============================ TABS ======================================== */
.tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.tab {
  font-family: inherit; cursor: pointer; background: var(--card); border: 1px solid var(--line);
  color: var(--ink-2); border-radius: 13px; padding: 11px 18px; font-weight: 600; font-size: 14px;
  display: inline-flex; align-items: center; gap: 9px; transition: all .15s ease;
}
.tab svg { width: 17px; height: 17px; }
.tab:hover { color: var(--brand); border-color: #cdd9ec; }
.tab.active { background: var(--brand); color: #fff; border-color: var(--brand); box-shadow: 0 8px 18px rgba(29,66,138,.24); }
.tab .badge {
  font-size: 11px; font-weight: 700; background: rgba(255,255,255,.22); color: #fff;
  border-radius: 20px; padding: 1px 8px; min-width: 20px; text-align: center;
}
.tab:not(.active) .badge { background: #fdeaea; color: var(--red); }

/* ============================ KPI HERO ==================================== */
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi {
  position: relative; background: var(--card); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 16px 16px 15px; box-shadow: var(--shadow-sm);
  overflow: hidden; transition: transform .16s ease, box-shadow .16s ease;
}
.kpi:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.kpi::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--c); }
.kpi__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
.kpi__ico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--c) 14%, white); color: var(--c); }
.kpi__ico svg { width: 19px; height: 19px; }
.kpi__trend { font-size: 11px; font-weight: 600; color: var(--ink-3); display: inline-flex; align-items: center; gap: 3px; }
.kpi__trend.up { color: var(--good); }
.kpi__trend.down { color: var(--alert); }
.kpi__val { font-size: 34px; font-weight: 800; color: var(--ink); line-height: 1; letter-spacing: -.5px; }
.kpi__val small { font-size: 15px; font-weight: 600; color: var(--ink-3); margin-left: 2px; }
.kpi__lbl { font-size: 12.5px; color: var(--ink-2); font-weight: 500; margin-top: 5px; }
.kpi__sub { font-size: 11px; color: var(--ink-3); margin-top: 2px; }

/* primary attendance band */
.attband {
  display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 14px; margin-bottom: 16px;
}
.panel {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 18px 20px; box-shadow: var(--shadow-sm);
}
.panel--brand { background: var(--header-grad); color: #fff; border: 0; box-shadow: var(--shadow); position: relative; overflow: hidden; }
.panel--brand::before { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 54px); }
.panel h3 { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.panel--brand h3 { color: #cfe1f5; }
.panel__hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.panel__hd h3 { margin-bottom: 0; }

/* attendance ring */
.attring { position: relative; display: flex; align-items: center; gap: 18px; }
.ring { position: relative; width: 132px; height: 132px; flex: 0 0 auto; }
.ring__center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.ring__center .big { font-size: 30px; font-weight: 800; line-height: 1; color: #fff; }
.ring__center .lbl { font-size: 10.5px; color: #cfe1f5; margin-top: 3px; }
.attlegend { display: flex; flex-direction: column; gap: 9px; flex: 1; }
.leg { display: flex; align-items: center; gap: 9px; font-size: 13px; }
.leg i { width: 11px; height: 11px; border-radius: 4px; flex: 0 0 auto; }
.leg .lk { color: #d6e4f5; font-weight: 300; flex: 1; }
.leg .lv { font-weight: 700; font-size: 15px; }

/* mini stat list */
.statlist { display: flex; flex-direction: column; gap: 12px; }
.statrow { display: flex; align-items: center; gap: 12px; }
.statrow__ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--c) 13%, white); color: var(--c); flex: 0 0 auto; }
.statrow__ico svg { width: 18px; height: 18px; }
.statrow__t { flex: 1; }
.statrow__t .k { font-size: 12px; color: var(--ink-2); font-weight: 500; }
.statrow__t .v { font-size: 19px; font-weight: 800; color: var(--ink); line-height: 1.1; }
.statrow__t .v small { font-size: 12px; color: var(--ink-3); font-weight: 600; }

/* OT split mini bars */
.otsplit { display: flex; flex-direction: column; gap: 13px; }
.otrow .otrow__top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
.otrow .otrow__top .k { font-size: 12.5px; font-weight: 500; color: var(--ink-2); }
.otrow .otrow__top .v { font-size: 13px; font-weight: 700; color: var(--ink); white-space: nowrap; padding-left: 10px; }
.otrow .otrow__top .v small { color: var(--ink-3); font-weight: 500; }
.track { height: 9px; background: var(--line-2); border-radius: 6px; overflow: hidden; }
.track > i { display: block; height: 100%; border-radius: 6px; }

/* ============================ GRID ======================================= */
.grid { display: grid; gap: 16px; }
.grid--2 { grid-template-columns: 1.35fr 1fr; }
.grid--charts { grid-template-columns: 1.4fr 1fr; margin-bottom: 16px; }

/* ============================ CHARTS ===================================== */
.barchart { display: flex; flex-direction: column; gap: 11px; }
.barchart__row { display: grid; grid-template-columns: 116px 1fr 46px; align-items: center; gap: 12px; }
.barchart__lbl { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ink); }
.barchart__lbl .tag { font-size: 10px; font-weight: 700; color: #fff; background: var(--brand); border-radius: 6px; padding: 1px 7px; letter-spacing: .3px; }
.barchart__bar { position: relative; height: 24px; background: var(--line-2); border-radius: 8px; overflow: hidden; }
.barchart__fill { position: relative; z-index: 1; height: 100%; border-radius: 8px; background: linear-gradient(90deg, var(--teal), var(--sky)); display: flex; align-items: center; transition: width .9s cubic-bezier(.2,.8,.2,1); }
.barchart__ghost { position: absolute; inset: 0; z-index: 0; }
.barchart__val { font-size: 13px; font-weight: 700; color: var(--ink); text-align: right; }
.barchart__val small { color: var(--ink-3); font-weight: 500; }

.donut-wrap { display: flex; align-items: center; gap: 20px; }
.donut { width: 150px; height: 150px; flex: 0 0 auto; }
.donut-legend { display: flex; flex-direction: column; gap: 11px; flex: 1; }

/* ============================ TABLES ===================================== */
.tablecard { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-sm); overflow: hidden; }
.teamsel { font-family: inherit; font-size: 13px; font-weight: 600; color: var(--ink); padding: 7px 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--card); cursor: pointer; margin-left: 8px; }
.tablecard__hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 16px 20px 13px; }
.tablecard__hd h3 { font-size: 14.5px; font-weight: 700; color: var(--brand); display: flex; align-items: center; gap: 9px; }
.tablecard__hd .pill { font-size: 11px; font-weight: 600; color: var(--ink-2); background: var(--bg-2); border-radius: 20px; padding: 3px 11px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: right; color: var(--ink-3); font-weight: 600; font-size: 10.5px; letter-spacing: .4px; text-transform: uppercase; padding: 8px 12px; background: var(--bg-2); }
.tbl th:first-child { text-align: left; }
.tbl td { text-align: right; padding: 9px 12px; border-bottom: 1px solid var(--line-2); color: var(--ink); }
.tbl td:first-child { text-align: left; }
.tbl tbody tr:last-child td { border-bottom: 0; }
.tbl tbody tr:hover td { background: color-mix(in srgb, var(--accent) 7%, white); }
.tbl tr.total td { background: color-mix(in srgb, var(--brand) 6%, white); font-weight: 700; border-top: 2px solid var(--line); }
.tbl .nm { font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 9px; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.tag {
  display: inline-flex; align-items: center; justify-content: center; min-width: 34px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .4px; color: #fff;
  background: var(--brand); border-radius: 6px; padding: 2px 8px;
}
.muted { color: var(--ink-3); font-weight: 400; }
.b { font-weight: 700; }

/* mini progress in cells */
.cellbar { position: relative; height: 18px; background: var(--line-2); border-radius: 6px; overflow: hidden; min-width: 90px; }
.cellbar > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; background: linear-gradient(90deg, var(--teal), var(--sky)); }
.cellbar > span { position: absolute; right: 7px; top: 0; line-height: 18px; font-size: 11px; font-weight: 700; color: var(--brand); }

/* ot mini cell */
.otcell { font-weight: 700; }
.otcell small { color: var(--ink-3); font-weight: 500; font-size: 11px; }
.otcell.pre { color: var(--warn); }
.otcell.post { color: var(--royal); }

/* ============================ TIMETABLE ================================== */
.ttbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.search { position: relative; flex: 1; min-width: 200px; }
.search input { width: 100%; font-family: inherit; border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px 11px 38px; font-size: 13.5px; background: var(--card); color: var(--ink); }
.search input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 50%, white); border-color: var(--accent); }
.search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 17px; height: 17px; color: var(--ink-3); }
.chipgroup { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-start; }
.tbl td .chipgroup { min-width: 320px; }
.chip { display: inline-block; line-height: 1.35; font-family: inherit; cursor: pointer; font-size: 11px; font-weight: 600; padding: 4px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); transition: all .13s; white-space: normal; }
.chip:hover { border-color: var(--accent); }
.chip--duty { background: var(--bg-2); color: var(--ink-3); border-style: dashed; }
.chip--sup { background: #fff3e0; color: #b45309; border-color: #f0a64a; }
.planchip .editnm { display: inline-block; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; min-width: 22px; padding: 0 2px; border-bottom: 1px dashed var(--accent); outline: none; cursor: text; font-weight: 700; color: var(--ink-2); }
.planchip .editnm:focus { max-width: none; overflow: visible; background: #fff7d6; border-bottom-color: #d9a400; border-radius: 3px; }
.planchip.edited { background: #fff7d6; border-color: #d9a400; }
.planchip__i { cursor: pointer; color: var(--ink-3); font-weight: 600; }
.planchip__i:hover { color: var(--accent); }
.pickwrap { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.namepick { font-family: inherit; font-size: 9.5px; font-weight: 600; padding: 2px 3px; border-radius: 5px; border: 1px solid var(--line); background: var(--bg-2); color: var(--ink-2); width: 96px; max-width: 96px; cursor: pointer; }
.namepick:focus { outline: none; border-color: var(--accent); background: #fff; }
#view-adv .tbl th, #view-adv .tbl td { padding: 5px 5px; font-size: 10.5px; }
#view-adv .tbl thead th { position: sticky; top: 0; z-index: 2; font-size: 9.5px; }
#view-sup .namepick { width: 210px; max-width: 210px; font-size: 11px; padding: 3px 6px; }
#view-sup .pickwrap { gap: 3px; }
.namepick.edited { background: #fff7d6; border-color: #d9a400; }
.supbar { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 10px 0 4px; font-size: 13px; }
.supteam { font-family: inherit; font-size: 12px; font-weight: 700; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--ink-3); cursor: pointer; }
.supteam.on { background: var(--brand); color: #fff; border-color: var(--brand); }
.supteam.supall { background: var(--bg-2); color: var(--ink); }
.supgrp { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0 10px 6px 0; padding: 3px 4px 3px 0; }
.supgrp__t { font-size: 11px; font-weight: 800; color: var(--brand); background: var(--bg-2); border-radius: 7px; padding: 3px 8px; margin-right: 4px; white-space: nowrap; }
.supwrap { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px 10px; max-width: 760px; }
.supchip { font-size: 10.5px; padding: 3px 7px; white-space: nowrap; cursor: pointer; }
.supchip:hover { border-color: var(--accent); background: #eef4fb; }
.supchip.sup--busy { border-color: #e0a96d; }
.supchip.sup--free { border-color: #56b682; }
.supchip.sup--sub { background: #fdf2e3; border: 1px dashed #e0a96d; color: #9a5b1a; }
.supchip.sup--sub::before { content: "↪ "; font-weight: 700; }
.psnpop { position: absolute; z-index: 9999; width: 350px; max-width: 92vw; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 34px rgba(20,40,80,.22); padding: 13px 15px; font-size: 13px; }
.psn__hd { display: flex; align-items: center; gap: 6px; font-size: 14px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line-2); }
.psn__x { margin-left: auto; cursor: pointer; color: var(--ink-3); font-weight: 700; padding: 0 4px; }
.psn__r { margin: 4px 0; }
.psn__flts { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.psn__flts .chip { font-size: 10.5px; padding: 3px 7px; }
.tbl tbody tr.row-off td { background: #eceff1 !important; color: #7c878f; }
.tbl tbody tr.row-sl  td { background: #f8d7da !important; color: #b3261e; font-weight: 600; }
.tbl tbody tr.row-vac td { background: #fff3cd !important; color: #7a5b00; }
.chip.on { background: var(--brand); color: #fff; border-color: var(--brand); }

.ttgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 13px; }
.ttcard { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 15px 16px; box-shadow: var(--shadow-sm); transition: transform .14s, box-shadow .14s; }
.ttcard:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.ttcard__hd { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
.avatar { width: 40px; height: 40px; border-radius: 12px; flex: 0 0 auto; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 15px; background: linear-gradient(135deg, var(--royal), var(--bosch)); }
.ttcard__id { flex: 1; min-width: 0; }
.ttcard__id .nm { font-size: 14.5px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttcard__id .meta { font-size: 11.5px; color: var(--ink-3); display: flex; align-items: center; gap: 7px; margin-top: 1px; }
.shiftbadge { text-align: right; flex: 0 0 auto; }
.shiftbadge .code { font-size: 13px; font-weight: 800; color: var(--brand); }
.shiftbadge .time { font-size: 11px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.ttcard__ot { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 8px; margin-bottom: 11px; }
.ttcard__ot.pre { background: #fff6e0; color: #9a6b00; }
.ttcard__ot.post { background: #e9f0fb; color: var(--royal); }
.ttcard__ot.off { background: #fdeaea; color: var(--red); }
.fstrip { display: flex; flex-direction: column; gap: 7px; }
.fstrip__item { display: flex; align-items: center; gap: 8px; background: var(--bg-2); border-radius: 10px; padding: 7px 10px; }
.fstrip__no { font-size: 12.5px; font-weight: 800; color: var(--brand); min-width: 52px; flex: 0 0 auto; }
.fstrip__task { font-size: 10px; font-weight: 700; color: #fff; background: var(--teal); border-radius: 6px; padding: 2px 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 92px; flex: 0 1 auto; }
.fstrip__time { margin-left: auto; font-size: 11px; color: var(--ink-2); font-variant-numeric: tabular-nums; text-align: right; flex: 0 0 auto; white-space: nowrap; }
.fstrip__time .lab { font-size: 8.5px; font-weight: 700; color: var(--ink-3); letter-spacing: .3px; display: block; }
.ttcard__empty { font-size: 12px; color: var(--ink-3); font-style: italic; padding: 6px 0; }

/* ============================ FLIGHTS / SLA ============================== */
.slabar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
.slasum { display: flex; gap: 10px; }
.slasum .pill { display: flex; align-items: center; gap: 8px; padding: 9px 15px; border-radius: 12px; font-size: 13px; font-weight: 600; background: var(--card); border: 1px solid var(--line); box-shadow: var(--shadow-sm); }
.slasum .pill b { font-size: 17px; font-weight: 800; }
.slasum .pill.ok b { color: var(--good); }
.slasum .pill.bad b { color: var(--alert); }

.fltlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 14px; }
.boarding {
  position: relative; display: flex; background: var(--card); border: 1px solid var(--line);
  border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); transition: transform .14s, box-shadow .14s;
}
.boarding:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.boarding.short { border-color: #f3c9c9; }
.boarding__stub {
  width: 92px; flex: 0 0 auto; background: var(--header-grad); color: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 14px 8px; position: relative;
}
.boarding.short .boarding__stub { background: linear-gradient(160deg, #b3201f, var(--red)); }
.boarding__stub .ac { font-size: 22px; font-weight: 800; letter-spacing: 1px; }
.boarding__stub .acn { font-size: 8.5px; color: rgba(255,255,255,.8); text-align: center; margin-top: 3px; line-height: 1.2; font-weight: 300; }
.boarding__perf { position: absolute; right: -7px; top: 0; bottom: 0; width: 14px; background:
  radial-gradient(circle at center, var(--bg) 0 5px, transparent 5px) repeat-y; background-size: 14px 18px; }
.boarding__body { flex: 1; padding: 13px 16px 14px; min-width: 0; }
.boarding__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 11px; }
.boarding__fl { font-size: 18px; font-weight: 800; color: var(--ink); letter-spacing: .5px; }
.boarding__fl small { display: block; font-size: 11px; font-weight: 400; color: var(--ink-3); }
.boarding__times { text-align: right; font-size: 11px; color: var(--ink-2); }
.boarding__times .t { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink); font-size: 13px; }
.slastatus { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }
.slastatus.ok { background: #e3f6ee; color: var(--good); }
.slastatus.bad { background: #fdeaea; color: var(--red); }
.phases { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.phase { text-align: center; background: var(--bg-2); border-radius: 10px; padding: 8px 4px; }
.phase.short { background: #fdecec; }
.phase .pl { font-size: 9.5px; font-weight: 700; color: var(--ink-3); letter-spacing: .4px; text-transform: uppercase; }
.phase .pv { font-size: 16px; font-weight: 800; color: var(--ink); margin-top: 2px; font-variant-numeric: tabular-nums; }
.phase.short .pv { color: var(--red); }
.phase .pv span { font-size: 11px; color: var(--ink-3); font-weight: 600; }
.phase .pd { font-size: 9.5px; font-weight: 700; margin-top: 1px; }
.phase.short .pd { color: var(--red); }
.phase.full .pd { color: var(--good); }

/* ============================ FOOT ====================================== */
.foot { margin-top: 26px; text-align: center; color: var(--ink-3); font-size: 11.5px; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
.foot b { color: var(--ink-2); font-weight: 600; }

.sectionlabel { font-size: 12px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--ink-3); margin: 22px 2px 12px; display: flex; align-items: center; gap: 10px; }
.sectionlabel::after { content: ""; flex: 1; height: 1px; background: var(--line); }

/* ============================ RESPONSIVE ================================= */
@media (max-width: 1080px) {
  .kpis { grid-template-columns: repeat(3, 1fr); }
  .attband { grid-template-columns: 1fr 1fr; }
  .attband > :first-child { grid-column: 1 / -1; }
  .grid--2, .grid--charts { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .wrap { padding: 14px 14px 44px; }
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .attband { grid-template-columns: 1fr; }
  .brand h1 { font-size: 18px; }
  .kpi__val { font-size: 28px; }
  .fltlist, .ttgrid { grid-template-columns: 1fr; }
}

/* reveal animation (transform-only so content is never hidden if a frame freezes) */
@keyframes rise { from { transform: translateY(9px); } to { transform: none; } }
.rise { animation: rise .5s cubic-bezier(.2,.8,.2,1) both; }

/* Tweak: flat cards */
body.flat .kpi, body.flat .panel, body.flat .tablecard, body.flat .ttcard,
body.flat .boarding, body.flat .wk, body.flat .tab, body.flat .slasum .pill {
  box-shadow: none !important;
  border-color: #d4deec;
}
body.flat .panel--brand { border: 1px solid rgba(255,255,255,.2); }

/* Tweak: disable entrance motion */
body.nomotion .rise { animation: none; }

/* server-rendered additions */
canvas{max-width:100%}
.tbl td .barmini{position:relative;height:16px;background:var(--line-2);border-radius:8px;overflow:hidden;min-width:70px}
.tbl td .barmini i{position:absolute;inset:0;background:linear-gradient(90deg,var(--teal),var(--sky));border-radius:8px}
.tbl td .barmini b{position:absolute;right:6px;top:0;line-height:16px;font-size:10px;color:var(--royal);font-weight:700}
.okk{color:var(--good);font-weight:700}.badd{color:var(--red);font-weight:700}
tr.rowbad td{background:#fdecec}
.muted{color:var(--ink-3)}
/* ============ UI REFRESH · modern + corporate (PWMS) ====================== */
:root{
  --bg:#f4f7fc; --bg-2:#eaf1f9; --line:#e6edf7; --line-2:#eef3fa;
  --shadow-sm:0 1px 2px rgba(18,38,76,.04),0 6px 16px rgba(18,38,76,.05);
  --shadow:0 2px 8px rgba(18,38,76,.05),0 18px 40px rgba(18,38,76,.08);
}
body{ -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
/* cards */
.tablecard,.panel,.kpi,.ttcard{ border-radius:18px; }
.tablecard{ transition:box-shadow .18s ease; }
.tablecard:hover{ box-shadow:var(--shadow); }
.tablecard__hd{ border-bottom:1px solid var(--line-2); padding-bottom:12px; }
.tablecard__hd h3{ font-size:15px; letter-spacing:.1px; }
/* tables */
.tbl th{ font-size:11px; background:#eef3fb; }
.tbl tbody tr{ transition:background .12s ease; }
.tbl tbody tr:hover td{ background:color-mix(in srgb,var(--accent) 9%, white); }
/* tabs (pill + active glow) */
.tabs{ gap:7px; }
.tab{ border-radius:11px; padding:10px 16px; font-size:13.5px; box-shadow:var(--shadow-sm); }
.tab:hover{ transform:translateY(-1px); }
.tab.active{ box-shadow:0 7px 18px rgba(29,66,138,.28); }
/* inputs/buttons */
.search input{ border-radius:11px; transition:border-color .15s, box-shadow .15s; }
.btn--accent{ box-shadow:0 6px 16px rgba(29,66,138,.20); }
/* --- responsive: tablet/มือถือ --- */
@media (max-width:860px){
  .wrap{ padding:12px 12px 40px; }
  .appbar{ flex-wrap:wrap; gap:10px; padding:14px 16px; }
  .tabs{ flex-wrap:nowrap; overflow-x:auto; -webkit-overflow-scrolling:touch; padding-bottom:5px; scrollbar-width:thin; }
  .tab{ flex:0 0 auto; padding:9px 13px; font-size:13px; }
  .tablecard__hd{ padding:13px 14px 11px; }
  .tbl{ font-size:12px; }
  .tbl th,.tbl td{ padding:8px 9px; }
  .planchip .editnm{ max-width:78px; }
  .tablecard__hd h3{ font-size:14px; }
}
@media (max-width:520px){
  .kpis{ grid-template-columns:1fr 1fr; }
  .brand h1{ font-size:17px; }
  .brand p{ font-size:11px; }
  .tab{ padding:8px 11px; font-size:12.5px; }
  .planchip .editnm{ max-width:66px; }
}
/* ===== UI REFRESH · phase 2 (header + segmented tabs + rhythm) =========== */
:root{ --header-grad:linear-gradient(120deg,#10254a 0%,#1D428A 54%,#236192 100%); }
.appbar{ box-shadow:0 12px 34px rgba(16,37,74,.20); }
.appbar::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:3px; background:linear-gradient(90deg,var(--sky),var(--teal)); }
.brand__mark{ border-radius:13px; }
/* โลโก้ AOTGA (วางบนชิปขาวเพื่อให้ตัวอักษรน้ำเงินอ่านออกบนหัวเว็บเข้ม) */
.brand__logo{ height:42px; width:auto; max-width:230px; background:#fff; padding:5px 11px; border-radius:12px; box-shadow:0 5px 14px rgba(0,0,0,.18); object-fit:contain; }
.foot__logo{ height:46px; width:auto; display:block; margin:0; }
/* หน้าต่างคู่มือ (ℹ️ ช่วยเหลือ) */
.helpov{ position:fixed; inset:0; z-index:9999; background:rgba(16,37,74,.45); backdrop-filter:blur(2px); display:flex; align-items:flex-start; justify-content:center; padding:5vh 16px; }
.helpbox{ background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:0 24px 60px rgba(16,37,74,.35); width:100%; max-width:720px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; }
.helpbox__hd{ display:flex; align-items:center; justify-content:space-between; padding:15px 20px; background:var(--header-grad); color:#fff; }
.helpbox__hd h3{ margin:0; font-size:16px; }
.helpx{ background:rgba(255,255,255,.18); color:#fff; border:0; width:30px; height:30px; border-radius:9px; cursor:pointer; font-size:15px; }
.helpx:hover{ background:rgba(255,255,255,.32); }
.helpbox__bd{ padding:18px 22px; overflow-y:auto; font-size:13.5px; line-height:1.6; color:var(--ink-2); }
.helpbox__bd h4{ margin:18px 0 7px; font-size:14px; color:var(--brand); border-top:1px solid var(--line); padding-top:14px; }
.helpbox__bd h4:first-of-type{ border-top:0; padding-top:0; }
.helpul{ margin:4px 0 4px 2px; padding-left:18px; }
.helpul li{ margin:3px 0; }
.helpbox__bd code{ background:var(--bg-2); border:1px solid var(--line); border-radius:6px; padding:1px 6px; font-size:12px; }
.helptb{ width:100%; border-collapse:collapse; margin:6px 0; font-size:12.5px; }
.helptb th,.helptb td{ border:1px solid var(--line); padding:4px 8px; text-align:center; }
.helptb th{ background:#eef3fb; }
.helptb td:first-child{ font-weight:600; }
@media (max-width:520px){ .brand__logo{ height:34px; max-width:170px; } }
/* เมนูแท็บแบบ segmented control */
.tabs{ background:var(--card); border:1px solid var(--line); padding:6px; border-radius:16px; box-shadow:var(--shadow-sm); }
.tab{ background:transparent; border:0; box-shadow:none; border-radius:11px; }
.tab:hover{ background:var(--bg-2); transform:none; color:var(--brand); }
.tab.active{ background:var(--brand); color:#fff; box-shadow:0 4px 12px rgba(29,66,138,.30); }
/* ระยะห่าง/จังหวะ */
.tablecard{ margin-bottom:16px; }
@media (max-width:860px){ .tabs{ border-radius:13px; padding:5px; } }
@media print{.weeknav,.tabs,.btn,.ttbar{display:none}#view-tt,#view-flt,#view-dash{display:block!important}}
`;

