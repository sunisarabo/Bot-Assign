/**
 * RosterGen.gs — สร้างตารางกะ (M/A/N/OFF) ทั้งเดือนอัตโนมัติ
 * =============================================================================
 * หลักการ (ตาม skill roster-schedule-maker): Coverage-first → Fairness → Compliance
 *   1) prefill ของที่ fix (v1: ยังไม่ import ลา/เทรน — ต่อยอดภายหลัง)
 *   2) ไล่ทีละวัน: จัด N ก่อน (pool เล็กสุด) → A → M ให้ครบ min · ที่เหลือ = OFF
 *   3) เลือกคน: ทำกะนั้นน้อยสุด + คืนน้อยสุด + weekend-off สมดุล · กัน N→M (พัก<11ชม.) · กันทำติดเกิน max
 *   4) validate: coverage / fairness gap / ทำติดเกิน → รายงาน issues
 *
 * กฎ (min ต่อกะ · เวลา · pattern) แก้ได้ในชีต "ROSTER CONFIG" — ops ต้องตั้งค่าจริงก่อนใช้
 *
 * Entry:
 *   rosSetupConfig()               → สร้าง/เปิดชีตกฎ (คืน URL)
 *   rosGenerateMonth(year, month)  → สร้าง roster เดือนนั้น เขียนชีตใหม่ · คืน { url, coverage, fairness, issues }
 */

var ROS_CFG_TAB = 'ROSTER CONFIG';
var ROS_CFG_PROP = 'ROSTER_CFG_ID';
var ROS_SHIFTS = ['N', 'A', 'M'];                 // ลำดับจัด: Night ก่อน (pool เล็กสุด)

function rosCfgId_() { try { return String(PropertiesService.getScriptProperties().getProperty(ROS_CFG_PROP) || '').trim(); } catch (e) { return ''; } }

/** ค่าเริ่มต้น (placeholder — ops ต้องแก้ให้ตรงจริง) */
function rosDefaults_() {
  return {
    M_in: '06:00', M_out: '14:00', A_in: '14:00', A_out: '22:00', N_in: '22:00', N_out: '06:00',
    min_M_wd: 10, min_A_wd: 8, min_N_wd: 4,       // วันธรรมดา
    min_M_we: 12, min_A_we: 10, min_N_we: 4,      // เสาร์-อาทิตย์ (ปรับตาม demand จริง)
    max_consecutive: 6, off_per_week: 1
  };
}

/** สร้าง/เปิดชีตกฎ ROSTER CONFIG · คืน URL */
function rosSetupConfig() {
  var id = rosCfgId_(), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = rbCreateSheet_('PAS — ROSTER CONFIG (กฎจัดตารางกะ)');
    try { PropertiesService.getScriptProperties().setProperty(ROS_CFG_PROP, ss.getId()); } catch (e1) {}
  }
  var cur = rosConfig_();
  var sh = ss.getSheetByName(ROS_CFG_TAB) || ss.insertSheet(ROS_CFG_TAB);
  sh.clear();
  var d = rosDefaults_();
  var rowsCfg = [
    ['กฎจัดตารางกะ — แก้ค่าคอลัมน์ Value แล้วรัน rosGenerateMonth ใหม่ (min = คนขั้นต่ำต่อกะ · wd=วันธรรมดา · we=เสาร์อาทิตย์)', ''],
    ['Key', 'Value'],
    ['M_in', cur.M_in || d.M_in], ['M_out', cur.M_out || d.M_out],
    ['A_in', cur.A_in || d.A_in], ['A_out', cur.A_out || d.A_out],
    ['N_in', cur.N_in || d.N_in], ['N_out', cur.N_out || d.N_out],
    ['min_M_wd', cur.min_M_wd || d.min_M_wd], ['min_A_wd', cur.min_A_wd || d.min_A_wd], ['min_N_wd', cur.min_N_wd || d.min_N_wd],
    ['min_M_we', cur.min_M_we || d.min_M_we], ['min_A_we', cur.min_A_we || d.min_A_we], ['min_N_we', cur.min_N_we || d.min_N_we],
    ['max_consecutive', cur.max_consecutive || d.max_consecutive], ['off_per_week', cur.off_per_week || d.off_per_week]
  ];
  sh.getRange(1, 1, rowsCfg.length, 2).setValues(rowsCfg);
  sh.getRange(1, 1, 1, 2).merge().setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff').setWrap(true);
  sh.getRange(2, 1, 1, 2).setFontWeight('bold').setBackground('#dce9f7').setFontColor('#1f4e79');
  sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 100); sh.setFrozenRows(2);
  return ss.getUrl();
}

