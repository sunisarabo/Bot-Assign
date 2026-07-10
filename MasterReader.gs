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
// ใช้แสดงจำนวนพนักงานรวม + ค้นทีมต้นสังกัดของคนซัพจากชื่อ (rbMasterNameTeam_)
var MASTER_FILE_ID_RB = '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8';
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

/** ดัชนี "ชื่อ (คำแรก ตัวพิมพ์ใหญ่ · ทั้งไทย/อังกฤษ) → { team: 1 }" จากไฟล์ master (Total)
 *  ใช้ค้นทีมต้นสังกัดของคนซัพที่ไม่มีรหัสทีมในชีตรายวัน (ตัด Resigned ออก) */
function rbMasterNameTeam_(masterFileId) {
  var out = {};
  var id = masterFileId || MASTER_FILE_ID_RB;
  if (!id) return out;
  var ss = SpreadsheetApp.openById(id);
  var ws = ss.getSheetByName('Total');
  if (!ws) return out;
  var data = ws.getDataRange().getValues();
  function key(nm) {
    var s = String(nm == null ? '' : nm).trim().toUpperCase().split(/[\s(]/)[0];
    return s.length >= 3 ? s : '';
  }
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[13] || '').trim() === 'Resigned') continue;   // ลาออกแล้ว ไม่นับ
    var team = String(row[2] || '').trim();                        // คอลัมน์ Team
    if (!team) continue;
    [row[10], row[4]].forEach(function (nm) {                      // NameEN(10) · NameTH(4)
      var k = key(nm); if (k) (out[k] = out[k] || {})[team] = 1;
    });
  }
  return out;
}

/** ตารางแมปแก้เอง (ชั้นค้นที่ 3) — แท็บ "Master_Mapping" ในไฟล์รายชื่อ
 *  คอลัมน์ A = คำค้น/ชื่อ (เช่น KUNNIDA) · B = ทีม/หมวด (เช่น PVT) → { UPPERKEY: 'ทีม' }
 *  ให้ผู้ใช้เติมเคสที่ระบบค้นอัตโนมัติไม่เจอได้เอง (ฟรี ไม่ต้องใช้ AI) */
function rbMasterMapping_(masterFileId) {
  var out = {};
  var id = masterFileId || MASTER_FILE_ID_RB;
  if (!id) return out;
  try {
    var ss = SpreadsheetApp.openById(id);
    var ws = ss.getSheetByName('Master_Mapping');
    if (!ws) return out;
    var last = ws.getLastRow(); if (last < 1) return out;
    var rows = ws.getRange(1, 1, last, 2).getValues();
    rows.forEach(function (r) {
      var k = String(r[0] == null ? '' : r[0]).trim().toUpperCase();
      var v = String(r[1] == null ? '' : r[1]).trim();
      if (!k || !v) return;
      if (/^(คำค้น|KEY|KEYWORD|ชื่อ|NAME)$/i.test(k)) return;      // ข้ามหัวตาราง
      out[k] = v;
    });
  } catch (e) {}
  return out;
}
