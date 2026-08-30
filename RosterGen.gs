/**
 * RosterGen.gs — สร้างตารางกะทั้งเดือนอัตโนมัติ (เวลากะ "สวิงตามไฟลท์")
 * =============================================================================
 * โมเดล: demand คิดจาก "ตารางบิน + SLA" ต่อ 30 นาที → เลือก "รหัสกะจาก ShiftDB"
 * (เวลาเริ่ม+ชั่วโมงยืดหยุ่น เช่น F8=06:00-14:00 · K12=11:00-23:00) มาคลุม peak จริง
 *
 *   1) ต่อวัน: สร้าง demand[48 slot] = ผลรวมคนที่ไฟลท์ต้องการช่วงนั้น (STD-lead → STD+post × manning)
 *   2) greedy: หา slot ที่ขาดมากสุด → เลือกรหัสกะที่คลุม deficit ได้มากสุด → จัดคน 1 คน → ลด demand
 *   3) คน = คิดจากคนจริง (advReadEmployees_) · คุม: ทำติดสูงสุด · พักขั้นต่ำ 11 ชม. (กันกะชนวัน)
 *      · กระจายชั่วโมง/OFF/เสาร์อาทิตย์ยุติธรรม
 *   4) validate → coverage ต่อวัน · fairness · issues
 *
 * กฎแก้ได้ในชีต "ROSTER CONFIG" (max ทำติด · พักขั้นต่ำ · lead/post · safety factor)
 * รหัสกะดึงจาก ShiftDB (โค้ด→เวลาเข้า/ออก) ในไฟล์ assignment เอง
 *
 * Entry:  rosSetupConfig()  ·  rosGenerateMonth(year, month)
 */

var ROS_CFG_TAB = 'ROSTER CONFIG';
var ROS_CFG_PROP = 'ROSTER_CFG_ID';
var ROS_SLOT = 30;                                  // ความละเอียด demand (นาที/slot) → 48 slot/วัน
var ROS_NSLOT = 1440 / ROS_SLOT;

function rosCfgId_() { try { return String(PropertiesService.getScriptProperties().getProperty(ROS_CFG_PROP) || '').trim(); } catch (e) { return ''; } }

function rosDefaults_() {
  return { max_consecutive: 6, min_rest_hours: 11, off_per_week: 1,
    lead_min: 180, post_min: 30, safety_factor: 1.0, shift_min_hrs: 8, shift_max_hrs: 12 };
}

/** สร้าง/เปิดชีตกฎ ROSTER CONFIG · คืน URL */
function rosSetupConfig() {
  var id = rosCfgId_(), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) { ss = rbCreateSheet_('PAS — ROSTER CONFIG (กฎจัดตารางกะ)'); try { PropertiesService.getScriptProperties().setProperty(ROS_CFG_PROP, ss.getId()); } catch (e1) {} }
  var cur = rosConfig_(), d = rosDefaults_();
  var sh = ss.getSheetByName(ROS_CFG_TAB) || ss.insertSheet(ROS_CFG_TAB);
  sh.clear();
  var rows = [
    ['กฎจัดตารางกะ — เวลากะสวิงตามไฟลท์ (demand จากตารางบิน+SLA · เลือกโค้ดจาก ShiftDB)', ''],
    ['lead_min = เข้างานก่อน STD (นาที) · post_min = อยู่ต่อหลัง STD · safety_factor = คูณ demand เผื่อ', ''],
    ['Key', 'Value'],
    ['max_consecutive', cur.max_consecutive || d.max_consecutive],
    ['min_rest_hours', cur.min_rest_hours || d.min_rest_hours],
    ['off_per_week', cur.off_per_week || d.off_per_week],
    ['lead_min', cur.lead_min || d.lead_min],
    ['post_min', cur.post_min || d.post_min],
    ['safety_factor', cur.safety_factor || d.safety_factor],
    ['shift_min_hrs', cur.shift_min_hrs || d.shift_min_hrs],
    ['shift_max_hrs', cur.shift_max_hrs || d.shift_max_hrs]
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1, 1, 2).merge().setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff').setWrap(true);
  sh.getRange(2, 1, 1, 2).merge().setFontStyle('italic').setFontColor('#5b7189');
  sh.getRange(3, 1, 1, 2).setFontWeight('bold').setBackground('#dce9f7').setFontColor('#1f4e79');
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 100); sh.setFrozenRows(3);
  return ss.getUrl();
}

