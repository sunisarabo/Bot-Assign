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
/** วันที่ในเซลล์ (Date object หรือ "09.07.2026" / "9/7/26" — วันก่อนเดือน) → {d,m,y} หรือ null */
function counterRowDate_(v) {
  if (v instanceof Date && v.getFullYear() > 1990) return { d: v.getDate(), m: v.getMonth() + 1, y: v.getFullYear() };
  var m = String(v == null ? '' : v).match(/\b(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})\b/);
  if (!m) return null;
  var y = +m[3]; if (y < 100) y += 2000;
  return { d: +m[1], m: +m[2], y: y };
}
/** parse ชีต counter หนึ่งแท็บ → { "EY411":10, "KC564":5, ... } · คืน null ถ้าไม่ใช่รูปแบบ counter
 *  รองรับ 2 เลย์เอาต์:
 *   (A) มีคอลัมน์ "NO. OF COUNTER" (ตัวเลขรวม) → ใช้ค่านั้น
 *   (B) 1 แถว = 1 เคาน์เตอร์ (คอลัมน์ "COUNTER NO." เป็นป้าย HB02/HB03…) → นับจำนวนแถวต่อไฟลท์
 *  wantDate (Date) = ถ้าชีตมี "คอลัมน์วันที่" (ไฟล์รวมหลายวัน เช่น Bridge ดึง ±7 วัน) → กรองเอาเฉพาะวันนั้น */
