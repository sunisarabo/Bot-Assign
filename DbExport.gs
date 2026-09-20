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

/** ทดสอบใน editor */
function rbExportDayTest() {
  var o = rbExportDayObj_(Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd'));
  var nTeams = Object.keys(o.teams).length, nRec = 0, nAsg = 0;
  Object.keys(o.teams).forEach(function (t) { o.teams[t].forEach(function (r) { nRec++; nAsg += r.assignments.length; }); });
  Logger.log('date=' + o.date + ' teams=' + nTeams + ' records=' + nRec + ' assignments=' + nAsg);
}
