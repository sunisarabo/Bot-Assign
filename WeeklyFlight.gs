/**
 * WeeklyFlight.gs — อ่าน "ตารางบินรายสัปดาห์" (Summary Weekly Flight) เป็น source of truth
 * =============================================================================
 * ไฟล์ตารางบินมี A/C TYPE + STA/STD + วันบิน ต่อไฟลท์ ต่อวัน (แท็บ = วันที่ เช่น "17JUL")
 * ปัญหาเดิม: ชีต Assignment คนกรอก A/C TYPE เอง มักลืม → SLA เด้งเป็นลำใหญ่ = false "ขาด"
 * โมดูลนี้: จับคู่ Airline+Flt+วันที่ → เติม A/C TYPE + STA/STD ให้ SLA อัตโนมัติ (ไม่ต้องกรอกมือ)
 *
 * วิธีตั้งค่า:
 *   1) เอาไฟล์ตารางบิน (xlsx) ขึ้น Google Drive แล้วเปิดเป็น Google Sheets (แท็บชื่อวันที่ DDMON)
 *      — จะรวมหลายสัปดาห์ไว้ไฟล์เดียว (หลายแท็บ) ก็ได้ ระบบหาแท็บตามวันที่ให้เอง
 *   2) วาง ID ไฟล์ลงใน WF_FILE_ID ด้านล่าง (เว้นว่าง = ปิดฟีเจอร์ ระบบยังทำงานปกติ)
 *   3) คอลัมน์ที่ระบบอ่าน: Airlines · Flt no. · STA · STD · A/C TYPE · Remarks (หาหัวตารางอัตโนมัติ)
 */

var WF_FILE_ID = '';   // ← ใส่ ID ไฟล์ Google Sheets ตารางบิน (เว้นว่าง = ปิด) · หรือตั้งใน Project Settings → Script Properties คีย์ WF_FILE_ID (ไม่ต้อง deploy ใหม่)

/** ID ไฟล์ตารางบิน — อ่านจาก Script Property 'WF_FILE_ID' ก่อน (ตั้งใน UI ได้) แล้วค่อย fallback ตัวแปรในโค้ด */
function wfFileId_() {
  try { var v = PropertiesService.getScriptProperties().getProperty('WF_FILE_ID'); if (v) return String(v).trim(); } catch (e) {}
  return WF_FILE_ID;
}

/** รหัสเครื่องในตารางบิน (IATA/ICAO) → ชื่อที่ตาราง SLA_AC จับคู่ได้ (slaAcPick_ จับแบบ prefix) */
var WF_AC_MAP = {
  'B789': 'B787-9', 'B788': 'B787-8', 'B78X': 'B787-10', 'B78J': 'B787-10',
  'A21N': 'A321Neo', 'A20N': 'A320Neo', 'A21': 'A321', 'A20': 'A320',
  'B38M': 'B737-8', 'B737M': 'B737-8', 'B7M8': 'B737-8', 'B39M': 'B737-9',
  'B73H': 'B737-800', 'B738': 'B737-800', 'B737': 'B737', 'B735': 'B737-500',
  'AT72': 'ATR72', 'AT75': 'ATR72', 'AT76': 'ATR72', 'ATR': 'ATR72',
  'B773': '777-300', 'B77W': '777-300', 'B777': '777-300', 'B772': '777-200',
  'B763': '767-300', 'B764': '767-400',
  'A333': 'A330', 'A332': 'A330', 'A339': 'A330', 'A330': 'A330',
  'A359': 'A350', 'A35K': 'A350', 'A350': 'A350',
  'A319': 'A319', 'A320': 'A320', 'A321': 'A321',
  'B788F': 'B787-8'
};

/** normalize รหัสเครื่อง → ชื่อ SLA (XXXX/ว่าง/ไม่รู้จัก → '') */
function wfNormAc_(code) {
  var c = String(code == null ? '' : code).trim().toUpperCase().replace(/\s+/g, '');
  if (!c || /^X+$/.test(c) || c === 'TBA' || c === 'TBN') return '';
  if (WF_AC_MAP[c]) return WF_AC_MAP[c];
  // ตัด suffix (เช่น B38M/W) แล้วลองอีกครั้ง
  var base = c.replace(/[^A-Z0-9].*$/, '');
  if (WF_AC_MAP[base]) return WF_AC_MAP[base];
  return c;   // ไม่รู้จัก → ส่งรหัสดิบ (slaAcPick_ จับ prefix ได้บ้าง · ไม่ตรงก็ fallback SLA_RQ)
}

