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

var SKIP_SHEETS_RR = ['MANPOWER', 'ROSTER', 'SUMMARY', 'MASTER SMART SHIFT', 'SHIFTDB', 'CODE', 'SUPPORT REQUEST', 'แม่แบบ', '_CODES'];
/** ทีม "ภายนอก" (ไม่ใช่ HC ของ HKT): พนักงาน BKK มาช่วยชั่วคราว · Outsource — นับรวมหัว/ชม. แต่ติดป้ายแยก */
function rrIsExternalTeam_(team) { return /\bBKK\b|OUTSOURCE|\bOUT\s?SRC\b|\bOS\b/i.test(String(team || '')); }

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
  if (core.indexOf('VAC') === 0 || core === 'BL' || core === 'AL' || core === 'VL' || core === 'ML' || core === 'PL' || core === 'VACATION') return 'vac';
  if (core.indexOf('OT OFF') === 0 || core.indexOf('OT-OFF') === 0) return 'ot_off';
  if (core.indexOf('ONDUTY') === 0 || core.indexOf('ON DUTY') === 0) return 'working';
  if (core.indexOf('OFF') === 0 || core === 'X') return 'off';
  if (core === '') {                                       // no REMARK -> use shift
    if (sh.indexOf('VAC') >= 0 || sh === 'BL' || sh === 'VL' || sh === 'ML' || sh === 'PL' || sh === 'AL') return 'vac';
    if (sh === 'SL' || sh === 'SICK' || sh === 'MC') return 'sick';
    if (sh === '' || sh === 'X' || sh === 'XX' || sh === 'OFF' || sh === '-'
        || sh.indexOf('OFF') === 0) return 'off';
    return 'working';
  }
  return 'working';
}

// ─── สร้างไฟล์ชีต + แชร์ให้ Duty / Asst Mgr อัตโนมัติ ───────────────────────
// ทุกไฟล์ชีตที่ระบบสร้าง (export ต่าง ๆ) จะถูกแชร์ให้อีเมลเหล่านี้เป็น editor โดยอัตโนมัติ
var RB_SHARE_EMAILS = ['dutyhkt@aotga.com', 'asst-mgr@aotga.com'];
/** สร้าง Spreadsheet ใหม่ แล้วแชร์ให้อีเมลที่กำหนด (ไม่ให้ error เรื่องแชร์มาทำให้ export ล้ม) */
function rbCreateSheet_(title) {
  var ss = SpreadsheetApp.create(title);
  try {
    var file = DriveApp.getFileById(ss.getId());
    RB_SHARE_EMAILS.forEach(function (em) {
      try { file.addEditor(em); } catch (e1) {}                 // อีเมลไม่ถูกต้อง/แชร์ไม่ได้ → ข้าม ไม่ให้กระทบไฟล์
    });
  } catch (e0) {}
  return ss;
}

