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
  { name: 'JQ/AI/HO/IT/IX',                 airlines: ['AI', 'IX', 'JQ', 'IT'] },
  { name: 'AK/8M/QZ',                       airlines: ['AK', 'QZ', '8M'] },
  { name: 'SQ/CX/LY',                       airlines: ['SQ', 'CX', 'LY'] },
  { name: 'ZF/EO/WZ/HX/HH/LO/G2/S7/HB/H4',  airlines: ['HH', 'LO', 'G2', 'H4', 'C6', 'ZF', 'WZ', 'EO', 'N4', 'HB', 'S7'] },
  { name: 'EK/UO/FY/6B/BY',                 airlines: ['EK', '6B', 'BY', 'FY', 'UO'] },
  { name: 'QR/MH/OM/DE',                    airlines: ['QR', 'MH', 'DE', 'OM'] },
  { name: 'CHN',                            airlines: ['3U', 'CA', 'ZH', 'CZ', 'HU', 'PN', 'FM', 'MU', '9H', 'OQ', 'BK', 'AQ', 'HO', 'GX', 'HX'] },
  { name: 'KE/LJ/OV/KC/AF/NO',              airlines: ['KE', 'KC', 'AF', 'OZ', 'LJ', 'OV', 'NO', 'BK', 'AQ'] },
  { name: 'VIP',                            airlines: [], sys: ['Gonow', 'ASTRA', 'TWD', 'iPort', 'TravelSky', 'Angel Lite'] },
  { name: 'TR/3K/QP',                       airlines: ['TR', '6E', 'QP', '3K'] },
  { name: 'WY/9C/DK/G9',                    airlines: ['WY', 'G9', 'DK', '9C'] },
  { name: 'PG',                             airlines: ['PG'] },
  { name: 'SU/W5/B2',                       airlines: ['W5', 'SU', 'B2'] },
  { name: 'TK/OD/SG/VJ/HY/N0',              airlines: ['TK', 'HY', 'VN', 'SG', 'N0', 'VJ', 'OD'] },
  { name: 'EY/AY/DV',                       airlines: ['AY', 'EY', 'DV'] },
  { name: 'SV/WK/KA',                       airlines: ['SV', 'WK', 'KA'] },
];
var ADV_AIRLINE_TEAMS = (function () { var m = {}; ADV_TEAMS.forEach(function (t, i) { t.airlines.forEach(function (a) { (m[a] = m[a] || []).push(i); }); }); return m; })();
var ADV_VIP_IDX = (function () { for (var i = 0; i < ADV_TEAMS.length; i++) if (ADV_TEAMS[i].name === 'VIP') return i; return -1; })();
// SU เช็คอินคอมมอน 16 เคาน์เตอร์
var ADV_SU_COUNTERS = ['G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'H2', 'H3', 'H4', 'H5', 'H6'];
/** จับคนเข้าทีมทางการจากสตริง "ทีม" ใน Total (เลือกทีมที่สายการบินทับซ้อนมากสุด) */
function advTeamIdxOf_(teamStr) {
  var t = String(teamStr || '').toUpperCase();
  if (/\bVIP\b|PRIVATE|\bPVT\b/.test(t)) return ADV_VIP_IDX;            // ทีม VIP (ใช้ได้หลายระบบ)
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
      if (seen[flight]) return; seen[flight] = 1;
      out.push({ flight: flight, airline: airline, STA: advHHMM_(row[4]), STD: advHHMM_(row[5]), gate: String(row[15] == null ? '' : row[15]).trim(), OP: '', CL: '' });
    });
  });
  return out;
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
    var sc = apScore_(p, role.sc, null) + (f.homeTeam[p.teamIdx] ? 0 : 8); // ทีมเจ้าของไฟลท์มาก่อนเสมอ
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

/** SU เช็คอินคอมมอน: แบ่งคน SU นั่ง 16 เคาน์เตอร์ตามแบทช์เวลา (รวมไฟลท์ที่ช่วงเช็คอินซ้อนกัน)
 *  คืน [{time, flights, nAvail, slots:[{counter, chosen, cands}]}] หรือ null ถ้าไม่มีไฟลท์ SU */
