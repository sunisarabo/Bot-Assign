/**
 * FormSetup.gs — พัฒนา "ฟอร์ม Assignment รายวัน" ให้กรอกถูก + เพิ่ม MODE เคาน์เตอร์ + รวมไฟลท์
 * =============================================================================
 * ฟอร์มรายวัน: แถว=คน · คอลัมน์=ไฟลท์ (หัวไฟลท์แถว3 · STA/STD แถว4 · OP/CL แถว5 · Job1-4 แถว6 · คนแถว7+)
 *
 * ฟังก์ชันหลัก (รันบนไฟล์ Assignment):
 *   formSetupForm(ssId)      — เติม dropdown ตำแหน่งตามระบบสาย (กันกรอกผิด) + MODE เคาน์เตอร์ (แถว2)
 *   formBuildAllFlights(ssId)— สร้างแท็บ "ALL FLIGHTS" รวมทุกไฟลท์ทุกทีม (ไฟลท์/เวลา/OP-CL/MODE/คนต่อเฟส)
 *   formSetupAll(ssId)       — ทำทั้งสองอย่าง
 *   (ssId ว่าง = ใช้ไฟล์ roster ของวันนี้อัตโนมัติ)
 */

var FORM_MODE_OPTS = ['ปกติ (เคาน์เตอร์แยก)', 'Common check-in'];   // ประเภทการเปิดเคาน์เตอร์ต่อไฟลท์

/** โค้ดตำแหน่งที่ใช้ได้ต่อ "ระบบเช็คอิน" (แก้/เพิ่มได้) — ใช้ทำ dropdown กันกรอกผิด */
var FORM_POS_CODES = {
  _common: ['SOD', 'FC', 'SUP', 'GA', 'GC', 'GB', 'GM', 'GK', 'PFD', 'ARR', 'ARR/GATE', 'CIQ', 'BIR', 'MEET', 'TF', 'CREW', 'CRW', 'AC', 'IPAD', 'STBY', 'RF', 'DEBRIEF', 'SUM', 'การเงิน',
    'TRAINING', 'TRAINING ครึ่งเช้า', 'TRAINING ครึ่งบ่าย', 'กิจกรรม', 'ประชุม', 'MEETING', 'E-LEARNING', 'OJT'],   // อบรม/กิจกรรม → ไม่นับคุมไฟลท์ (ครึ่งวันใส่ในไฟลท์ช่วงนั้น · เต็มวันใส่ช่องเดียว)
  'Altea':     ['J1', 'J2', 'Y1', 'Y2', 'Y3', 'Y4', 'WEB1', 'WEB2', 'WEB3', 'F1', 'B1', 'B2', 'PRIO', 'KSK', 'BAG DROP', 'PSC', 'WEL GST'],
  'iPort':     ['CT1', 'CT2', 'CT3', 'CT4', 'WEB', 'PRIO', 'KSK'],
  'Sabre':     ['CT1', 'CT2', 'CT3', 'CT4', 'WEB', 'PRIO'],
  'TravelSky': ['CT1', 'CT2', 'CT3', 'CT4', 'GATE'],
  'Gonow':     ['CT1', 'CT2', 'CT3', 'CT4', 'WEB'],
  'AS Connect':['J1', 'J2', 'Y1', 'Y2', 'WEB1', 'WEB2', 'WEB3', 'PRIO', 'F1'],
  'ASTRA':     ['CT1', 'CT2', 'CT3', 'CT4'],
  'Angel Lite':['CT1', 'CT2', 'CT3', 'CT4', 'GATE']
};

/** รายชื่อโค้ดสำหรับสายที่ใช้ระบบนั้น (รวม _common) */
function formCodesForSystem_(system) {
  var sys = FORM_POS_CODES[system] || [];
  return FORM_POS_CODES._common.concat(sys).filter(function (v, i, a) { return a.indexOf(v) === i; });
}