/** "0715"/"07:15"/"7:15" → "07:15" (ว่าง/ไม่ใช่เวลา → '') */
function wfTime_(s) {
  var m = String(s == null ? '' : s).trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}

/** ชื่อแท็บวันที่ที่เป็นไปได้ เช่น 17 ก.ค. → ["17JUL","17 JUL","17JUL2026",...] */
function wfDateTabs_(date) {
  var mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][date.getMonth()];
  var dd = ('0' + date.getDate()).slice(-2), d1 = String(date.getDate());
  var yy = String(date.getFullYear()).slice(-2), yyyy = String(date.getFullYear());
  return [dd + mon, d1 + mon, dd + ' ' + mon, d1 + ' ' + mon, dd + mon + yy, dd + mon + yyyy,
          dd + '-' + mon, dd + '.' + mon, mon + dd, mon + d1, mon + ' ' + dd].map(function (x) { return x.toUpperCase(); });
}

/** map หัวคอลัมน์ → ตำแหน่ง (หา Airlines/Flt/STA/STD/A/C TYPE/Remarks แบบยืดหยุ่น) */
function wfColMap_(values) {
  for (var r = 0; r < Math.min(values.length, 8); r++) {
    var row = values[r].map(function (x) { return String(x == null ? '' : x).trim().toUpperCase(); });
    var cm = {};
    row.forEach(function (h, i) {
      if (/^AIRLINE/.test(h)) cm.air = i;
      else if (/^FL(T|IGHT)?\s*NO|^FLT$/.test(h)) cm.flt = i;
      else if (h === 'STA') cm.sta = i;
      else if (h === 'STD') cm.std = i;
      else if (/A\/?C\s*TYPE|AIRCRAFT/.test(h)) cm.ac = i;
      else if (/^REMARK/.test(h)) cm.rem = i;
      else if (/^ROUTING|^ROUTE/.test(h)) cm.rte = i;
    });
    if (cm.air != null && cm.flt != null && cm.ac != null) { cm.headRow = r; return cm; }
  }
  return null;
}

/** แปลงชีตตารางบิน 1 วัน → ดัชนี { slaFlightKey: {ac,sta,std,routing,cancelled,remark} } (แยกออกมาเพื่อทดสอบได้) */
function wfParseDaySheet_(sheet) {
  var out = {};
  var values = sheet.getDataRange().getValues();
  var cm = wfColMap_(values);
  if (!cm) return out;
  for (var i = cm.headRow + 1; i < values.length; i++) {
    var row = values[i];
    var air = String(row[cm.air] == null ? '' : row[cm.air]).trim().toUpperCase();
    var flt = String(row[cm.flt] == null ? '' : row[cm.flt]).trim();
    if (!air || !flt || !/^[A-Z0-9]{2}$/.test(air) || !/\d/.test(flt)) continue;   // ไม่ใช่แถวไฟลท์
    var raw = air + flt.replace(/\s+/g, '');                                        // "EY" + "410/411" → "EY410/411"
    var key = (typeof slaFlightKey_ === 'function') ? slaFlightKey_(raw) : (air + (flt.match(/\d+/) || [''])[0]);
    var rem = cm.rem != null ? String(row[cm.rem] || '').toUpperCase() : '';
    out[key] = {
      airline: air, flt: flt,
      ac: wfNormAc_(cm.ac != null ? row[cm.ac] : ''),
      sta: wfTime_(cm.sta != null ? row[cm.sta] : ''),
      std: wfTime_(cm.std != null ? row[cm.std] : ''),
      routing: cm.rte != null ? String(row[cm.rte] || '').trim() : '',
      remark: cm.rem != null ? String(row[cm.rem] || '').trim() : '',
      cancelled: /CANCEL/.test(rem)
    };
  }
  return out;
}

/** หาแท็บวันที่ในไฟล์ที่เปิดแล้ว → parse (แยกออกมาเพื่อไม่ต้องเปิดไฟล์ซ้ำ 7 รอบตอนดูทั้งสัปดาห์) */
function wfLoadScheduleFromSs_(ss, date) {
  var want = wfDateTabs_(date).map(function (x) { return x.replace(/\s+/g, ''); });
  var sheet = null;
  ss.getSheets().forEach(function (sh) {
    if (sheet) return;
    var nm = sh.getName().trim().toUpperCase().replace(/\s+/g, '');
    if (want.indexOf(nm) >= 0) sheet = sh;
  });
  return sheet ? wfParseDaySheet_(sheet) : null;
}