function advSUCounters_(pool, flights) {
  var suIdx = advTeamIdxOf_('SU/W5/B2');
  var suFl = flights.filter(function (f) { return slaAirlineOf_(f.flight) === 'SU' && acIsFlight_(f.flight); });
  suFl.forEach(function (f) { f.cwin = slaPhaseWindow_(f, 'CI'); });
  suFl = suFl.filter(function (f) { return f.cwin; }).sort(function (a, b) { return a.cwin[0] - b.cwin[0]; });
  if (!suFl.length) return null;
  var batches = [];
  suFl.forEach(function (f) {                                          // รวมไฟลท์ที่ช่วงเช็คอินซ้อน/ติดกัน = แบทช์เดียว
    var b = batches[batches.length - 1];
    if (b && f.cwin[0] <= b.end + 20) { b.end = Math.max(b.end, f.cwin[1]); b.flights.push(f.flight); }
    else batches.push({ start: f.cwin[0], end: f.cwin[1], flights: [f.flight] });
  });
  var su = pool.filter(function (p) { return p.teamIdx === suIdx; }), pr = { PSA: 0, SNR: 1, PSS: 2 };
  return batches.map(function (b) {
    var avail = su.filter(function (p) { return p.ds <= b.start + AP_TOL && p.de >= b.end - AP_TOL; })  // กะคลุมช่วงแบทช์
      .sort(function (a, c) { return (pr[a.posGroup] == null ? 3 : pr[a.posGroup]) - (pr[c.posGroup] == null ? 3 : pr[c.posGroup]) || a.plan - c.plan; });
    var cands = avail.map(function (p) { return { name: p.name, pos: slaPosShort_(p.posGroup), shift: p.shiftDisp }; });
    var slots = ADV_SU_COUNTERS.map(function (ct, i) {
      var p = avail[i];
      return { counter: ct, chosen: p ? { name: p.name, pos: slaPosShort_(p.posGroup), shift: p.shiftDisp } : null, cands: cands };
    });
    return { time: rrFmtMin_(((b.start % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((b.end % 1440) + 1440) % 1440),
      flights: b.flights.join(', '), nAvail: avail.length, slots: slots };
  });
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

  var plan = [];
  flights.forEach(function (f) {
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

  var suCounters = advSUCounters_(pool, flights);
  var bench = pool.filter(function (p) { return p.plan === 0; })
    .map(function (p) { return { id: p.id, name: p.name, pos: slaPosShort_(p.posGroup), team: p.team, shift: p.shiftDisp }; });
  return { plan: plan, bench: bench, pool: pool, suCounters: suCounters, nPeople: pool.length,
    nAssigned: pool.filter(function (p) { return p.plan > 0; }).length, nFlights: plan.length };
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
    var suHtml = '';
    if (plan.suCounters && plan.suCounters.length) {
      suHtml = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>🛄 SU — เช็คอินคอมมอน 16 เคาน์เตอร์ (แบ่งคนตามช่วงเวลา)</h3></div>';
      plan.suCounters.forEach(function (b) {
        var filled = b.slots.filter(function (s) { return s.chosen; });
        suHtml += '<div class="sectionlabel" style="margin:8px 14px 2px">⏱️ ช่วง <b>' + rbEsc_(b.time) + '</b> · ไฟลท์ ' + rbEsc_(b.flights) +
          ' · คนว่าง <b>' + b.nAvail + '</b> · ใช้เคาน์เตอร์ ' + filled.length + '/16</div>' +
          '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>เคาน์เตอร์</th><th>พนักงาน (เลือกได้)</th><th>ตำแหน่ง</th><th>กะ</th></tr></thead><tbody>';
        b.slots.forEach(function (s) {
          if (!s.chosen) return;
          var sel = '<select class="namepick">' + s.cands.map(function (c) {
            return '<option' + (c.name === s.chosen.name ? ' selected' : '') + '>' + rbEsc_(c.name + ' · ' + c.pos + ' · ' + c.shift) + '</option>';
          }).join('') + '</select>';
          suHtml += '<tr><td class="b">' + rbEsc_(s.counter) + '</td><td>' + sel + '</td><td>' + rbEsc_(s.chosen.pos) + '</td><td class="tnum">' + rbEsc_(s.chosen.shift) + '</td></tr>';
        });
        suHtml += '</tbody></table></div>';
      });
      suHtml += '</div>';
    }
    return datebar + hd + tbl + suHtml + benchHtml;
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
