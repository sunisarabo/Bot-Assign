/**
 * DbExport.gs — ส่งออกข้อมูลเวรรายวัน (res) เป็น JSON เพื่อ import เข้า PostgreSQL
 * =============================================================================
 * ใช้เป็น "สะพาน" ช่วงย้ายระบบ: รันตัวอ่านเดิม (readRosterFromSpreadsheet) แล้ว
 * export ออกมาเป็น JSON → ฝั่ง Node (db/import.js) แปลงเป็น SQL ลงตาราง duty/assignment
 * โครง JSON คงที่ (importer อ้างอิงชื่อฟิลด์เหล่านี้)
 */

/** สร้าง JSON ของวันเดียว (PSA teams + ฟิลด์ที่ importer ต้องใช้) */
function rbExportDayObj_(iso) {
  var d = rbLoadResLL_(rbDateFromIso_(iso));
  var af = (typeof acIsFlight_ === 'function') ? acIsFlight_ : function () { return false; };
  var ac = (typeof acIsActivity_ === 'function') ? acIsActivity_ : function () { return false; };
  function recOut(r) {
    return {
      id: r.id || '', name: r.name || '', team: r.team || '', bkk: !!r.bkk,
      support: !!r.support, supportTeam: r.supportTeam || '',
      pos: r.pos || '', reTime: r.re || '', shift: r.shift || '', shiftTime: r.shiftTime || '',
      shiftStart: (r.shiftStart == null ? null : r.shiftStart), shiftHrs: (r.shiftHrs || 0),
      bucket: r.bucket || '', ot: (r.ot || 0), otType: r.otType || null, otSpans: r.otSpans || null,
      remark: r.remark || '', training: !!r.training,
      assignments: (r.assignments || []).map(function (a) {
        return {
          flight: a.flight || '', task: a.task || '', STA: a.STA || '', STD: a.STD || '',
          OP: a.OP || '', CL: a.CL || '', activity: !!(a.activity || ac(a.flight)),
          isFlight: !!af(a.flight), supportOut: !!a.supportOut, supportTeam: a.supportTeam || ''
        };
      })
    };
  }
  var out = { date: iso, sourceFile: (d.res && d.res._fileName) || '', teams: {} };
  Object.keys(d.res.teams || {}).forEach(function (t) {
    out.teams[t] = (d.res.teams[t].records || []).map(recOut);
  });
  return out;
}