/** โหลดตารางบินของวันที่กำหนดจากไฟล์ Google Sheets (หาแท็บตามวันที่) → ดัชนี (ว่าง = ไม่พบ/ปิดฟีเจอร์) */
function wfLoadSchedule_(fileId, date) {
  var id = fileId || wfFileId_();
  if (!id) return null;
  return wfLoadScheduleFromSs_(SpreadsheetApp.openById(id), date);
}

/** จำนวนคนที่ SLA ต้องการของไฟลท์ในตาราง (ไม่ต้องมี roster) — คิดตามชนิดเครื่อง + ขา (STA/STD) */
function wfFlightReq_(flight, ac, sta, std) {
  var airline = (typeof slaAirlineOf_ === 'function') ? slaAirlineOf_(flight) : String(flight).slice(0, 2);
  var req = slaReq_(airline, ac);
  var akNum = (airline === 'AK') ? +((String(flight).match(/\d{3,4}/) || ['0'])[0]) : 0;
  if (akNum >= 1000) return { SUP: req.SUP, CI: 0, GATE: 0, ARR: 0, total: req.SUP, ferry: true };   // ferry → SUP อย่างเดียว
  var dep = slaRealMin_(std), arr = slaRealMin_(sta);
  var hasDep = dep != null, hasArr = arr != null;
  if (hasArr && hasDep && arr === dep) hasArr = false;                                                // STA=STD = RON (ขาออกอย่างเดียว)
  var extra = Math.max(0, (req.total || 0) - (req.SUP + req.CI + req.GATE + req.ARR));
  var CI = req.CI, GATE = req.GATE, ARR = req.ARR;
  if (hasDep || hasArr) { if (!hasDep) { CI = 0; GATE = 0; extra = 0; } if (!hasArr) { ARR = 0; } }
  return { SUP: req.SUP, CI: CI, GATE: GATE, ARR: ARR, total: req.SUP + CI + GATE + ARR + extra };
}

/** คนโดยประมาณ (distinct bodies) ต่อไฟลท์ = SUP + max(เช็คอิน,เกท) + Arrival (เกทมักใช้คนเช็คอินต่อ) */
function wfBodies_(r) { return (r.SUP || 0) + Math.max(r.CI || 0, r.GATE || 0) + (r.ARR || 0); }

/** 7 วันของสัปดาห์ที่มี date (เริ่มวันจันทร์) → [Date x7] */
function wfWeekDates_(date) {
  var mon = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));                                              // ย้อนไปวันจันทร์
  var out = [];
  for (var i = 0; i < 7; i++) { out.push(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)); }
  return out;
}

/** สรุปตารางบิน 7 วัน (สัปดาห์ที่มี date) → [{date,label,found,flights:[{flight,airline,ac,sta,std,req,cancelled}],tot,bodies,peakHr,peakN}] */
function wfWeekSummary_(fileId, date) {
  var id = fileId || wfFileId_();
  if (!id) return null;
  var ss; try { ss = SpreadsheetApp.openById(id); } catch (ePerm) { return { _noAccess: id }; }   // เปิดไฟล์ไม่ได้ (สิทธิ์/ID) → คืน sentinel ให้หน้าแสดงวิธีแก้
  var TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var out = wfWeekDates_(date).map(function (d) {
    var sched = null; try { sched = wfLoadScheduleFromSs_(ss, d); } catch (e) {}
    var label = ('0' + d.getDate()).slice(-2) + MON[d.getMonth()] + ' (' + TH[d.getDay()] + ')';
    var iso = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    if (!sched) return { date: iso, label: label, found: false, flights: [], tot: { SUP: 0, CI: 0, GATE: 0, ARR: 0 }, bodies: 0 };
    var flights = [], tot = { SUP: 0, CI: 0, GATE: 0, ARR: 0 }, bodies = 0, hrN = {};
    Object.keys(sched).forEach(function (k) {
      var w = sched[k];
      if (!(typeof acIsFlight_ !== 'function' || acIsFlight_(w.airline + w.flt))) { /* keep */ }
      var req = wfFlightReq_(w.airline + w.flt, w.ac, w.sta, w.std);
      flights.push({ flight: w.airline + w.flt, airline: w.airline, ac: w.ac || '', sta: w.sta, std: w.std, req: req, cancelled: w.cancelled });
      if (w.cancelled) return;
      ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (p) { tot[p] += req[p] || 0; });
      bodies += wfBodies_(req);
      var hr = (w.std || w.sta || '').slice(0, 2); if (hr) hrN[hr] = (hrN[hr] || 0) + 1;               // พีค = ชั่วโมงที่มีบินออกมากสุด
    });
    flights.sort(function (a, b) { return String(a.std || a.sta || 'zz').localeCompare(String(b.std || b.sta || 'zz')); });
    var peakHr = '', peakN = 0; Object.keys(hrN).forEach(function (h) { if (hrN[h] > peakN) { peakN = hrN[h]; peakHr = h; } });
    return { date: iso, label: label, found: true, flights: flights, tot: tot, bodies: bodies, peakHr: peakHr, peakN: peakN,
      nFlt: flights.filter(function (f) { return !f.cancelled; }).length, nCancel: flights.filter(function (f) { return f.cancelled; }).length };
  });
  try { out._tabsPresent = ss.getSheets().map(function (sh) { return sh.getName(); })   // แท็บที่มีจริงในไฟล์ (ไว้ diag ตอนหาแท็บวันไม่เจอ)
      .filter(function (n) { return /\d/.test(n) && /[A-Za-z]/.test(n); }).slice(0, 24); } catch (e) {}
  return out;
}