function counterParseSheet_(sh, wantDate) {
  if (!sh) return null;
  var last = sh.getLastRow(); if (last < 3) return null;
  var rows = sh.getRange(1, 1, last, Math.min(sh.getLastColumn(), 20)).getValues();
  var hi = -1, cAir = 0, cFlt = 1, cCtr = -1, cOpen = -1, cDate = -1, cLabel = -1;
  for (var r = 0; r < Math.min(rows.length, 6); r++) {
    var line = rows[r].map(function (v) { return String(v || '').toUpperCase(); });
    var hasFlt = line.some(function (v) { return v.indexOf('FLIGHT') >= 0; });
    var hasCnt = line.some(function (v) { return /NO\.?\s*OF/.test(v); });          // "NO. OF COUNTER" (ตัวเลขรวม)
    var hasCtr = line.some(function (v) { return v.indexOf('COUNTER') >= 0; });      // "COUNTER NO." (ป้ายรายเคาน์เตอร์)
    if (hasFlt && (hasCnt || hasCtr)) {
      hi = r; cAir = 0; cFlt = 1; cCtr = -1; cOpen = -1; cDate = -1; cLabel = -1;
      line.forEach(function (v, i) {
        if (v.indexOf('AIRLINE') >= 0) cAir = i;
        else if (v.indexOf('FLIGHT') >= 0) cFlt = i;
        else if (/NO\.?\s*OF/.test(v)) cCtr = i;                    // ตัวเลขจำนวนเคาน์เตอร์ (เลย์เอาต์ A)
        else if (v.indexOf('COUNTER') >= 0) cLabel = i;             // ป้ายเลขเคาน์เตอร์ HB02… (เลย์เอาต์ B → นับแถว)
        else if (v.indexOf('OPEN') >= 0) cOpen = i;                 // "OPEN-CLOSE TIME"
        else if (v.indexOf('DATE') >= 0) cDate = i;                 // "DATE" — ไฟล์รวมหลายวัน
      });
      break;
    }
  }
  if (hi < 0 || (cCtr < 0 && cLabel < 0)) return null;             // ไม่มีทั้งจำนวนและป้ายเคาน์เตอร์ → ไม่ใช่ชีต counter
  // ไม่มีหัว "DATE" แต่ข้อมูลมีวันที่ฝังในคอลัมน์ (เช่น 09.07.2026) → หาคอลัมน์วันที่อัตโนมัติ
  if (cDate < 0) {
    for (var c = 0; c < (rows[hi + 1] || []).length; c++) {
      var hit = 0;
      for (var rr = hi + 1; rr < Math.min(rows.length, hi + 6); rr++) { if (counterRowDate_((rows[rr] || [])[c])) hit++; }
      if (hit >= 2) { cDate = c; break; }
    }
  }
  var wd = wantDate ? { d: wantDate.getDate(), m: wantDate.getMonth() + 1, y: wantDate.getFullYear() } : null;
  // รวมต่อไฟลท์ (รองรับทั้ง 2 เลย์เอาต์ผ่านตัวสะสมเดียว)
  var agg = {}, order = [], curAir = '';
  for (var i = hi + 1; i < rows.length; i++) {
    if (wd && cDate >= 0) {                                        // กรองตามวันที่ (ไฟล์รวมหลายวัน)
      var rd = counterRowDate_(rows[i][cDate]);
      if (rd && !(rd.d === wd.d && rd.m === wd.m && rd.y === wd.y)) continue;
    }
    var air = String(rows[i][cAir] || '').trim().toUpperCase();
    if (air) curAir = air;
    var flt = String(rows[i][cFlt] || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!flt || flt.indexOf('FLIGHT') >= 0) continue;
    var a = agg[flt]; if (!a) { a = agg[flt] = { air: curAir, cnt: 0, labels: {}, op: '', cl: '' }; order.push(flt); }
    if (!a.air) a.air = curAir;
    if (cCtr >= 0) { var nn = parseInt(String(rows[i][cCtr] || '').replace(/[^0-9.]/g, ''), 10); if (nn > 0) a.cnt = Math.max(a.cnt, nn); }
    if (cLabel >= 0) { var lb = String(rows[i][cLabel] || '').trim().toUpperCase().replace(/\s+/g, ''); if (lb && /\d/.test(lb)) a.labels[lb] = 1; }   // นับป้ายเคาน์เตอร์ที่ไม่ซ้ำ
    if (cOpen >= 0) {                                              // เปิดเร็วสุด · ปิดช้าสุด ของไฟลท์นั้น
      var oc = String(rows[i][cOpen] || '').match(/(\d{1,2})[:.]?(\d{2})/g);
      if (oc && oc.length) { var o = rrTimePair_(oc[0]), c2 = oc.length > 1 ? rrTimePair_(oc[oc.length - 1]) : '';
        if (o && (a.op === '' || o < a.op)) a.op = o; if (c2 && (a.cl === '' || c2 > a.cl)) a.cl = c2; }
    }
  }
  var map = {}, nEntry = 0;
  order.forEach(function (flt) {
    var a = agg[flt];
    var n = (cCtr >= 0 && a.cnt > 0) ? a.cnt : Object.keys(a.labels).length;   // A: ค่าตัวเลข · B: นับป้าย
    if (!(n > 0)) return;
    var op = a.op, cl = a.cl;
    map[flt] = n; nEntry++;
    if (op) { map['@' + flt] = op; if (cl) map['~' + flt] = cl; }
    var mm = flt.match(/^([0-9A-Z]{2})?(\d{2,4})/);
    if (mm) { var ai = mm[1] || a.air; if (ai) { map[ai + mm[2]] = n; if (op) { map['@' + ai + mm[2]] = op; if (cl) map['~' + ai + mm[2]] = cl; } } map['#' + mm[2]] = n; if (op) { map['@#' + mm[2]] = op; if (cl) map['~#' + mm[2]] = cl; } }
  });
  return nEntry ? map : null;
}
/** เวลาเปิด/ปิดเคาน์เตอร์ที่ท่าจัด สำหรับไฟลท์ (roster pair → ขาออกในไฟล์ท่า) → {op,cl} หรือ null */
function counterTimesForFlight_(map, flight) {
  if (!map) return null;
  var s = String(flight || '').toUpperCase().replace(/\s+/g, '');
  var keys = [s];
  var air = (typeof slaAirlineOf_ === 'function') ? slaAirlineOf_(flight) : '';
  (s.match(/\d{2,4}/g) || []).forEach(function (nn) { if (air) keys.push(air + nn); keys.push('#' + nn); });
  for (var i = 0; i < keys.length; i++) { if (map['@' + keys[i]] != null) return { op: map['@' + keys[i]], cl: map['~' + keys[i]] || '' }; }
  return null;
}
/** อ่านจากไฟล์เคาน์เตอร์แยก (COUNTER_FILE_ID):
 *  1) แท็บตามวันที่ (ไฟล์ของท่าที่มีแท็บรายวัน) — ต้องแชร์ไฟล์ให้บัญชีที่รัน
 *  2) ถ้าไม่มีแท็บวันที่ → แท็บ "COUNTER" แท็บเดียว (ไฟล์ bridge ที่ IMPORTRANGE ของวันนี้เข้ามา) */
function counterReadForDate(fileId, date) {
  if (!fileId) return null;
  var ss = SpreadsheetApp.openById(fileId);
  var tab = findCounterTab_(ss, date);
  if (tab) { var m = counterParseSheet_(ss.getSheetByName(tab), date); if (m) return m; }
  return counterReadFromRoster_(ss, date);                         // แท็บเดียว: ไฟล์ท่าวันเดียว หรือ Bridge รวมหลายวัน (กรองด้วยคอลัมน์วันที่)
}
/** อ่านแท็บเคาน์เตอร์จากไฟล์ (ตารางเวร/bridge): เอาแท็บชื่อ "COUNTER" ก่อน
 *  ไม่มี → สแกนทุกแท็บหาอันที่เป็นรูปแบบ counter (มีหัว FLIGHT + NO. OF COUNTER) — bridge ตั้งชื่อแท็บอะไรก็ได้
 *  date = กรองเฉพาะวันนั้น ถ้าแท็บมีคอลัมน์วันที่ (ไฟล์รวมหลายวัน) */