/** ตรวจจับคอลัมน์ไฟลท์ในแท็บทีม → [{col(1-based), flight, end}] (หัวไฟลท์แถว 3 หลังคอลัมน์ 'FLIGHT') */
function formDetectFlightCols_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 2) return [];
  var r3 = sheet.getRange(3, 1, 1, lastCol).getValues()[0];
  var fltCol = -1;
  for (var c = 0; c < r3.length; c++) { if (String(r3[c] || '').trim().toUpperCase() === 'FLIGHT') { fltCol = c; break; } }
  if (fltCol < 0) return [];
  var starts = [];
  for (var c2 = fltCol + 1; c2 < r3.length; c2++) {
    var v = String(r3[c2] || '').trim();
    if (v && /(?:[A-Z]{2}|[0-9][A-Z]|[A-Z][0-9])\s*\d{2,4}/i.test(v)) starts.push({ col: c2 + 1, flight: v.replace(/\s/g, '') });   // 1-based
  }
  for (var i = 0; i < starts.length; i++) starts[i].end = (i + 1 < starts.length) ? (starts[i + 1].col - 1) : lastCol;
  return starts;
}

/** ID ไฟล์ Assignment: ใช้ที่ส่งมา หรือหาไฟล์ roster ของวันนี้อัตโนมัติ */
function formOpenSs_(ssId) {
  if (ssId) return SpreadsheetApp.openById(ssId);
  var r = rbOpenTodayRoster_(new Date());
  return r.ss;   // หมายเหตุ: ถ้าเป็น .xlsx จะเป็น temp — แนะนำส่ง ssId ของ Google Sheets โดยตรง
}

/** เติม dropdown ตำแหน่ง (ตามระบบสาย) ที่เซลล์ Job + MODE เคาน์เตอร์ (แถว 2) ให้ทุกแท็บทีม */
function formSetupForm(ssId) {
  var ss = formOpenSs_(ssId);
  var modeRule = SpreadsheetApp.newDataValidation().requireValueInList(FORM_MODE_OPTS, true).setAllowInvalid(true).build();
  var done = 0, nCol = 0;
  ss.getSheets().forEach(function (sh) {
    var nm = sh.getName();
    if (/MANPOWER|MASTER|SHIFTDB|CODE|ALL FLIGHTS/i.test(nm)) return;         // ข้ามแท็บที่ไม่ใช่ทีม
    var flights = formDetectFlightCols_(sh);
    if (!flights.length) return;
    var lastRow = sh.getLastRow();
    flights.forEach(function (f) {
      var air = slaAirlineOf_(f.flight);
      var sys = (typeof slaSystemOf_ === 'function') ? slaSystemOf_(air) : '';
      var codes = formCodesForSystem_(sys);
      var jobRule = SpreadsheetApp.newDataValidation().requireValueInList(codes, true).setAllowInvalid(true)
        .setHelpText('ตำแหน่งระบบ ' + (sys || 'ทั่วไป') + ' — เลือกจากรายการ หรือพิมพ์เพิ่มได้').build();
      var nCols = f.end - f.col + 1;
      // MODE เคาน์เตอร์ที่แถว 2 (ว่างอยู่) เหนือหัวไฟลท์
      sh.getRange(2, f.col).setDataValidation(modeRule);
      if (!sh.getRange(2, f.col).getValue()) sh.getRange(2, f.col).setValue(FORM_MODE_OPTS[0]);   // default ปกติ
      // dropdown ตำแหน่งที่เซลล์ Job (แถว 7 ถึงท้าย)
      if (lastRow >= 7) sh.getRange(7, f.col, lastRow - 6, nCols).setDataValidation(jobRule);
      nCol += nCols; done++;
    });
  });
  Logger.log('เติมฟอร์ม: ' + done + ' ไฟลท์ · ' + nCol + ' คอลัมน์ Job + MODE dropdown แถว 2');
  return 'เติม dropdown ตำแหน่ง + MODE เคาน์เตอร์ ' + done + ' ไฟลท์ เรียบร้อย (แถว 2 = ปกติ/Common check-in)';
}