// ─── time / OT helpers ──────────────────────────────────────────────────────
function rrTimePair_(s) {
  var m = rrClean_(s).match(/(\d{1,2})[:.]?(\d{2})/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}
/** "0820" / "925" → "08:20" / "09:25" */
function rrHHMM_(s) { var m = String(s || '').match(/(\d{1,2})(\d{2})$/); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; }
/** ทีม PRIVATE/LP รูปแบบใหม่: บล็อก "LP MORNING (A:0500 D:1500)" / "LP AFTERNOON (A:1400 D:2400)"
 *  อยู่แถวเหนือหัว ID · หัวคอลัมน์เป็น "Job 1-4" (ซ้ำ 2 ชุด) → จับช่วงคอลัมน์ + เวลาของแต่ละโซน
 *  คืน [{c0,c1,label,sta,std}] (ว่าง = ไม่ใช่ layout LP) */
function rrLpZones_(rows, hi, fltStart) {
  var zones = [];
  for (var up = 1; up <= 4 && hi - up >= 0; up++) {
    var hr = rows[hi - up]; if (!hr) continue;
    var found = [];
    for (var c = fltStart; c < hr.length; c++) {
      var lbl = rrClean_(hr[c]); if (!lbl) continue;
      var m = lbl.toUpperCase().match(/(MORNING|AFTERNOON|EVENING|NIGHT)/);
      if (m) found.push({ c: c, label: (/\bLP\b/i.test(lbl) ? 'LP ' : '') + m[1] });
    }
    if (!found.length) continue;
    for (var i = 0; i < found.length; i++) {
      var c0 = found[i].c, c1 = (i + 1 < found.length) ? found[i + 1].c : hr.length;
      var sta = '', std = '';
      for (var dr = hi - up; dr < hi; dr++) {                 // หา A:/D: ในแถวป้ายและแถวใต้ลงมา ช่วง c0..c1
        var drow = rows[dr] || [];
        for (var cc = c0; cc < c1 && cc < drow.length; cc++) {
          var sc = rrClean_(drow[cc]);
          var mA = sc.match(/A\s*:?\s*(\d{1,2})[:.]?(\d{2})/i); if (mA && !sta) sta = ('0' + mA[1]).slice(-2) + ':' + mA[2];
          var mD = sc.match(/D\s*:?\s*(\d{1,2})[:.]?(\d{2})/i); if (mD && !std) std = ('0' + mD[1]).slice(-2) + ':' + mD[2];
        }
      }
      zones.push({ c0: c0, c1: c1, label: found[i].label, sta: sta, std: std });
    }
    break;                                                   // เจอแถวป้ายโซนแล้ว หยุด
  }
  return zones;
}

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
      var tm = t.replace(/^[-–]+/, '');   // ตัดขีดคั่นนำหน้า เช่น "- 1405/1445" หรือ "-1405/1445"
      if (flight && !times && /^\d{3,4}[\/-]\d{3,4}$/.test(tm)) { times = tm; continue; }
      if (!flight && /^[A-Za-z][A-Za-z/().-]*$/.test(t)) role.push(t.toUpperCase());   // คำบทบาทก่อนรหัสไฟลท์ (ARR/GATE…)
    }
    if (!flight || !acIsFlight_(flight)) return;     // ไม่มีรหัสไฟลท์ = ไม่ใช่จ็อบไฟลท์ (training/standby) → ข้าม
    var sta = '', std = '';
    if (times) { var p = times.split(/[\/-]/); sta = rrHHMM_(p[0]); std = rrHHMM_(p[1]); }
    out.push({ flight: flight, task: role.join(' '), STA: sta, STD: std, OP: '', CL: '' });
  });
  return out;
}
/** แถวซัพพอร์ต (ทีมรับใส่คนช่วยจากทีมอื่น): รหัสทีมต้นสังกัดต่อท้ายชื่อ
 *  รองรับ 2 รูปแบบ: "TANADON PVT" (เว้นวรรค) และ "THADASAK (WY)" / "PREEDA(ZF)" (วงเล็บ)
 *  → {name:'TANADON', team:'PVT'} */