function rosConfig_() {
  var d = rosDefaults_(), id = rosCfgId_();
  if (!id) return d;
  try {
    var sh = SpreadsheetApp.openById(id).getSheetByName(ROS_CFG_TAB); if (!sh) return d;
    var vals = sh.getDataRange().getValues(), out = {};
    for (var i = 0; i < vals.length; i++) {
      var k = String(vals[i][0] == null ? '' : vals[i][0]).trim(); if (!k || k === 'Key') continue;
      var v = String(vals[i][1] == null ? '' : vals[i][1]).trim();
      out[k] = k === 'safety_factor' ? (parseFloat(v) || d[k]) : (parseInt(v.replace(/[^0-9.]/g, ''), 10) || d[k]);
    }
    Object.keys(d).forEach(function (k) { if (out[k] == null) out[k] = d[k]; });
    return out;
  } catch (e) { return d; }
}

// ─── ShiftDB (โค้ด→เวลา) ─────────────────────────────────────────────────────
function rosMin_(v) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getHours() * 60 + v.getMinutes();
  var m = String(v).match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null;
}
/** อ่าน ShiftDB → [{code,inMin,outMin,hrs}] (out<in = ข้ามคืน → +1440) · กรองตามช่วงชั่วโมงที่ตั้ง */
function rosShiftCodes_(ss, cfg) {
  var out = [];
  try {
    var sh = ss.getSheetByName('ShiftDB') || ss.getSheetByName('SHIFTDB') || ss.getSheetByName('Shift DB');
    if (!sh) return out;
    var vals = sh.getDataRange().getValues();
    for (var i = 1; i < vals.length; i++) {
      var code = String(vals[i][0] == null ? '' : vals[i][0]).trim();
      if (!code || /^\s*(OFF|X|SL|BL|VL)/i.test(code)) continue;
      var inM = rosMin_(vals[i][1]), outM = rosMin_(vals[i][2]);
      if (inM == null || outM == null) continue;
      if (outM <= inM) outM += 1440;
      var hrs = (outM - inM) / 60;
      if (hrs < (cfg.shift_min_hrs || 8) || hrs > (cfg.shift_max_hrs || 12)) continue;
      out.push({ code: code, inMin: inM, outMin: outM, hrs: Math.round(hrs * 10) / 10 });
    }
  } catch (e) {}
  out.sort(function (a, b) { return a.inMin - b.inMin || a.hrs - b.hrs; });
  return out;
}

// ─── demand จากตารางบิน + SLA ────────────────────────────────────────────────
/** สร้าง demand[ROS_NSLOT] ของวัน tgt = ผลรวมคนที่ไฟลท์ต้องการต่อ slot 30 นาที */
function rosDayDemand_(tgt, cfg) {
  var dem = new Array(ROS_NSLOT).fill(0), nFlt = 0;
  var flights = [];
  try { flights = advReadFlights_(tgt) || []; } catch (e) { flights = []; }
  flights.forEach(function (f) {
    if (!acIsFlight_(f.flight)) return;
    var sta = rosMin_(f.STA), std = rosMin_(f.STD);
    var anchor = std != null ? std : sta; if (anchor == null) return;
    var req = 0;
    try { var r = slaReq_(f.airline, f.AC); req = (r && r.total) || 0; } catch (e2) { req = 0; }
    if (!req) req = 8;
    req = Math.round(req * (cfg.safety_factor || 1));
    var startM = (std != null ? std - (cfg.lead_min || 180) : (sta - 60));   // เข้าก่อน STD (เช็คอิน) หรือรับ arrival
    var endM = anchor + (cfg.post_min || 30);
    for (var m = startM; m < endM; m += ROS_SLOT) {
      var s = Math.floor((((m % 1440) + 1440) % 1440) / ROS_SLOT);
      dem[s] += req;
    }
    nFlt++;
  });
  return { dem: dem, nFlt: nFlt };
}