/** เติม A/C TYPE + STA/STD จากตารางบินให้ไฟลท์ที่ยังไม่มี (เรียกใน slaCollectFlights_) — คืนจำนวนที่เติม */
function wfEnrichFlight_(f, sched) {
  if (!sched || !f) return;
  var w = sched[(typeof slaFlightKey_ === 'function') ? slaFlightKey_(f.flight) : f.flight];
  if (!w) return;
  if ((!f.AC || f.AC === '') && w.ac) { f.AC = w.ac; f.acFromSched = true; }
  if ((!f.STA || f.STA === '') && w.sta) f.STA = w.sta;
  if ((!f.STD || f.STD === '') && w.std) f.STD = w.std;
  if (w.cancelled) f.schedCancelled = true;   // แจ้งเตือน (ยังไม่ตัด SLA อัตโนมัติ กันตารางระบุกำกวม)
}

/** เทียบตารางบิน 2 วัน/สัปดาห์ → รายการที่เปลี่ยน (เวลา/เครื่อง/ยกเลิก/เพิ่มใหม่/หาย) */
function wfDiff_(oldSched, newSched) {
  var chg = [];
  oldSched = oldSched || {}; newSched = newSched || {};
  Object.keys(newSched).forEach(function (k) {
    var n = newSched[k], o = oldSched[k];
    if (!o) { chg.push({ key: k, flt: n.airline + n.flt, type: 'ใหม่', detail: (n.ac || '') + ' ' + (n.std || n.sta || '') }); return; }
    if (o.ac !== n.ac && n.ac && o.ac) chg.push({ key: k, flt: n.airline + n.flt, type: 'เปลี่ยนเครื่อง', detail: o.ac + ' → ' + n.ac });
    if ((o.sta !== n.sta && o.sta && n.sta) || (o.std !== n.std && o.std && n.std))
      chg.push({ key: k, flt: n.airline + n.flt, type: 'เปลี่ยนเวลา', detail: (o.sta || '–') + '/' + (o.std || '–') + ' → ' + (n.sta || '–') + '/' + (n.std || '–') });
    if (n.cancelled && !o.cancelled) chg.push({ key: k, flt: n.airline + n.flt, type: 'ยกเลิก', detail: n.remark });
  });
  Object.keys(oldSched).forEach(function (k) {
    if (!newSched[k]) chg.push({ key: k, flt: oldSched[k].airline + oldSched[k].flt, type: 'หายไป', detail: '' });
  });
  return chg;
}

/** คีย์เรียงแท็บวันที่ "13JUL"/"01AUG" → เลข (เดือน*100+วัน) เรียงตามปฏิทิน */
function wfTabSortKey_(name) {
  var MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  var m = String(name || '').toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2})([A-Z]{3})/);
  return (m && MON[m[2]]) ? (MON[m[2]] * 100 + (+m[1])) : 9999;
}

/**
 * รวมไฟล์ตารางบินหลายไฟล์ (xlsx/Google Sheets) → ชีตเดียว (แท็บ=วันที่ DDMON) แล้วตั้ง WF_FILE_ID ให้อัตโนมัติ
 *   sourceIdsCsv : ID ไฟล์ตารางบิน คั่นด้วยจุลภาค เช่น "1aaa,1bbb,1ccc,1ddd,1eee" (รับ .xlsx หรือ Google Sheets)
 *   targetId     : (ว่าง = สร้างไฟล์ใหม่ "PAS Flight Schedule" · มี = เพิ่มแท็บลงไฟล์เดิม)
 *  ต้องเปิด Advanced Service "Drive API" (Services → Drive) เพื่อแปลง .xlsx
 */