/** คืน JSON string (เรียกจาก editor/── google.script.run) */
function rbExportDayJson(iso) {
  return JSON.stringify(rbExportDayObj_(iso || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd')));
}

/** เซฟ JSON ลง Drive แล้วคืน URL (สะดวกสุดสำหรับดึงออกไป import) */
function rbSaveDayJson(iso) {
  iso = iso || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
  var json = JSON.stringify(rbExportDayObj_(iso));
  var name = 'pas_export_' + iso + '.json';
  var folderId = (typeof CONFIG_RB !== 'undefined' && CONFIG_RB.OUTPUT_FOLDER_ID) ? CONFIG_RB.OUTPUT_FOLDER_ID : '';
  var file;
  if (folderId) file = DriveApp.getFolderById(folderId).createFile(name, json, 'application/json');
  else file = DriveApp.createFile(name, json, 'application/json');
  Logger.log('บันทึกแล้ว: ' + file.getUrl());
  return file.getUrl();
}

/** ---------- master (employee) export ---------- */
/** อ่านรายชื่อเต็มจากไฟล์ master (Total + ทุกแท็บ BKK Batch) → {employees:[...]} */
function rbExportMasterObj_() {
  var ss = SpreadsheetApp.openById(MASTER_FILE_ID_RB);
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  function dstr(v) { return (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : ''; }   // เฉพาะเซลล์ที่เป็น Date จริง
  function pg(pos, team, dept) {
    if (dept === 'LL' && typeof rrLLPosGroup_ === 'function') return rrLLPosGroup_(pos);
    return (typeof rrPosGroup_ === 'function') ? rrPosGroup_(pos, team) : 'PSA';
  }
  var emp = {};
  var ws = ss.getSheetByName('Total'), data = ws ? ws.getDataRange().getValues() : [];
  for (var i = 1; i < data.length; i++) {                     // Total: 1=รหัส 2=ทีม 3=คำนำหน้า 4=ชื่อ 5=สกุล 6=แผนก 7=ตำแหน่ง 8=เริ่มงาน 10=Name 11=Surname 12=พ้นสภาพ 13=สถานะ
    var row = data[i], code = String(row[1] == null ? '' : row[1]).replace(/\D/g, '');
    if (!/^\d{6,8}$/.test(code)) continue;
    var team = String(row[2] || '').trim();
    var deptRaw = String(row[6] || ''), dept = deptRaw.indexOf(DEPT_PSA_TH) >= 0 ? 'PSA' : (deptRaw.indexOf(DEPT_LL_TH) >= 0 ? 'LL' : null);
    var pos = String(row[7] || '').trim();
    emp[code] = {
      code: code, nameTh: (String(row[4] || '').trim() + ' ' + String(row[5] || '').trim()).trim(),
      nameEn: (String(row[10] || '').trim() + ' ' + String(row[11] || '').trim()).trim(),
      team: team, dept: dept, position: pos, posGroup: pg(pos, team, dept), source: 'HKT',
      startDate: dstr(row[8]), resignDate: dstr(row[12]),
      status: (String(row[13] || '').trim().toUpperCase() === 'RESIGNED') ? 'RESIGNED' : 'ACTIVE'
    };
  }
  var bkkIds = {};
  try {
    (typeof rbReadBkkBatch_ === 'function' ? rbReadBkkBatch_(ss) : []).forEach(function (p) {
      bkkIds[p.id] = 1;
      if (!emp[p.id]) emp[p.id] = { code: p.id, nameTh: p.nameTh || '', nameEn: '', team: p.team || '', dept: 'PSA',
        position: p.pos || 'Passenger Services Agent', posGroup: pg(p.pos, p.team, 'PSA'), source: 'BKK',
        startDate: '', resignDate: '', status: 'ACTIVE' };
    });
  } catch (eB) {}
  Object.keys(emp).forEach(function (c) { var e = emp[c]; e.source = bkkIds[c] ? 'BKK' : (e.posGroup === 'Globlex' ? 'GLOBEX' : 'HKT'); });
  return { employees: Object.keys(emp).map(function (c) { return emp[c]; }) };
}
function rbExportMasterJson() { return JSON.stringify(rbExportMasterObj_()); }
function rbSaveMasterJson() {
  var json = JSON.stringify(rbExportMasterObj_()), name = 'pas_master.json';
  var fid = (typeof CONFIG_RB !== 'undefined' && CONFIG_RB.OUTPUT_FOLDER_ID) ? CONFIG_RB.OUTPUT_FOLDER_ID : '';
  var file = fid ? DriveApp.getFolderById(fid).createFile(name, json, 'application/json') : DriveApp.createFile(name, json, 'application/json');
  Logger.log('บันทึกแล้ว: ' + file.getUrl()); return file.getUrl();
}
function rbExportMasterTest() {
  var o = rbExportMasterObj_(), n = o.employees.length, by = {};
  o.employees.forEach(function (e) { by[e.source] = (by[e.source] || 0) + 1; });
  Logger.log('employees=' + n + ' · ' + JSON.stringify(by) + ' · ตัวอย่าง: ' + JSON.stringify(o.employees.slice(0, 2)));
}

/** ---------- flights / porter / pre-WC / manpower export ---------- */
/** ตารางบินของวัน (จากไฟล์ตารางบินสัปดาห์) → {date, flights:[{flightNo,airline,ac,sta,std,cancelled}]} */
function rbExportFlightsObj_(iso) {
  var date = rbDateFromIso_(iso), flights = [];
  var id = (typeof wfFileId_ === 'function') ? wfFileId_() : '';
  if (id) {
    try {
      var ss = SpreadsheetApp.openById(id), sched = (typeof wfLoadScheduleFromSs_ === 'function') ? wfLoadScheduleFromSs_(ss, date) : null;
      if (sched) Object.keys(sched).forEach(function (k) {
        var w = sched[k];
        flights.push({ flightNo: (w.airline || '') + (w.flt || ''), airline: w.airline || '', ac: w.ac || '', sta: w.sta || '', std: w.std || '', cancelled: !!w.cancelled });
      });
    } catch (e) {}
  }
  return { date: iso, flights: flights };
}

/** Porter case log ของวัน → {date, tab, jobs:[...], staff:[...]} (ใช้ porterReadDay_) */
function rbExportPorterObj_(iso) {
  var d = porterReadDay_(rbDateFromIso_(iso));
  return { date: iso, found: !!d.found, tab: d.tab || '', jobs: d.jobs || [], staff: d.staff || [] };
}

/** Pre-book wheelchair ของวัน → {date, tab, flights:[{airline,flt,routing,sta,std,ctOpen,ctClose,arr[5],dep[5]}]} */
function rbExportPrewcObj_(iso) {
  var d = prewcReadDay_(rbDateFromIso_(iso));
  return { date: iso, found: !!d.found, tab: d.tab || '', flights: d.flights || [] };
}

/** MANPOWER ของวัน (อ่านทุกคอลัมน์จากแท็บสรุป) → {date, teams:[{team,total,scheduled,sick,...,working,otHours,otHoliday,updatedAt,updatedBy}]} */
function rbExportManpowerObj_(iso) {
  var date = rbDateFromIso_(iso), rows = [], roster = null;
  try {
    roster = rbOpenTodayRoster_(date);
    var sheets = roster.ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var V = sheets[i].getDataRange().getDisplayValues(), hdr = -1;
      for (var r = 0; r < Math.min(14, V.length); r++) { if (String(V[r][0] || '').trim() === 'ทีม' && V[r].join('|').indexOf('ทำงานจริง') >= 0) { hdr = r; break; } }
      if (hdr < 0) continue;
      for (var rr = hdr + 1; rr < V.length; rr++) {
        var a = String(V[rr][0] || '').trim(); if (!a) continue; if (/^รวม/.test(a)) break;
        var m = a.match(/\(([^)]+)\)/), code = (m ? m[1] : a).replace(/^team\s*/i, '').trim().toUpperCase();
        var row = V[rr];
        function n(x) { var v = parseFloat(String(row[x] == null ? '' : row[x]).replace(/[^\d.\-]/g, '')); return isFinite(v) ? v : null; }
        rows.push({ team: code, total: n(1), scheduled: n(2), sick: n(3), personal: n(4), annual: n(5), maternity: n(6), other: n(7), training: n(8), working: n(9), otHours: n(10), otHoliday: n(11), updatedAt: String(row[12] || '').trim(), updatedBy: String(row[13] || '').trim() });
      }
      break;
    }
  } catch (e) {}
  if (roster && roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (eT) {} }
  return { date: iso, teams: rows };
}

/** เซฟทุก export ของวันลง Drive (ยกเว้น master แยกต่างหาก) → คืนรายการ URL */
function rbSaveAllDay(iso) {
  iso = iso || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
  var fid = (typeof CONFIG_RB !== 'undefined' && CONFIG_RB.OUTPUT_FOLDER_ID) ? CONFIG_RB.OUTPUT_FOLDER_ID : '';
  var folder = fid ? DriveApp.getFolderById(fid) : null;
  function save(name, obj) { var s = JSON.stringify(obj); return (folder ? folder.createFile(name, s, 'application/json') : DriveApp.createFile(name, s, 'application/json')).getUrl(); }
  var urls = {
    day:      save('pas_day_' + iso + '.json', rbExportDayObj_(iso)),
    flights:  save('pas_flights_' + iso + '.json', rbExportFlightsObj_(iso)),
    porter:   save('pas_porter_' + iso + '.json', rbExportPorterObj_(iso)),
    prewc:    save('pas_prewc_' + iso + '.json', rbExportPrewcObj_(iso)),
    manpower: save('pas_manpower_' + iso + '.json', rbExportManpowerObj_(iso))
  };
  Logger.log(JSON.stringify(urls, null, 2)); return urls;
}

/** ทดสอบใน editor */
function rbExportDayTest() {
  var o = rbExportDayObj_(Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd'));
  var nTeams = Object.keys(o.teams).length, nRec = 0, nAsg = 0;
  Object.keys(o.teams).forEach(function (t) { o.teams[t].forEach(function (r) { nRec++; nAsg += r.assignments.length; }); });
  Logger.log('date=' + o.date + ' teams=' + nTeams + ' records=' + nRec + ' assignments=' + nAsg);
}