// ─── engine ──────────────────────────────────────────────────────────────────
function rosGenerateMonth(year, month) {
  year = +year; month = +month;
  var days = new Date(year, month, 0).getDate();
  var cfg = rosConfig_();
  var flightSs = (typeof advFlightSs_ === 'function') ? advFlightSs_() : null;
  // ShiftDB: อ่านจากไฟล์ตารางบิน/assignment (มีแท็บ ShiftDB) · ไม่งั้นลองไฟล์รายชื่อ
  var shSrc = flightSs;
  var codes = shSrc ? rosShiftCodes_(shSrc, cfg) : [];
  if (!codes.length) throw new Error('ไม่พบ ShiftDB (โค้ดกะ→เวลา) — ตรวจว่าไฟล์ตารางบินมีแท็บ ShiftDB');
  ROS_CODE_MEMO_ = {}; codes.forEach(function (c) { ROS_CODE_MEMO_[c.code] = c; });   // lookup โค้ด→เวลา (ใช้ตอนเช็คพักขั้นต่ำ)

  var empMap = (typeof advReadEmployees_ === 'function') ? advReadEmployees_() : {};
  var emps = Object.keys(empMap).map(function (id) { return empMap[id]; })
    .filter(function (e) { return e.active !== false && e.name; })
    .sort(function (a, b) { return String(a.team).localeCompare(String(b.team)) || String(a.name).localeCompare(String(b.name)); });
  if (!emps.length) throw new Error('ไม่พบรายชื่อพนักงาน (ADV_EMP_ID / ชีต Total)');

  var roster = {}, hrsSoFar = {}, weOff = {};
  emps.forEach(function (e) { roster[e.id] = new Array(days).fill('OFF'); hrsSoFar[e.id] = 0; weOff[e.id] = 0; });

  var issues = [], coverage = [];
  for (var day = 0; day < days; day++) {
    var tgt = { y: year, m: month, d: day + 1 };
    var dow = new Date(year, month - 1, day + 1).getDay(), isWe = (dow === 0 || dow === 6);
    var dd = rosDayDemand_(tgt, cfg), dem = dd.dem.slice(), demCopy = dd.dem.slice();
    var totalDemand = dem.reduce(function (a, b) { return a + b; }, 0);
    var unfillable = {};                                          // slot ที่หาคนไม่ได้แล้ว (กันวนลูป)
    var guard = 0;
    while (guard++ < 2000) {
      // slot ที่ขาดมากสุด (ยังหาคนได้)
      var s = -1, mx = 0;
      for (var i = 0; i < ROS_NSLOT; i++) { if (!unfillable[i] && dem[i] > mx) { mx = dem[i]; s = i; } }
      if (s < 0) break;                                           // demand ครบหมด
      var pick = rosPickShift_(codes, dem, s);                    // รหัสกะที่คลุม deficit รอบ s มากสุด
      if (!pick) { unfillable[s] = 1; continue; }
      var person = rosPickPerson_(emps, roster, hrsSoFar, day, pick, cfg);
      if (!person) { unfillable[s] = 1; continue; }               // ไม่มีคนว่าง/ติดกฎ → slot นี้ขาด
      roster[person.id][day] = pick.code; hrsSoFar[person.id] += pick.hrs;
      // ลด demand ตามช่วงกะ
      for (var m = pick.inMin; m < pick.outMin; m += ROS_SLOT) { var sl = Math.floor((((m % 1440) + 1440) % 1440) / ROS_SLOT); if (dem[sl] > 0) dem[sl]--; }
    }
    // นับ OFF เสาร์อาทิตย์ (คนที่ยัง OFF วันนี้)
    if (isWe) emps.forEach(function (e) { if (roster[e.id][day] === 'OFF') weOff[e.id]++; });
    // coverage: slot ที่ยังขาด
    var short = 0, worstSlot = -1, worstN = 0;
    for (var k = 0; k < ROS_NSLOT; k++) { if (dem[k] > 0) { short += dem[k]; if (dem[k] > worstN) { worstN = dem[k]; worstSlot = k; } } }
    coverage.push({ day: day + 1, nFlt: dd.nFlt, demand: totalDemand, short: short,
      worst: worstSlot >= 0 ? (rosFmt_(worstSlot * ROS_SLOT) + ' ขาด ' + worstN) : '', ok: short === 0 });
    if (short > 0) issues.push({ severity: 'HIGH', msg: 'วันที่ ' + (day + 1) + ' คนไม่พอคลุม demand (ขาดรวม ' + short + ' slot-คน · หนักสุด ' + (worstSlot >= 0 ? rosFmt_(worstSlot * ROS_SLOT) : '') + ')' });
  }
  // compliance: ทำติดเกิน
  emps.forEach(function (e) {
    var mc = rosMaxConsecutive_(roster[e.id]);
    if (mc > cfg.max_consecutive) issues.push({ severity: 'HIGH', msg: e.name + ' ทำติด ' + mc + ' วัน (max ' + cfg.max_consecutive + ')' });
  });

  var url = rosWriteSheet_(roster, emps, year, month, days, coverage, issues, hrsSoFar);
  var fairness = emps.map(function (e) {
    var work = roster[e.id].filter(function (x) { return x !== 'OFF'; }).length;
    return { name: e.name, team: e.team, work: work, off: days - work, hrs: Math.round(hrsSoFar[e.id] * 10) / 10, weOff: weOff[e.id] };
  });
  return { url: url, days: days, people: emps.length, nCodes: codes.length, coverage: coverage, fairness: fairness, issues: issues };
}

function rosFmt_(m) { m = ((m % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function rosMaxConsecutive_(arr) { var mx = 0, c = 0; for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i] !== 'OFF') { c++; if (c > mx) mx = c; } else c = 0; } return mx; }
function rosConsecutive_(arr, day) { var n = 0; for (var i = day - 1; i >= 0; i--) { if (arr[i] && arr[i] !== 'OFF') n++; else break; } return n; }