function wfBuildScheduleSheet(sourceIdsCsv, targetId) {
  var ids = String(sourceIdsCsv || '').split(/[,\s]+/).filter(Boolean);
  if (!ids.length) throw new Error('ใส่ ID ไฟล์ตารางบิน (คั่นด้วยจุลภาค) เป็นอาร์กิวเมนต์แรก เช่น wfBuildScheduleSheet("1aaa,1bbb,...")');
  var target = targetId ? SpreadsheetApp.openById(targetId) : SpreadsheetApp.create('PAS Flight Schedule (รวม)');
  var existing = {}; target.getSheets().forEach(function (sh) { existing[sh.getName().toUpperCase().replace(/\s+/g, '')] = sh; });
  var DDMON = /^\d{1,2}[A-Z]{3}/i, added = 0, skipped = 0, files = 0;
  ids.forEach(function (id) {
    var mime; try { mime = DriveApp.getFileById(id).getMimeType(); } catch (e) { Logger.log('เปิดไม่ได้: ' + id + ' (' + e.message + ')'); return; }
    var opened, tempId = null;
    if (mime === MimeType.GOOGLE_SHEETS) opened = SpreadsheetApp.openById(id);
    else { var tmp = Drive.Files.copy({ title: '_TEMP_WF_' + id, mimeType: MimeType.GOOGLE_SHEETS }, id, { convert: true }); opened = SpreadsheetApp.openById(tmp.id); tempId = tmp.id; }
    files++;
    opened.getSheets().forEach(function (sh) {
      var nm = sh.getName().trim();
      if (!DDMON.test(nm.replace(/\s+/g, ''))) return;            // เฉพาะแท็บวันที่ (ข้ามแท็บอื่น)
      var key = nm.toUpperCase().replace(/\s+/g, '');
      if (existing[key]) { skipped++; return; }                   // มีแท็บวันนี้แล้ว → ข้าม (กันซ้ำข้ามสัปดาห์)
      var copy = sh.copyTo(target); copy.setName(nm); existing[key] = copy; added++;
    });
    if (tempId) { try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) {} }
  });
  var blank = target.getSheetByName('Sheet1') || target.getSheetByName('ชีต1');
  if (blank && target.getSheets().length > 1) { try { target.deleteSheet(blank); } catch (e) {} }
  target.getSheets().slice().sort(function (a, b) { return wfTabSortKey_(a.getName()) - wfTabSortKey_(b.getName()); })
    .forEach(function (sh, i) { target.setActiveSheet(sh); target.moveActiveSheet(i + 1); });   // เรียงแท็บตามวันที่
  try { PropertiesService.getScriptProperties().setProperty('WF_FILE_ID', target.getId()); } catch (e) {}   // ตั้ง WF_FILE_ID ให้เลย
  var msg = 'รวมเสร็จ: ' + files + ' ไฟล์ → เพิ่ม ' + added + ' แท็บ · ข้ามซ้ำ ' + skipped + ' · ตั้ง WF_FILE_ID = ' + target.getId() + '\n' + target.getUrl();
  Logger.log(msg);
  return msg;
}

/** ตรวจสถานะการต่อไฟล์ตารางบิน (รันใน Apps Script เพื่อทดสอบว่าตั้งค่าถูก) */
function wfSelfTest(dateIso) {
  if (!wfFileId_()) return 'ยังไม่ได้ตั้ง WF_FILE_ID (ฟีเจอร์ปิดอยู่) — ใส่ ID ไฟล์ตารางบินที่ตัวแปร WF_FILE_ID หรือ Script Property';
  var d = dateIso ? new Date(dateIso) : new Date();
  var sched = wfLoadSchedule_(wfFileId_(), d);
  if (!sched) return 'เปิดไฟล์ได้ แต่ไม่พบแท็บวันที่ ' + wfDateTabs_(d)[0] + ' (ตรวจชื่อแท็บให้เป็น DDMON เช่น 17JUL)';
  var n = Object.keys(sched).length;
  var sample = Object.keys(sched).slice(0, 5).map(function (k) { return k + '=' + (sched[k].ac || '?') + '/' + (sched[k].std || sched[k].sta || '?'); });
  return 'พบ ' + n + ' ไฟลท์ในตารางบิน ' + wfDateTabs_(d)[0] + ' · ตัวอย่าง: ' + sample.join(', ');
}