/** อ่านกฎจากชีต (ไม่มี = default) */
function rosConfig_() {
  var d = rosDefaults_(), id = rosCfgId_();
  if (!id) return d;
  try {
    var sh = SpreadsheetApp.openById(id).getSheetByName(ROS_CFG_TAB);
    if (!sh) return d;
    var vals = sh.getDataRange().getValues(), out = {};
    for (var i = 0; i < vals.length; i++) {
      var k = String(vals[i][0] == null ? '' : vals[i][0]).trim();
      if (!k || k === 'Key') continue;
      var v = vals[i][1];
      out[k] = /min_|max_|off_/.test(k) ? (parseInt(String(v).replace(/[^0-9-]/g, ''), 10) || d[k]) : (String(v || '').trim() || d[k]);
    }
    Object.keys(d).forEach(function (k) { if (out[k] == null) out[k] = d[k]; });
    return out;
  } catch (e) { return d; }
}

// ─── engine ──────────────────────────────────────────────────────────────────
function rosDemand_(cfg, dow) {                    // dow: 0=Sun..6=Sat → min ต่อกะ
  var we = (dow === 0 || dow === 6);
  return { M: we ? cfg.min_M_we : cfg.min_M_wd, A: we ? cfg.min_A_we : cfg.min_A_wd, N: we ? cfg.min_N_we : cfg.min_N_wd };
}
function rosConsecutive_(arr, day) {               // จำนวนวันทำติดกันก่อนถึง day
  var n = 0;
  for (var i = day - 1; i >= 0; i--) { if (arr[i] && arr[i] !== 'OFF') n++; else break; }
  return n;
}
function rosMaxConsecutive_(arr) {
  var mx = 0, cur = 0;
  for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i] !== 'OFF') { cur++; if (cur > mx) mx = cur; } else cur = 0; }
  return mx;
}

/** สร้าง roster เดือน (year, month=1-12) — คืน { url, coverage, fairness, issues } */
function rosGenerateMonth(year, month) {
  year = +year; month = +month;
  var days = new Date(year, month, 0).getDate();   // จำนวนวันในเดือน
  var cfg = rosConfig_();
  var empMap = (typeof advReadEmployees_ === 'function') ? advReadEmployees_() : {};
  var emps = Object.keys(empMap).map(function (id) { return empMap[id]; })
    .filter(function (e) { return e.active !== false && e.name; })
    .sort(function (a, b) { return String(a.team).localeCompare(String(b.team)) || String(a.name).localeCompare(String(b.name)); });
  if (!emps.length) throw new Error('ไม่พบรายชื่อพนักงาน (ตรวจ ADV_EMP_ID / ชีต Total)');

  var roster = {}, cntShift = {}, cntNight = {}, cntWeOff = {};
  emps.forEach(function (e) { roster[e.id] = new Array(days).fill(''); cntShift[e.id] = { M: 0, A: 0, N: 0 }; cntNight[e.id] = 0; cntWeOff[e.id] = 0; });

  var issues = [];
  for (var day = 0; day < days; day++) {
    var dow = new Date(year, month - 1, day + 1).getDay();
    var isWe = (dow === 0 || dow === 6);
    var dem = rosDemand_(cfg, dow);
    ROS_SHIFTS.forEach(function (shift) {
      var need = dem[shift] - rosCountAssigned_(roster, day, shift);
      while (need > 0) {
        var pick = rosPick_(emps, roster, cntShift, cntNight, cntWeOff, day, shift, isWe, cfg);
        if (!pick) { issues.push({ severity: 'HIGH', day: day + 1, msg: 'วันที่ ' + (day + 1) + ' กะ ' + shift + ' ขาด ' + need + ' คน' }); break; }
        roster[pick.id][day] = shift; cntShift[pick.id][shift]++; if (shift === 'N') cntNight[pick.id]++;
        need--;
      }
    });
    emps.forEach(function (e) { if (roster[e.id][day] === '') { roster[e.id][day] = 'OFF'; if (isWe) cntWeOff[e.id]++; } });
  }

  // validate
  var coverage = [];
  for (var dd = 0; dd < days; dd++) {
    var dw = new Date(year, month - 1, dd + 1).getDay(), dm = rosDemand_(cfg, dw);
    var row = { day: dd + 1, M: rosCountAssigned_(roster, dd, 'M'), A: rosCountAssigned_(roster, dd, 'A'), N: rosCountAssigned_(roster, dd, 'N'), min: dm };
    row.ok = row.M >= dm.M && row.A >= dm.A && row.N >= dm.N;
    coverage.push(row);
  }
  emps.forEach(function (e) {
    var mc = rosMaxConsecutive_(roster[e.id]);
    if (mc > cfg.max_consecutive) issues.push({ severity: 'HIGH', msg: e.name + ' ทำติด ' + mc + ' วัน (max ' + cfg.max_consecutive + ')' });
  });
  var nights = emps.map(function (e) { return cntNight[e.id]; });
  var nGap = (Math.max.apply(null, nights) || 0) - (Math.min.apply(null, nights) || 0);
  if (nGap > 3) issues.push({ severity: 'MED', msg: 'Night กระจายต่างกัน ' + nGap + ' คืน (เป้า ≤3)' });

  var url = rosWriteSheet_(roster, emps, year, month, days, coverage, issues, cntNight);
  var fairness = emps.map(function (e) {
    var work = roster[e.id].filter(function (x) { return x !== 'OFF'; }).length;
    return { name: e.name, team: e.team, work: work, off: days - work, night: cntNight[e.id], weOff: cntWeOff[e.id] };
  });
  return { url: url, days: days, people: emps.length, coverage: coverage, fairness: fairness, issues: issues };
}