/** เลือกรหัสกะที่คลุม deficit รอบ slot s ได้มากสุด (ต้องคลุม s · tiebreak สั้นกว่า = ประหยัดชั่วโมง) */
function rosPickShift_(codes, dem, s) {
  var best = null, bestCov = 0, bestHrs = 1e9;
  var sMin = s * ROS_SLOT;
  for (var i = 0; i < codes.length; i++) {
    var c = codes[i];
    if (!(c.inMin <= sMin && sMin < c.outMin)) {                  // กะต้องคลุม slot s (เทียบใน-วัน · เผื่อข้ามคืน +1440)
      if (!(c.inMin <= sMin + 1440 && sMin + 1440 < c.outMin)) continue;
    }
    var cov = 0;
    for (var m = c.inMin; m < c.outMin; m += ROS_SLOT) { var sl = Math.floor((((m % 1440) + 1440) % 1440) / ROS_SLOT); if (dem[sl] > 0) cov++; }
    if (cov > bestCov || (cov === bestCov && c.hrs < bestHrs)) { best = c; bestCov = cov; bestHrs = c.hrs; }
  }
  return bestCov > 0 ? best : null;
}
/** เลือกคนสำหรับกะ pick วัน day: ว่าง · ไม่ทำติดเกิน · พักพอ (11ชม.) · ชั่วโมงรวมน้อยก่อน (ยุติธรรม) */
function rosPickPerson_(emps, roster, hrsSoFar, day, pick, cfg) {
  var best = null, bs = 1e9, minRest = (cfg.min_rest_hours || 11) * 60;
  for (var i = 0; i < emps.length; i++) {
    var e = emps[i], arr = roster[e.id];
    if (arr[day] !== 'OFF') continue;                             // จัดแล้ว
    if (rosConsecutive_(arr, day) >= cfg.max_consecutive) continue;
    // พักขั้นต่ำจากกะเมื่อวาน (ถ้าเมื่อวานทำ)
    if (day > 0 && arr[day - 1] !== 'OFF') {
      var prev = rosCodeOf_(arr[day - 1]); if (prev) { var gap = (pick.inMin + 1440) - prev.outMin; if (gap < minRest) continue; }
    }
    var sc = hrsSoFar[e.id];                                      // ชั่วโมงน้อย → ได้ก่อน (กระจายงาน)
    if (sc < bs) { bs = sc; best = e; }
  }
  return best;
}
var ROS_CODE_MEMO_ = null;
function rosCodeOf_(code) {                                       // lookup โค้ด→เวลา (memo จาก ShiftDB ล่าสุดที่โหลด)
  if (!ROS_CODE_MEMO_) return null;
  return ROS_CODE_MEMO_[code] || null;
}

/** เขียน roster + coverage + issues ลงชีตใหม่ · คืน URL */
function rosWriteSheet_(roster, emps, year, month, days, coverage, issues, hrsSoFar) {
  var MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var ss = rbCreateSheet_('Roster ' + MON[month - 1] + ' ' + year + ' (auto · flight-driven)');
  var sh = ss.getSheets()[0]; sh.setName('ROSTER');
  var hdr = ['Emp ID', 'Name', 'Team', 'Pos'];
  for (var dd = 1; dd <= days; dd++) hdr.push(String(dd));
  hdr.push('Work', 'OFF', 'Hrs');
  var rows = [hdr];
  emps.forEach(function (e) {
    var arr = roster[e.id], work = arr.filter(function (x) { return x !== 'OFF'; }).length;
    rows.push([e.id, e.name, e.team, e.pos].concat(arr).concat([work, days - work, Math.round(hrsSoFar[e.id] * 10) / 10]));
  });
  sh.getRange(1, 1, rows.length, hdr.length).setValues(rows);
  sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff');
  sh.setFrozenRows(1); sh.setFrozenColumns(4);
  var cov = ss.insertSheet('COVERAGE');
  var cr = [['วันที่', 'ไฟลท์', 'demand (slot-คน)', 'ขาด', 'ช่วงหนักสุด', 'สถานะ']];
  coverage.forEach(function (c) { cr.push([c.day, c.nFlt, c.demand, c.short, c.worst, c.ok ? '✅ ครบ' : '⚠️ ขาด']); });
  cov.getRange(1, 1, cr.length, 6).setValues(cr);
  cov.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff'); cov.setFrozenRows(1);
  if (issues.length) {
    var iss = ss.insertSheet('ISSUES');
    var ir = [['ระดับ', 'รายละเอียด']].concat(issues.map(function (x) { return [x.severity, x.msg]; }));
    iss.getRange(1, 1, ir.length, 2).setValues(ir);
    iss.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#c0392b').setFontColor('#fff'); iss.setFrozenRows(1);
  }
  return ss.getUrl();
}
