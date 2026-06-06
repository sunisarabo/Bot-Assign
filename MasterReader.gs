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

var MASTER_FILE_ID_RB = '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8';
var DEPT_PSA_TH = 'การโดยสาร';
var DEPT_LL_TH  = 'ติดตามสัมภาระ';

function readMasterHeadcount(masterFileId) {
  var ss = SpreadsheetApp.openById(masterFileId || MASTER_FILE_ID_RB);
  var ws = ss.getSheetByName('Total');
  if (!ws) throw new Error('ไม่พบชีต "Total" ใน master file');
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
}

function debugDumpMaster(masterFileId) {
  var hc = readMasterHeadcount(masterFileId);
  Logger.log('Active: %s  |  PSA %s  LL %s  รวม %s',
    hc.active, hc.PSA.total, hc.LL.total, hc.PSA.total + hc.LL.total);
  Logger.log('PSA byPos: %s', JSON.stringify(hc.PSA.byPos));
  Logger.log('LL  byPos: %s', JSON.stringify(hc.LL.byPos));
  return hc;
}
