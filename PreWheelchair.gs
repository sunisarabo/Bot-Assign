/**
 * PreWheelchair.gs — อ่านยอดจองรถเข็นล่วงหน้า (Pre-book Wheelchair) รายวัน
 * ไฟล์: Pre-Case Porter / <MON YYYY> / "<MON YYYY> PRE-WHEELCHAIR" (แต่ละวัน = 1 แท็บ ชื่อ "19SEP26")
 *
 * คอลัมน์รายวัน (0-based):
 *  0 Airlines · 1 Flt no. (410/411) · 2 Routing · 3 STA(HHMM) · 4 STD(HHMM) · 5 STA(time) · 6 STD(time)
 *  7 C/T OPEN · 8 C/T CLOSE
 *  ARR: 9 WCHR 10 WCHS 11 WCHC 12 AVIH 13 MAAS 14 TOTAL
 *  DEP: 15 WCHR 16 WCHS 17 WCHC 18 AVIH 19 MAAS 20 TOTAL
 *  (21+ = โน้ต/สรุปช่วงเวลา/ตาราง manpower — ข้าม)
 * ใช้ getDisplayValues → เวลาได้ "6:40"; เซลล์เวลาว่างจะเป็น "31/12/1899, 00:00:00" (ถือว่าว่าง)
 */

var PREWC_ROOT_ID_ = '1xiTMfPDQ0nRLf0eKYjhn2SIeiP8-HRwb';   // โฟลเดอร์ "Pre-Case Porter"
var PREWC_TYPES_ = ['WCHR', 'WCHS', 'WCHC', 'AVIH', 'MAAS'];

/** หาไฟล์ PRE-WHEELCHAIR ของเดือน (ในโฟลเดอร์ย่อย "SEP 2026") — cache รายเดือน */
function prewcMonthFileId_(date) {
  var mon = PORTER_MON_[date.getMonth()], yr = date.getFullYear();
  var sub = mon + ' ' + yr, pkey = 'PREWC_FILE_' + mon + yr;
  try { var c = PropertiesService.getScriptProperties().getProperty(pkey); if (c) { try { DriveApp.getFileById(c).getName(); return c; } catch (e0) {} } } catch (eP) {}
  var found = '';
  try {
    var folders = DriveApp.getFolderById(PREWC_ROOT_ID_).getFoldersByName(sub);
    if (folders.hasNext()) {
      var folder = folders.next(), fit = folder.getFiles(), firstSheet = '';
      while (fit.hasNext()) {
        var f = fit.next(), nm = String(f.getName() || '').toUpperCase();
        if (f.getMimeType && f.getMimeType() === 'application/vnd.google-apps.spreadsheet' && !firstSheet) firstSheet = f.getId();
        if (nm.indexOf('WHEEL') >= 0) { found = f.getId(); break; }
      }
      if (!found) found = firstSheet;
    }
  } catch (eF) { throw new Error('เข้าโฟลเดอร์ Pre-WC ไม่ได้: ' + eF.message); }
  if (found) { try { PropertiesService.getScriptProperties().setProperty(pkey, found); } catch (eS) {} }
  return found;
}

function prewcTime_(v) { var s = porterStr_(v); if (!s || /1899/.test(s)) return ''; var m = s.match(/(\d{1,2})[:.](\d{2})/); return m ? (m[1] + ':' + m[2]) : ''; }
function prewcInt_(v) { var n = parseInt(porterStr_(v).replace(/[^\d\-]/g, ''), 10); return isNaN(n) ? 0 : n; }

/** อ่านยอดจอง Pre-WC ของวันที่ระบุ → {found, fileName, tab, flights[]} */
function prewcReadDay_(date) {
  var fid = prewcMonthFileId_(date);
  if (!fid) return { found: false, reason: 'ไม่พบไฟล์ Pre-Wheelchair ของเดือนนี้' };
  var ss = SpreadsheetApp.openById(fid);
  var pick = porterFindSheet_(ss, date);       // ใช้ตัวเลือกแท็บตามชื่อวันเดียวกับ Porter
  if (!pick.sheet) return { found: false, fileName: ss.getName(), reason: 'ไม่พบแท็บ Pre-WC ของวันที่ ' + date.getDate(), tabs: pick.names };
  var V = pick.sheet.getDataRange().getDisplayValues();
  var flights = [], seen = false;
  for (var r = 0; r < V.length; r++) {
    var row = V[r], a = porterStr_(row[0]).toUpperCase();
    if (!a) { if (seen) break; else continue; }
    if (a === 'AIRLINES' || a === 'AIRLINE' || a === 'DATE') continue;
    var flt = porterStr_(row[1]);
    if (!flt || flt.toUpperCase() === 'FLT NO.') { if (seen) break; else continue; }
    var arr = [prewcInt_(row[9]), prewcInt_(row[10]), prewcInt_(row[11]), prewcInt_(row[12]), prewcInt_(row[13])];
    var dep = [prewcInt_(row[15]), prewcInt_(row[16]), prewcInt_(row[17]), prewcInt_(row[18]), prewcInt_(row[19])];
    var at = arr[0] + arr[1] + arr[2] + arr[3] + arr[4], dt = dep[0] + dep[1] + dep[2] + dep[3] + dep[4];
    seen = true;
    if (at + dt > 0) flights.push({
      airline: a, flt: flt, routing: porterStr_(row[2]),
      sta: prewcTime_(row[5]) || porterStr_(row[3]), std: prewcTime_(row[6]) || porterStr_(row[4]),
      ctOpen: prewcTime_(row[7]), ctClose: prewcTime_(row[8]), arr: arr, dep: dep, arrT: at, depT: dt
    });
  }
  return { found: true, fileName: ss.getName(), tab: pick.sheet.getName(), flights: flights };
}