function counterReadFromRoster_(ss, date) {
  if (!ss) return null;
  var sheets = ss.getSheets(), i, m;
  for (i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toUpperCase().indexOf('COUNTER') >= 0) { m = counterParseSheet_(sheets[i], date); if (m) return m; }
  }
  for (i = 0; i < sheets.length; i++) { m = counterParseSheet_(sheets[i], date); if (m) return m; }   // fallback: แท็บไหนก็ได้ที่รูปแบบตรง
  return null;
}
// ─── COUNTER BRIDGE ±N วัน (IMPORTRANGE อัตโนมัติ) ──────────────────────────
// สร้างแท็บใน "PAS Counter Bridge" ครอบ ±N วันจากวันนี้ · แต่ละแท็บ = วันที่ (เช่น 06JUL26)
// ดึง (IMPORTRANGE) เคาน์เตอร์ของท่าวันนั้นเข้ามา → dashboard เปิดดูวันไหนใน ±7 วันก็มีข้อมูล
// findCounterTab_ จับแท็บตามชื่อวันที่อยู่แล้ว จึงไม่ต้องแก้ฝั่งอ่าน
/** ชื่อแท็บของวันที่ ตามรูปแบบที่ท่าตั้ง (ให้ตรงกับ findCounterTab_) */
function rbCounterTabName_(dt, fmt) {
  var d = dt.getDate(), dPad = ('0' + d).slice(-2);
  var mon = MON_RB[dt.getMonth()], yr2 = String(dt.getFullYear()).slice(2);
  switch (String(fmt || 'DDMONYY').toUpperCase()) {
    case 'DMONYY': return d + mon + yr2;      // 6JUL26
    case 'DDMON':  return dPad + mon;         // 06JUL
    case 'DMON':   return d + mon;            // 6JUL
    default:       return dPad + mon + yr2;   // 06JUL26
  }
}
/** ชื่อแท็บนี้ "หน้าตาเป็นวันที่" หรือไม่ (ใช้ล้างแท็บเก่านอกช่วง) */
function rbIsDateTabName_(nm) {
  return new RegExp('^\\d{1,2}\\s*(' + MON_RB.join('|') + ')', 'i').test(String(nm || '').trim());
}
/** สร้าง/รีเฟรชแท็บ Bridge ให้ครอบ ±COUNTER_BRIDGE_DAYS วันจากวันนี้ (รันเองครั้งแรก + ตั้ง trigger รายวัน)
 *  หมายเหตุ: IMPORTRANGE ครั้งแรกจากไฟล์ต้นทางใหม่ ต้องเปิด Bridge กด "อนุญาตการเข้าถึง" 1 ครั้ง แล้วที่เหลือใช้ได้เอง */
function rbCounterBridgeRefresh() {
  var C = CONFIG_RB;
  if (!C.COUNTER_FILE_ID) throw new Error('ยังไม่ได้ตั้ง COUNTER_FILE_ID (ไฟล์ Bridge)');
  if (!C.COUNTER_SRC_ID)  throw new Error('ยังไม่ได้ตั้ง COUNTER_SRC_ID (ไฟล์ COUNTER CHECK ของท่า)');
  var days = C.COUNTER_BRIDGE_DAYS || 7;
  var range = C.COUNTER_SRC_RANGE || 'A1:J400';
  var fmt = C.COUNTER_SRC_TABFMT || 'DDMONYY';
  var srcUrl = 'https://docs.google.com/spreadsheets/d/' + C.COUNTER_SRC_ID;
  var bridge = SpreadsheetApp.openById(C.COUNTER_FILE_ID);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var want = {};
  for (var off = -days; off <= days; off++) {
    var dt = new Date(today.getTime() + off * 86400000);
    var name = rbCounterTabName_(dt, fmt);                 // ชื่อแท็บ Bridge = ชื่อแท็บของท่า (วันนั้น)
    want[name] = 1;
    var sh = bridge.getSheetByName(name) || bridge.insertSheet(name);
    // IFERROR กันวันที่ท่ายังไม่ลงข้อมูล (แท็บไม่มี) → เว้นว่าง ไม่พังทั้งชีต
    sh.getRange(1, 1).setFormula('=IFERROR(IMPORTRANGE("' + srcUrl + '","' + name + '!' + range + '"),"")');
  }
  // ล้างแท็บ "วันที่" เก่านอกช่วง (คงแท็บอื่น เช่น README/COUNTER ไว้)
  bridge.getSheets().forEach(function (sh) {
    var nm = sh.getName();
    if (rbIsDateTabName_(nm) && !want[nm] && bridge.getSheets().length > 1) {
      try { bridge.deleteSheet(sh); } catch (e) {}
    }
  });
  SpreadsheetApp.flush();
  return 'รีเฟรช Bridge: ' + Object.keys(want).length + ' แท็บ (วันนี้ ±' + days + ' วัน)';
}
/** ติดตั้ง trigger รายวัน (เลื่อนหน้าต่าง ±7 วันอัตโนมัติ) + รีเฟรชทันที 1 ครั้ง */
function rbInstallCounterBridgeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rbCounterBridgeRefresh') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rbCounterBridgeRefresh').timeBased().everyDays(1).atHour(1).create();
  return rbCounterBridgeRefresh() + ' · ตั้ง trigger รายวัน 01:00 แล้ว';
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