function rosCountAssigned_(roster, day, shift) {
  var n = 0; for (var id in roster) if (roster[id][day] === shift) n++; return n;
}
/** เลือกคนที่เหมาะสุดสำหรับกะ shift วัน day */
function rosPick_(emps, roster, cntShift, cntNight, cntWeOff, day, shift, isWe, cfg) {
  var best = null, bs = 1e9;
  for (var i = 0; i < emps.length; i++) {
    var e = emps[i], arr = roster[e.id];
    if (arr[day] !== '') continue;                                  // จัดแล้ว
    if (rosConsecutive_(arr, day) >= cfg.max_consecutive) continue; // ทำติดครบแล้ว → ต้อง OFF
    if (shift === 'M' && day > 0 && arr[day - 1] === 'N') continue; // กัน N→M (พัก < 11 ชม.)
    var sc = 0;
    sc += cntShift[e.id][shift] * 2;                                // ทำกะนี้มาแล้วเยอะ → คะแนนแย่
    if (shift === 'N') sc += cntNight[e.id] * 2;                    // คืนเยอะ → เลี่ยง
    if (isWe) sc += cntWeOff[e.id] * -1;                            // เคยหยุด weekend น้อย → ให้ทำ weekend (เก็บ OFF ไว้คนที่ยังไม่ได้หยุด)
    if (sc < bs) { bs = sc; best = e; }
  }
  return best;
}
/** เขียน roster + รายงาน ลงชีตใหม่ · คืน URL */
function rosWriteSheet_(roster, emps, year, month, days, coverage, issues, cntNight) {
  var MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var ss = rbCreateSheet_('Roster ' + MON[month - 1] + ' ' + year + ' (auto)');
  var sh = ss.getSheets()[0]; sh.setName('ROSTER');
  var hdr = ['Emp ID', 'Name', 'Team', 'Pos'];
  for (var dd = 1; dd <= days; dd++) hdr.push(String(dd));
  hdr.push('Work', 'OFF', 'N');
  var rows = [hdr];
  emps.forEach(function (e) {
    var arr = roster[e.id], work = arr.filter(function (x) { return x !== 'OFF'; }).length;
    rows.push([e.id, e.name, e.team, e.pos].concat(arr).concat([work, days - work, cntNight[e.id]]));
  });
  sh.getRange(1, 1, rows.length, hdr.length).setValues(rows);
  sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff');
  sh.setFrozenRows(1); sh.setFrozenColumns(4);
  // coverage sheet
  var cov = ss.insertSheet('COVERAGE');
  var cr = [['วันที่', 'M', 'A', 'N', 'min M/A/N', 'สถานะ']];
  coverage.forEach(function (c) { cr.push([c.day, c.M, c.A, c.N, c.min.M + '/' + c.min.A + '/' + c.min.N, c.ok ? '✅' : '⚠️ ขาด']); });
  cov.getRange(1, 1, cr.length, 6).setValues(cr);
  cov.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff'); cov.setFrozenRows(1);
  // issues sheet
  if (issues.length) {
    var iss = ss.insertSheet('ISSUES');
    var ir = [['ระดับ', 'รายละเอียด']].concat(issues.map(function (x) { return [x.severity, x.msg]; }));
    iss.getRange(1, 1, ir.length, 2).setValues(ir);
    iss.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#c0392b').setFontColor('#fff'); iss.setFrozenRows(1);
  }
  return ss.getUrl();
}