/** รวมยอด Pre-WC ของวัน */
function prewcTotals_(d) {
  var A = [0, 0, 0, 0, 0], D = [0, 0, 0, 0, 0];
  (d.flights || []).forEach(function (f) { for (var i = 0; i < 5; i++) { A[i] += f.arr[i]; D[i] += f.dep[i]; } });
  var at = A[0] + A[1] + A[2] + A[3] + A[4], dt = D[0] + D[1] + D[2] + D[3] + D[4];
  return { arr: A, dep: D, arrT: at, depT: dt, total: at + dt, nFlt: (d.flights || []).length };
}

/** ยอดรวม Pre-WC (สำหรับการ์ด Dashboard) → number | null */
function prewcDayTotal_(date) {
  try { var d = prewcReadDay_(date); if (!d || !d.found) return null; return prewcTotals_(d).total; } catch (e) { return null; }
}

/** แผง Pre-WC ในแท็บ Porter */
function prewcPanelHtml_(date) {
  var d; try { d = prewcReadDay_(date); } catch (e) { return ''; }
  if (!d || !d.found) return '';
  var T = prewcTotals_(d);
  var head = '<div class="pt-prewc"><div class="pt-prewc-hd">♿ Pre-book Wheelchair (จองล่วงหน้า) <span class="tt-cnt">' + rbEsc_(d.tab || '') + '</span></div>';
  if (T.total === 0) return head + '<div class="muted" style="padding:8px 2px">วันนี้ยังไม่มีการจองรถเข็นล่วงหน้า</div></div>';
  function kp(big, lbl, tone) { return '<div class="pt-kpi ' + (tone || '') + '"><div class="pt-big">' + big + '</div><div class="pt-lbl">' + lbl + '</div></div>'; }
  var kpis = '<div class="pt-bar">' + kp(T.total, 'จองรวม') + kp(T.arrT, 'ขาเข้า') + kp(T.depT, 'ขาออก') +
    kp((T.arr[0] + T.dep[0]), 'WCHR') + kp((T.arr[1] + T.dep[1]), 'WCHS') + kp((T.arr[2] + T.dep[2]), 'WCHC') +
    kp((T.arr[3] + T.dep[3]), 'AVIH') + kp((T.arr[4] + T.dep[4]), 'MAAS') + '</div>';
  function brk(v) { var s = []; for (var i = 0; i < 5; i++) if (v[i]) s.push(PREWC_TYPES_[i] + ' ' + v[i]); return s.join(' · '); }
  var rows = d.flights.map(function (f) {
    return '<tr><td class="b">' + rbEsc_(f.airline) + '</td><td>' + rbEsc_(f.flt) + '</td><td class="muted">' + rbEsc_(f.routing) + '</td>' +
      '<td class="tnum">' + rbEsc_(f.sta || '-') + '</td><td class="tnum">' + rbEsc_(f.std || '-') + '</td>' +
      '<td class="tnum">' + rbEsc_(f.ctOpen || '-') + '–' + rbEsc_(f.ctClose || '-') + '</td>' +
      '<td class="tnum b">' + (f.arrT || '') + '</td><td style="font-size:11.5px">' + rbEsc_(brk(f.arr)) + '</td>' +
      '<td class="tnum b">' + (f.depT || '') + '</td><td style="font-size:11.5px">' + rbEsc_(brk(f.dep)) + '</td></tr>';
  }).join('');
  var tbl = rbTblCard_('', '<tr><th>สาย</th><th>ไฟลท์</th><th>เส้นทาง</th><th>STA</th><th>STD</th><th>C/T เปิด–ปิด</th><th>ARR</th><th>ARR แยกชนิด</th><th>DEP</th><th>DEP แยกชนิด</th></tr>', rows);
  return head + kpis + tbl + '</div>';
}

function porterPrewcTest() {
  var d = prewcReadDay_(new Date());
  var t = d.found ? prewcTotals_(d) : null;
  Logger.log(JSON.stringify({ found: d.found, file: d.fileName, tab: d.tab || '', reason: d.reason || '', totals: t, sample: (d.flights || []).slice(0, 5) }, null, 2));
}