function rrSupportTeam_(name) {
  var s = String(name || '').trim();
  // รูปแบบวงเล็บ "ชื่อ (WY)" — รหัสทีมในวงเล็บท้ายชื่อ
  var mp = s.match(/^(.*\S)\s*\(\s*([A-Za-z][A-Za-z0-9]{1,4})\s*\)\s*$/);
  if (mp) return { team: mp[2].toUpperCase(), name: mp[1].trim() };
  var toks = s.split(/\s+/);
  if (toks.length >= 2) {
    var last = toks[toks.length - 1].replace(/[()]/g, '');   // เผื่อวงเล็บติดมากับ token สุดท้าย
    if (/^[A-Z0-9]{2,5}$/.test(last) && /[A-Z]/.test(last)) return { team: last.toUpperCase(), name: toks.slice(0, -1).join(' ') };
  }
  return { team: '', name: s };
}
/** task ที่เป็นการอบรม/ประชุม (ไม่ใช่งานไฟลท์) → ไปเทรน ไม่ได้คุมไฟลท์ */
function rrIsTrainingTask_(task) {
  // กิจกรรมที่ "ไม่ใช่การทำไฟลท์" → แสดงเป็นกิจกรรม ไม่นับเป็นคนคุมไฟลท์
  // TRAIN (ครอบ TRAINING + ตัวย่อ "TRAIN LC HB") · อบรม/สัมมนา/ประชุม (ไทย) · กิจกรรม (เข้าวัด ฯลฯ) · RESIGN/ลาออก
  // ระวัง: ห้ามจับ MONITOR (= Gate Monitor เป็นงานไฟลท์จริง)
  return /\bTRAIN|LOAD CONTROL|IN.?HOUSE|MEETING|E-?LEARN|SEMINAR|MANDATORY|\bCOURSE\b|WORKSHOP|RESIGN|อบรม|สัมมนา|ประชุม|กิจกรรม|ลาออก/i.test(String(task || ''));
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
  if (rng[0] != null && rng[1] != null && rng[0] === rng[1]) rng = [null, null];   // IN==OUT (เช่น 00:00-00:00 placeholder) = ไม่มี OT จริง (กันคิดเป็น 24 ชม.)
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

  // ตรวจคอลัมน์ "งานซัพพอร์ตข้ามทีม" แบบไม่มีหัวคอลัมน์ SUPPORT (เช่น PVT คอลัมน์ O หลัง REMARK)
  // ข้อความรูปแบบ "ARR AK818/819 0805/0840" / "GATE SU660/661 STA/STD : 0925/1055" → อ่านเป็น assignment ไฟลท์
  if (cm.jobtext < 0 && cm.remark >= 0) {
    var supRole = /\b(ARR|GATE|GA|CREW|CRW|TRANSFER|TF|CI|CHECK|SUPP?ORT|STBY|SD)\b/i;
    var supFlt = /(?:[A-Z]{1,3}|\d[A-Z])\s?\d{2,4}\s?\/\s?\d{2,4}|(?:[A-Z]{1,3}|\d[A-Z])\d{2,4}/;
    var loC = cm.remark + 1, hiC = (cm.flt > 0 ? cm.flt - 1 : (rows[hi] ? rows[hi].length : 0));
    var bestC = -1, bestN = 0;
    for (var sc = loC; sc < hiC; sc++) {
      var nMatch = 0;
      for (var rr = hi + 1; rr < rows.length; rr++) {
        var sv = rows[rr] ? String(rows[rr][sc] || '') : '';
        if (sv && supRole.test(sv) && supFlt.test(sv)) nMatch++;
      }
      if (nMatch > bestN) { bestN = nMatch; bestC = sc; }
    }
    if (bestN >= 2) cm.jobtext = bestC;     // ใช้ช่องนี้เป็น "งานซัพพอร์ต" → parse ด้วย rrParseJobText_ (โค้ดเดิม)
  }

  var flights = {}, fltcols = [], lpZones = [];
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
    // หาแถว "A/C TYPE - CFG" (บางทีมเพิ่มมาระบุชนิดเครื่อง → เลือก SLA ตามเครื่องจริง เช่น TR A320=8, B787=10)
    var acRow = null;
    for (var ar = hi + 1; ar <= hi + 5 && ar < rows.length; ar++) {
      var albl = (cm.flt - 1 >= 0 && cm.flt - 1 < (rows[ar] || []).length) ? rrClean_(rows[ar][cm.flt - 1]) : '';
      if (/A\/?C\s*TYPE|AIRCRAFT/i.test(albl)) { acRow = rows[ar]; break; }
    }
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
      var acV = '';
      if (acRow) { for (var ac = c0; ac < c1; ac++) { var av = rrClean_(acRow[ac]); if (av) { acV = av; break; } } }
      flights[fltcols[fi].name] = { STA: staV, STD: stdV, OP: opV, CL: clV, AC: acV };
    }
    fltcols = fltcols.filter(function (f) { return !f.cancelled; });   // ตัดไฟลท์ที่ยกเลิกออก (ไม่บันทึก assignment)
    lpZones = rrLpZones_(rows, hi, cm.flt);                            // LP: บล็อก MORNING/AFTERNOON + เวลา อยู่แถวเหนือหัว ID
  }

  var recs = [], seen = {}, recByIdd = {}, dupSkip = 0;
  for (var rr = hi + 1; rr < rows.length; rr++) {
    var row = rows[rr];
    var idRaw = cm.id < row.length ? rrClean_(row[cm.id]) : '';
    var isBkk = /^B\s*\d{6,7}\b/i.test(idRaw);                // รหัสขึ้นต้น "B" (เช่น B2607384) = พนักงาน BKK มาช่วย (Batch)
    var idd = idRaw.replace(/\D/g, '');
    if (idd.length < 6 && cm.id + 1 < row.length) {          // WY leading seq column
      var rawNext = rrClean_(row[cm.id + 1]).replace(/\.0+$/, '');
      if (/^\d{6,8}$/.test(rawNext)) idd = rawNext;           // only a PURE numeric id (not a flight code like PG251/252)
    }
    var name = cm.name < row.length ? rrClean_(row[cm.name]) : '';
    // แถวซัพพอร์ต: ทีมที่รับใส่ "ชื่อ + รหัสทีมต้นสังกัด" (เช่น "TANADON PVT")
    //  รองรับ 2 แบบ: (1) ID หรือ Position = SUPPORT/SUPP  (2) มีคำว่า "Support" นำหน้าชื่อ เช่น "Support Pattaramon PG"
    //  (กัน "Sup" = ตำแหน่ง Supervisor ไม่ให้เข้าเงื่อนไข — ต้องมี PP สองตัว)
    var posRaw0 = (cm.pos >= 0 && cm.pos < row.length) ? rrClean_(row[cm.pos]) : '';
    var SUP_PREFIX = /^\s*SUPP(?:ORT)?\b[\s:.\-]*/i;
    var isSup = SUP_PREFIX.test(idRaw) || SUP_PREFIX.test(posRaw0) || SUP_PREFIX.test(name);
    var supTeam = '';
    if (isSup) {
      var rawName = SUP_PREFIX.test(name) ? name.replace(SUP_PREFIX, '').trim() : name;   // ตัดคำ "Support" นำหน้าชื่อออก
      if (rawName && !/^(NAME|REMARK|SUPPORT|SUPP)$/i.test(rawName)) {
        var sp = rrSupportTeam_(rawName); name = sp.name; supTeam = sp.team;
        idd = ('SUP' + supTeam + name).replace(/[^A-Za-z0-9ก-๙]/g, '').slice(0, 18);   // รหัสจำลอง (ไม่ใช่รหัสจริง) → ไม่ชนรหัสเดิม/ไม่นับหัวซ้ำ
      } else { isSup = false; }
    }
    if (!name || (!isSup && (idd.length < 6 || idd.length > 8))) continue;
    var nU = name.toUpperCase();
    if (nU === 'NAME' || nU === 'REMARK' || nU === 'SUPPORT' || nU === 'JAIDEE') continue;
    if (!isSup && rrUp_(row[cm.id]).indexOf('EX') === 0) continue;     // template "Ex. 212121" sample row
    var dupOf = seen[idd] ? recByIdd[idd] : null;                      // ID ซ้ำ (บล็อกซ้ำในแท็บ เช่น SU: CHECK IN + GATE ASSIGN)

    var shift  = (cm.shift  >= 0 && cm.shift  < row.length) ? rrClean_(row[cm.shift])  : '';
    var timev  = (cm.time   >= 0 && cm.time   < row.length) ? rrClean_(row[cm.time])   : '';
    var remark = (cm.remark >= 0 && cm.remark < row.length) ? rrClean_(row[cm.remark]) : '';
    // สถานะ (Off/VAC/SICK) บางแถวกรอก "เยื้อง" มาช่องซ้ายของ REMARK เช่น QR: "Off" ตกในคอลัมน์ Total Hrs.
    // → REMARK ว่างเลยนับเป็นมาทำงานผิด · ถ้า REMARK ไม่มีสถานะ ให้ดูช่องซ้ายถัดไป (Total Hrs เป็นตัวเลข ไม่ชนคำสถานะ)
    if (cm.remark - 1 >= 0 && !/\b(OFF|VAC|SICK|\bSL\b|\bBL\b|OT\s*OFF|ONDUTY)\b/i.test(rrUp_(remark))) {
      var nbL = rrClean_(row[cm.remark - 1]);
      if (/^(OFF|OT\s*-?\s*OFF|VAC(?:ATION)?|SICK|SL|BL|DAY\s*OFF|ลา|หยุด)\b/i.test(nbL)) remark = nbL;
    }
    // คอลัมน์ "สถานะงาน" ก่อนบล็อกไฟลท์ (เช่น KE/OZ: ":: FLIGHT ::") — เขียน "OFF"/"OFF/Training" สำหรับคนหยุด
    // (คนยังมีรหัสกะหมุนเวียน เช่น J8 → ถ้าไม่ดูคอลัมน์นี้จะอ่านเป็นมาทำงานทั้งทีม)
    var leadLbl = (cm.flt - 1 >= 0 && cm.flt - 1 < row.length) ? rrClean_(row[cm.flt - 1]) : '';

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
        // คนไปเทรน/ประชุม (เช่น "TRAINING BASIC LOAD CONTROL 08-17") = ไม่ได้ทำไฟลท์นั้น
        // → แสดงเป็นกิจกรรมอบรม ไม่นับเป็นไฟลท์ (ทุกทีม)
        // เก็บเวลากิจกรรมจากคอลัมน์ด้วย (เช่น "Training CM" ที่ใส่เวลา 10:00-18:00 ในแถว STA/STD) — ถ้าไม่มีเวลาในข้อความ
        if (rrIsTrainingTask_(tasks.join(' '))) { assigns.push({ flight: tasks.join(' '), task: '', STA: info.STA || '', STD: info.STD || '', OP: op, CL: cl }); return; }
        // หัวคอลัมน์เป็น "ป้ายไฟลท์ทั่วไป" (เช่น "หมายเลขไฟลท์ 1", "Job 1", "FLIGHT") — รหัสไฟลท์จริง
        // ฝังในข้อความ (Admin Doc/Crewsign: "EY414/415 CREWSIGN…, AK818-819…") → ดึงออกมา
        // (ไม่แตะคอลัมน์ Counter ของ SU — คงงานเคาน์เตอร์ไว้)
        var codes = /หมายเลขไฟลท์|^(?:JOB|FLIGHT)\b/i.test(fc.name) ? rrExtractFlights_(tasks.join(' ')) : null;
        if (codes && codes.length) {
          codes.forEach(function (a) { assigns.push(a); });
        } else {
          var lpz = null;                                     // LP: คอลัมน์นี้อยู่ในโซน MORNING/AFTERNOON ที่มีเวลาไหม
          for (var zi = 0; zi < lpZones.length; zi++) { if (fc.col >= lpZones[zi].c0 && fc.col < lpZones[zi].c1) { lpz = lpZones[zi]; break; } }
          if (lpz && (lpz.sta || lpz.std) && !acIsFlight_(fc.name)) {   // งาน LP ในโซน → ใช้เวลาโซนเป็นช่วงงาน (05:00–15:00 / 14:00–24:00)
            assigns.push({ flight: lpz.label, task: tasks.join('/'), STA: info.STA || lpz.sta, STD: info.STD || lpz.std, OP: op, CL: cl });
            return;
          }
          assigns.push({ flight: fc.name, task: tasks.join('/'),
                         STA: info.STA || '', STD: info.STD || '', OP: op, CL: cl, AC: info.AC || '' });
          // common check-in (SU): โค้ดเคาน์เตอร์ที่ระบุเลขไฟลท์ เช่น "FC661" = FC ของ SU661
          // → เพิ่ม assignment ไฟลท์ของทีม (เฉพาะทีมที่ชื่อเป็นรหัสสายการบิน 2 ตัว)
          if (/^[A-Z]{2}$/.test(String(team).toUpperCase()) && !acIsFlight_(fc.name)) {
            var air = String(team).toUpperCase();
            tasks.forEach(function (tk) {
              var mm = String(tk).match(/^([A-Z]{1,3})(\d{3,4})$/);   // ต้องมี role นำหน้า เช่น FC661 (กัน "0835" = เวลา/เคาน์เตอร์)
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
          if (cn.length && !allDup && acIsFlight_(code) && slaKnownAir_(code)) {   // กันรหัสปลอมจากโน้ต เช่น "BRUSH UP 19"
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
    // บางชีต (เช่น AK) ใส่ "รหัสกะวันหยุด" (เช่น P5) ในคอลัมน์ SHIFT แล้วเขียน "OFF" ในคอลัมน์ TIME/IN
    // (สถานะ Onduty/Off อาจอยู่ผิดคอลัมน์ → remark ว่าง) → ถ้า TIME = OFF/X ให้ถือว่าหยุด แม้รหัสกะไม่ใช่ OFF
    if (bkt === 'working' && /^\s*(OFF|X{1,2})\b/i.test(timev)) bkt = 'off';
    // คอลัมน์งานระบุ OFF (เช่น KE: "OFF"/"OFF/Training") + ไม่มีไฟลท์จริง → หยุด แม้มีรหัสกะหมุนเวียน
    if (bkt === 'working' && /^OFF\b/i.test(leadLbl) &&
        !assigns.some(function (a) { return acIsFlight_(a.flight); })) bkt = 'off';
    if (bkt === 'off' && oth > 0) bkt = 'ot_off';            // SHIFT=X แต่มี OT (เช่น 14-20) = ทำ OT วันหยุด
    if (bkt === 'ot_off' && !(oth > 0)) bkt = 'off';         // REMARK="OT OFF" แต่ไม่มีชั่วโมง OT จริง = ยังไม่ได้มาทำ → หยุด (ไม่นับเป็น on-duty)
    if (isSup) { bkt = assigns.length ? 'working' : 'off'; oth = 0; }   // แถวซัพพอร์ต = มาช่วยไฟลท์ (นับครอบคลุม) · ไม่นับ OT/ชั่วโมงซ้ำ (อยู่ทีมต้นสังกัด)
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
    var rec = {
      team: team, id: idd, name: name, bkk: isBkk,
      support: isSup, supportTeam: supTeam,                  // มาช่วยจากทีมไหน (แถวซัพพอร์ต)
      pos: cm.pos >= 0 ? rrClean_(row[cm.pos]) : '',
      re: reTime || ((cm.re >= 0 && cm.re < row.length) ? rrClean_(row[cm.re]) : ''),
      shift: shift || timev,
      shiftTime: rrFmtRange_(srng) || (shift || timev),
      shiftStart: srng[0],
      shiftHrs: (srng[0] != null && srng[1] != null) ? Math.round((((srng[1] <= srng[0] ? srng[1] + 1440 : srng[1]) - srng[0]) / 60) * 10) / 10 : 0,
      bucket: bkt, remark: remark, ot: oth, otType: otType, otSpans: otSpans,
      otTime: oth > 0 ? otSpans.map(function (s) { return rrFmtRange_([s.a, s.b]); }).filter(String).join(', ') : '',
      // แถวว่างเปล่าจริง (ไม่มีกะ/เวลา/สถานะ/งานเลย) = ชีตยังไม่กรอก → เติมจาก ROSTER เดือนได้
      // (ถ้ามี REMARK เช่น "Off"/"SL" = ตั้งใจให้หยุด → ไม่เติม เคารพชีตรายวัน)
      blankRow: (!shift && !timev && !remark && srng[0] == null && assigns.length === 0),
      assignments: assigns,
    };
    // ID ซ้ำ: ถ้าบล็อกแรกที่เก็บไว้ "ว่างเปล่า" แต่บล็อกนี้มีข้อมูล (กะ/สถานะ/งาน) → ใช้บล็อกนี้แทน
    // (แท็บ SU มี CHECK IN บนสุด (กะว่าง) + GATE ASSIGN ล่าง (กะครบ) ID เดียวกัน)
    if (dupOf) {
      if (dupOf.blankRow && !rec.blankRow) { for (var k in rec) dupOf[k] = rec[k]; }   // บล็อกแรกว่าง (เช่น SU CHECK-IN) → ใช้บล็อกนี้แทน
      else if (!rec.blankRow) dupSkip++;                                                // ทั้งคู่มีข้อมูล = บล็อกซ้อนซ้ำ (เช่น CHARTER) → ข้ามบล็อก 2 (นับไว้เตือน)
      continue;
    }
    seen[idd] = true; recByIdd[idd] = rec; recs.push(rec);
  }
  recs._dupSkip = dupSkip;   // จำนวนแถวที่ข้ามเพราะ ID ซ้ำ (บล็อกซ้อนซ้ำในแท็บ) — ไว้เตือนให้ลบบล็อกซ้ำ
  // โน้ตใต้ตาราง: บางทีมเขียนงานอบรมนอกตาราง เช่น "BASIC LOAD CONTROL TRAINING : CHANAPAT"
  // → คนที่ชื่อตรง + ยังไม่มีไฟลท์จริง ให้ขึ้นเป็นกิจกรรมอบรม (ไม่ใช่ว่าง)
  rrApplyTrainingNotes_(rows, recs);
  // ธง "เทรน/กิจกรรม" = มาทำงาน (working/ot_off) · มีงานที่เป็นอบรมล้วน · ไม่มีไฟลท์จริง (ไม่พร้อมลงไฟลท์)
  recs.forEach(function (r) {
    r.training = (r.bucket === 'working' || r.bucket === 'ot_off') && (r.assignments || []).length > 0
      && !(r.assignments || []).some(function (a) { return acIsFlight_(a.flight); })
      && (r.assignments || []).some(function (a) { return rrIsTrainingTask_(a.flight) || rrIsTrainingTask_(a.task); });
  });
  return recs;
}
/** หาโน้ต "…TRAINING/LOAD CONTROL… : ชื่อ" ในชีต แล้วผูกกับพนักงานที่ชื่อตรง (ถ้ายังไม่มีไฟลท์จริง) */
function rrApplyTrainingNotes_(rows, recs) {
  var notes = [];
  rows.forEach(function (row) {
    (row || []).forEach(function (cell) {
      var c = rrClean_(cell);
      if (!c || c.indexOf(':') < 0 || !rrIsTrainingTask_(c)) return;
      var i = c.indexOf(':'), act = c.slice(0, i).trim(), who = c.slice(i + 1).trim();
      if (act && who) notes.push({ act: act, who: who.toUpperCase() });
    });
  });
  if (!notes.length) return;
  recs.forEach(function (r) {
    var first = String(r.name || '').toUpperCase().split(/[\s(]/)[0];
    if (first.length < 3) return;
    var hasReal = (r.assignments || []).some(function (a) { return acIsFlight_(a.flight); });
    if (hasReal) return;                                   // มีไฟลท์จริงแล้ว → ไม่ทับ
    notes.forEach(function (n) {
      if (n.who.indexOf(first) >= 0) r.assignments = [{ flight: n.act, task: '', STA: '', STD: '', OP: '', CL: '' }];
    });
  });
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

// อ่านวันที่ที่พิมพ์บนหัวแท็บ (เช่น "วันที่ 29/JUN/2026") → คืนรูปแบบ "29/JUN" · '' ถ้าไม่พบ
// ใช้ตรวจแท็บที่ลืมอัปเดต (ทีมหนึ่งเป็นวันเก่า อีกทีมเป็นวันปัจจุบัน → ข้อมูลไม่ตรงวัน)
function rrSheetDate_(ws) {
  var last = Math.min(ws.getLastRow(), 4);
  if (last < 1) return '';
  var vals = ws.getRange(1, 1, last, Math.min(ws.getLastColumn(), 20)).getValues();
  for (var r = 0; r < vals.length; r++) {
    for (var c = 0; c < vals[r].length; c++) {
      var s = String(vals[r][c] == null ? '' : vals[r][c]);
      var m = s.match(/(\d{1,2})\s*\/\s*([A-Za-z]{3,4})/);      // 29/JUN , 24 / JUN
      if (m) return m[1].replace(/^0/, '') + '/' + m[2].toUpperCase();
    }
  }
  return '';
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
  if (r.support) return;                                       // แถวซัพพอร์ต (มาช่วยจากทีมอื่น) — ไม่นับ headcount/OT/ชั่วโมงของทีมรับ (นับที่ทีมต้นสังกัด)
  if (r.bucket === 'working') agg.working++;
  else if (r.bucket === 'ot_off') agg.ot_off++;
  else if (r.bucket === 'off') agg.off++;
  else if (r.bucket === 'sick') agg.sick++;
  else if (r.bucket === 'vac') agg.leave++;
  if (r.training) agg.training++;                              // ซับเซ็ตของ working: อบรม/กิจกรรม (ไม่พร้อมลงไฟลท์)
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
  return { staff: 0, working: 0, ot_off: 0, off: 0, sick: 0, leave: 0, training: 0, otPeople: 0, otHours: 0,
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
  // เผื่อชีตรายวัน "ลืมกรอกกะ" บางคน → ดึงกะจาก ROSTER เดือนมาเติม (ถ้าตั้งค่า PWMS_ROSTER_ID + เข้าถึงได้)
  var rosIso = '', roster = null;
  if (date) { try { rosIso = Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd'); roster = (typeof whLoadMonth_ === 'function') ? whLoadMonth_(rosIso) : null; } catch (eR) {} }
  function fillFromRoster(r) {
    try {
      if (!roster || !roster.byId || !r.blankRow) return;   // เติมเฉพาะแถวว่างเปล่าจริง · กันทุก error ไม่ให้ล้มการโหลด
      var p = roster.byId[String(r.id || '').replace(/\.0+$/, '').replace(/\D/g, '')]; if (!p || !p.days) return;
      for (var i = 0; i < p.days.length; i++) {
        if (p.days[i].iso === rosIso) {
          var dd = p.days[i];
          if (dd.work && dd.hours > 0) { r.shift = dd.code; r.shiftTime = dd.code; r.shiftHrs = dd.hours; r.bucket = 'working'; r.fromRoster = true; }
          return;
        }
      }
    } catch (eFR) {}
  }
  // ShiftDB: รหัสกะ→เวลา (เผื่อชีตรายวันกรอกแค่รหัสกะ แต่ไม่กรอกช่วงเวลา → คิดชั่วโมงไม่ได้ เช่น "E10")
  var shiftDB = {};
  try {
    var sdb = ss.getSheetByName('ShiftDB') || ss.getSheetByName('SHIFTDB') || ss.getSheetByName('Shift DB');
    if (sdb) {
      var sv = sdb.getDataRange().getValues();
      var cm = function (v) {
        if (v == null || v === '') return null;
        if (Object.prototype.toString.call(v) === '[object Date]') return v.getHours() * 60 + v.getMinutes();
        var mm = String(v).match(/(\d{1,2})[:.](\d{2})/); return mm ? (+mm[1] * 60 + +mm[2]) : null;
      };
      for (var si = 1; si < sv.length; si++) {
        var code = String(sv[si][0] == null ? '' : sv[si][0]).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) continue;
        var inM = cm(sv[si][1]), outM = cm(sv[si][2]);
        if (inM == null) continue;
        if (outM != null && outM <= inM) outM += 1440;
        shiftDB[code] = { in: inM, out: outM, hrs: outM != null ? Math.round((outM - inM) / 60 * 10) / 10 : (+sv[si][3] || 0) };
      }
    }
  } catch (eSDB) {}
  function fillFromShiftDB(r) {
    try {
      if (r.shiftStart != null) return;                     // มีเวลากะอยู่แล้ว
      if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
      var code = String(r.shift || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      var d = shiftDB[code]; if (!d) return;
      r.shiftStart = d.in;
      r.shiftTime = rrFmtMin_(d.in) + '-' + rrFmtMin_(((d.out == null ? d.in : d.out) % 1440));
      r.shiftHrs = d.hrs;
      r.fromShiftDB = true;
    } catch (e) {}
  }
  var droppedTabs = [], dupBlockTabs = [];
  rrFilterRev_(ss.getSheets()).forEach(function (ws) {
    var recs = rrParseSheet_(ws);
    if (!recs || !recs.length) {
      // แท็บทีมที่มีข้อมูลจริง แต่ parser อ่านไม่ได้เลย (เช่น ZF ไม่มีคอลัมน์ ID) → หายไปเงียบ ๆ ต้องเตือน
      try {
        var nmU = ws.getName().trim().toUpperCase();
        var isSkip = false;
        for (var ki = 0; ki < SKIP_SHEETS_RR.length; ki++) if (nmU.indexOf(SKIP_SHEETS_RR[ki]) >= 0) isSkip = true;
        if (!isSkip && ws.getLastRow() >= 8 && ws.getLastColumn() >= 4) droppedTabs.push(ws.getName().trim());
      } catch (eDT) {}
      return;
    }
    if (recs._dupSkip >= 3) dupBlockTabs.push(ws.getName().trim());   // บล็อกซ้อนซ้ำ (≥3 แถว ID ซ้ำ ที่มีข้อมูลทั้งคู่) → เตือนให้ลบบล็อกซ้ำ
    var t = rrNewAgg_();
    t.records = recs;
    recs.forEach(function (r) {
      r.posGroup = rrPosGroup_(r.pos, ws.getName());
      r.isHoliday = isHol;
      fillFromRoster(r);                                     // เติมกะจาก ROSTER เดือนถ้าชีตรายวันว่าง
      fillFromShiftDB(r);                                    // เติมเวลากะจาก ShiftDB ถ้ามีแค่รหัสกะ
      rrAddBucket_(t, r, isHol);
      if (!positions[r.posGroup]) positions[r.posGroup] = rrNewAgg_();
      rrAddBucket_(positions[r.posGroup], r, isHol);
      rrAddBucket_(totals, r, isHol);
    });
    rrRoundAgg_(t);
    try { t.sheetDate = rrSheetDate_(ws); } catch (eSD) { t.sheetDate = ''; }   // วันที่ที่พิมพ์บนแท็บ (ไว้ตรวจแท็บค้างวันเก่า)
    teams[ws.getName().trim()] = t;
  });
  Object.keys(positions).forEach(function (p) { rrRoundAgg_(positions[p]); });
  rrRoundAgg_(totals);
  delete totals.records;
  return { teams: teams, positions: positions, totals: totals, holiday: holName, droppedTabs: droppedTabs, dupBlockTabs: dupBlockTabs };
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