/** อ่าน MODE เคาน์เตอร์ (แถว 2) ทุกแท็บ → { flightKey: 'Common'/'ปกติ' }
 *  เร็วขึ้น: อ่านแถว 2-3 ครั้งเดียว/แท็บ (เดิม 2 รอบ) · ข้ามเร็วถ้าแถว 2 ว่างทั้งแถว (ยังไม่ได้ตั้ง MODE) */
function formModeIndex_(ss) {
  var out = {};
  ss.getSheets().forEach(function (sh) {
    var nm = sh.getName();
    if (/MANPOWER|MASTER|SHIFTDB|CODE|ALL FLIGHTS|_CODES/i.test(nm)) return;
    var lastCol = sh.getLastColumn(); if (lastCol < 2) return;
    var top = sh.getRange(2, 1, 2, lastCol).getValues();       // แถว 2 (MODE) + แถว 3 (หัวไฟลท์) ในการอ่านครั้งเดียว
    var r2 = top[0], r3 = top[1];
    var hasMode = r2.some(function (v) { return /common|ปกติ/i.test(String(v || '')); });
    if (!hasMode) return;                                       // ยังไม่ได้ตั้ง MODE ในแท็บนี้ → ข้าม (ไม่เสียเวลา)
    var fltCol = -1;
    for (var c = 0; c < r3.length; c++) { if (String(r3[c] || '').trim().toUpperCase() === 'FLIGHT') { fltCol = c; break; } }
    if (fltCol < 0) return;
    for (var c2 = fltCol + 1; c2 < r3.length; c2++) {
      var v = String(r3[c2] || '').trim();
      if (v && /(?:[A-Z]{2}|[0-9][A-Z]|[A-Z][0-9])\s*\d{2,4}/i.test(v)) {
        var m = String(r2[c2] || '').trim();
        if (m) out[slaFlightKey_(v.replace(/\s/g, ''))] = /common/i.test(m) ? 'Common check-in' : 'ปกติ';
      }
    }
  });
  return out;
}

/** สร้าง/รีเฟรชแท็บ "ALL FLIGHTS" — รวมทุกไฟลท์ทุกทีมในไฟล์เดียว (ไฟลท์/เวลา/MODE/คนต่อเฟส) */
function formBuildAllFlights(ssId) {
  var ss = formOpenSs_(ssId);
  var date = formSheetDate_(ss) || new Date();
  var res = readRosterFromSpreadsheet(ss, date);
  var modes = formModeIndex_(ss);
  var flights = slaCollectFlights_(res, null).filter(function (f) { return !(f.noTime && f.fragment); });
  flights.sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });

  var tab = 'ALL FLIGHTS';
  var old = ss.getSheetByName(tab); if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tab, 0);
  var head = ['Flight', 'สายการบิน', 'ระบบ', 'ทีม', 'STA', 'STD', 'MODE เคาน์เตอร์', 'A/C', 'SUP', 'Check-in', 'Gate', 'Arrival', 'รวมคน', 'สถานะ SLA'];
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff');
  var rows = flights.map(function (f) {
    function cell(p) { return f.assigned[p] + '/' + f.req[p] + (f.short[p] ? ' ⚠️-' + f.short[p] : ''); }
    return [f.flight, f.airline, slaSystemOf_(f.airline), f.teamList || '', f.STA || '', f.STD || '',
      modes[slaFlightKey_(f.flight)] || 'ปกติ', f.AC || '', cell('SUP'), cell('CI'), cell('GATE'), cell('ARR'),
      f.assigned.total + '/' + f.req.total, f.ok ? '✔ ครบ' : (typeof slaShortText_ === 'function' ? slaShortText_(f) : 'ขาด')];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.setFrozenRows(1);
  [95, 90, 80, 90, 60, 60, 130, 90, 60, 80, 60, 70, 70, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  Logger.log('ALL FLIGHTS: ' + rows.length + ' ไฟลท์');
  return 'สร้างแท็บ ALL FLIGHTS แล้ว — ' + rows.length + ' ไฟลท์ (พร้อม MODE เคาน์เตอร์ + คนต่อเฟส)';
}

/** วันที่จากหัวชีต ("วันที่ 22/JUL/2026") — เอา "วันที่ที่พบบ่อยสุด" ทุกแท็บ (กัน 1 แท็บกรอกผิด) หรือ null */
function formSheetDate_(ss) {
  var MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  var sheets = ss.getSheets(), tally = {};
  sheets.forEach(function (sh) {
    if (/MANPOWER|MASTER|SHIFTDB|CODE|ALL FLIGHTS/i.test(sh.getName())) return;
    try {
      var txt = String(sh.getRange(1, 1, 2, Math.min(16, sh.getLastColumn() || 16)).getValues().join(' '));
      var m = txt.match(/(?:วันที่|DATE)\D*?(\d{1,2})\s*[\/\-]\s*([A-Zก-๙]{3,})\s*[\/\-]?\s*(\d{2,4})/i);
      if (m) { var mo = MON[m[2].slice(0, 3).toUpperCase()]; var y = +m[3]; if (y < 100) y += 2000;
        if (mo != null) { var k = y + '-' + mo + '-' + (+m[1]); tally[k] = (tally[k] || 0) + 1; } }
    } catch (e) {}
  });
  var best = null, bn = 0;
  Object.keys(tally).forEach(function (k) { if (tally[k] > bn) { bn = tally[k]; best = k; } });
  if (!best) return null;
  var p = best.split('-'); return new Date(+p[0], +p[1], +p[2]);
}

/** ทำทั้งเติมฟอร์ม + สร้างแท็บรวม */
function formSetupAll(ssId) {
  var a = formSetupForm(ssId);
  var b = formBuildAllFlights(ssId);
  return a + '\n' + b;
}

/** เติม dropdown+MODE ให้ "ทุกไฟล์ Google Sheets ในโฟลเดอร์" (เช่น โฟลเดอร์เดือน 07.JUL26) รวดเดียว
 *  ใช้: formSetupFolder('1wv7mAQ...')  ·  ถ้าไฟล์เยอะ/หมดเวลา ให้ส่ง onlyNewer เป็น ISO เพื่อทำเฉพาะไฟล์แก้ล่าสุด */
function formSetupFolder(folderId, onlyNewer) {
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  var cut = onlyNewer ? new Date(onlyNewer) : null;
  var done = 0, skip = 0, log = [];
  while (files.hasNext()) {
    var f = files.next();
    if (cut && f.getLastUpdated() < cut) { skip++; continue; }
    try { formSetupForm(f.getId()); done++; log.push('✓ ' + f.getName()); }
    catch (e) { log.push('✗ ' + f.getName() + ': ' + e.message); }
  }
  Logger.log('เติมฟอร์ม ' + done + ' ไฟล์ (ข้าม ' + skip + '):\n' + log.join('\n'));
  return 'เติม dropdown+MODE ให้ ' + done + ' ไฟล์ในโฟลเดอร์ "' + folder.getName() + '"' + (skip ? (' · ข้าม ' + skip) : '');
}

/** เติมฟอร์มให้ "ไฟล์เวรของวันนี้" อัตโนมัติ (หาไฟล์ผ่าน rbOpenTodayRoster_) */
function formSetupToday() {
  var r = rbOpenTodayRoster_(new Date());
  if (r.tempId) throw new Error('ไฟล์เวรวันนี้เป็น .xlsx (ต้องเป็น Google Sheets ถึงจะเติม dropdown ได้)');
  return formSetupForm(r.ss.getId());
}
