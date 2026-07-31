/**
 * RosterBot.gs — integration layer on top of RosterReader.gs
 * =============================================================================
 * Turns the validated roster reader into the actual outputs:
 *   • a Dashboard tab  — per-team headcount + OT + flight counts (+ grand total)
 *   • a Timetable tab  — per-team, per-employee flights with shift / OT and each
 *                        flight's task and open–close (OP/CL) or STA/STD times,
 *                        for judging schedule appropriateness
 *   • a Google Chat summary
 *
 * Requires RosterReader.gs in the same Apps Script project
 * (uses readRosterFromSpreadsheet()).
 *
 * Quick test against a real roster file (recommended first step):
 *   1. put a roster spreadsheet's ID in testRosterFromId()
 *   2. Run → testRosterFromId  → it writes "📊 Dashboard" and "🕓 Timetable"
 *      tabs into a fresh output spreadsheet and logs the link.
 * Daily automation: set CONFIG_RB + a time trigger on runDailyRosterReport.
 */

var CONFIG_RB = {
  ROOT_FOLDER_ID:   '1Uk-6w7U-cqQEXFIVEl6tRhKKRCaN1ojp',   // PSA year folder (drill month→day)
  OUTPUT_FOLDER_ID: '',                                     // โฟลเดอร์เก็บรายงาน — เว้นว่าง = เซฟลง My Drive
  LL_FILE_ID:       '', // ไฟล์ LL — ใส่ ID ถ้าบัญชีที่รันมีสิทธิ์เข้า (ของเดิม '13Ry12jDy8S8vmlPVTxMUDLC_8u3PiPRIhvgDHEeWhMg'); เว้นว่าง = ข้าม LL
  COUNTER_FILE_ID:  '1sUxh2xu4U3Jx2uqxOp0tyjr2mPGi7xS23RUNWmTzQPE', // ไฟล์ "PAS Counter Bridge" (IMPORTRANGE เคาน์เตอร์ของท่าเข้ามาเอง) — เว้นว่าง = ไม่ตัดตามเคาน์เตอร์
  // ไฟล์ COUNTER CHECK ของท่าโดยตรง (ต้นทาง IMPORTRANGE): '1c_eEouBq8YfNiJKWDOhhTxTXu2cBjh_zh9jul_Tn3rk'
  COUNTER_SRC_ID:   '1c_eEouBq8YfNiJKWDOhhTxTXu2cBjh_zh9jul_Tn3rk', // ไฟล์ COUNTER CHECK ของท่า (ต้นทางให้ Bridge IMPORTRANGE) — เว้นว่าง = ไม่รีเฟรช Bridge อัตโนมัติ
  COUNTER_SRC_RANGE:'A1:J400',                              // ช่วงเซลล์ที่ IMPORTRANGE จากแท็บของท่า
  COUNTER_SRC_TABFMT:'DDMONYY',                             // รูปแบบชื่อแท็บของท่า: DDMONYY=06JUL26 · DMONYY=6JUL26 · DDMON=06JUL · DMON=6JUL
  COUNTER_BRIDGE_DAYS: 7,                                   // สร้างแท็บครอบ ±N วันจากวันนี้ใน Bridge
  CHAT_WEBHOOK_PROP: 'GCHAT_WEBHOOK_REPORT',               // Script Property holding the webhook URL
  SKIP_TIMETABLE_TEAMS: [],                                // teams to omit from the timetable tab
};

var MON_RB = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ─── ENTRY POINTS ───────────────────────────────────────────────────────────
function runDailyRosterReport() {
  try { rbRunForDate_(new Date()); }
  catch (e) { Logger.log('❌ runDailyRosterReport: ' + e.message + '\n' + (e.stack || '')); }
}

function runRosterForDate(y, m, d) {
  try { rbRunForDate_(new Date(y, m - 1, d)); }
  catch (e) { Logger.log('❌ runRosterForDate: ' + e.message + '\n' + (e.stack || '')); }
}

/** เจนรายงานทั้งเดือน (regenerate ทุกวันด้วยโค้ดล่าสุด) — มี time-budget กันชน limit 6 นาที · resume ได้
 *  ใช้: runRosterForMonth(2026, 7)  ·  ถ้าใกล้หมดเวลาจะหยุดแล้วบอกวันถัดไปให้รันต่อ เช่น runRosterForMonth(2026, 7, 18) */
function runRosterForMonth(y, m, fromDay) {
  var start = new Date().getTime(), BUDGET = 5 * 60 * 1000;   // ~5 นาที (เผื่อ 1 นาทีเขียนไฟล์ก่อนชน limit 6 นาที)
  var today = new Date();
  var lastDay = new Date(y, m, 0).getDate();                  // วันสุดท้ายของเดือน
  var isCur = (today.getFullYear() === y && today.getMonth() === m - 1);
  var endDay = isCur ? today.getDate() : lastDay;             // เดือนปัจจุบัน → ถึงวันนี้ · เดือนที่ผ่านมา → ทั้งเดือน
  var d0 = Math.max(1, fromDay || 1), done = 0, fail = 0, stopAt = 0;
  for (var d = d0; d <= endDay; d++) {
    if (new Date().getTime() - start > BUDGET) { stopAt = d; break; }
    try { rbRunForDate_(new Date(y, m - 1, d)); done++; }
    catch (e) { fail++; Logger.log('⚠️ วันที่ ' + d + '/' + m + ': ' + e.message); }
  }
  if (stopAt) Logger.log('⏸️ เจนถึงวันที่ ' + (stopAt - 1) + ' แล้ว (ใกล้หมดเวลา) · สำเร็จ ' + done + ' วัน · รันต่อ: runRosterForMonth(' + y + ', ' + m + ', ' + stopAt + ')');
  else Logger.log('✅ เจนรายงานเดือน ' + m + '/' + y + ' ครบ (วันที่ ' + d0 + '–' + endDay + ') · สำเร็จ ' + done + ' วัน' + (fail ? ' · พลาด ' + fail + ' วัน (ดู log)' : ''));
}

/**
 * รันครั้งเดียวเพื่อตั้ง trigger ให้รายงานออกอัตโนมัติทุกวัน 08:00 และ 14:00
 * (เวลาอิงตาม Time zone ของโปรเจกต์ — ตั้งเป็น Asia/Bangkok ใน Project Settings)
 * แต่ละรอบจะอ่านไฟล์ของวันนั้น + อัปเดตแท็บ + ส่งเข้า Google Chat
 */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyRosterReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyRosterReport').timeBased().atHour(8).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('runDailyRosterReport').timeBased().atHour(14).nearMinute(0).everyDays(1).create();
  var w = PropertiesService.getScriptProperties().getProperty(CONFIG_RB.CHAT_WEBHOOK_PROP) ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง (ใส่ใน Script Properties)';
  Logger.log('✅ ตั้ง trigger รันทุกวัน 08:00 และ 14:00 แล้ว · Google Chat webhook: ' + w);
}

/**
 * รันครั้งเดียวเพื่อบันทึก Google Chat webhook ลง Script Properties
 * (อย่าใส่ URL ลงในโค้ดที่ commit ขึ้น GitHub — เป็นความลับ)
 * วิธีใช้: วาง URL ในตัวแปร url ด้านล่าง → Run setupChatWebhook → แล้วลบ URL ออก
 * หรือไปที่ Project Settings → Script Properties → เพิ่ม GCHAT_WEBHOOK_REPORT เอง
 */
function setupChatWebhook() {
  var url = 'PASTE_GOOGLE_CHAT_WEBHOOK_URL_HERE';
  if (url.indexOf('http') !== 0) { Logger.log('⚠️ วาง URL webhook ในฟังก์ชัน setupChatWebhook ก่อน'); return; }
  PropertiesService.getScriptProperties().setProperty(CONFIG_RB.CHAT_WEBHOOK_PROP, url);
  Logger.log('✅ บันทึก webhook แล้ว → รายงานรายวันจะส่งเข้า Google Chat');
}

/**
 * Open any spreadsheet by id whether it is a native Google Sheet OR an uploaded
 * .xlsx (which SpreadsheetApp.openById cannot read). Returns { ss, tempId }.
 * Requires the Drive API advanced service for the .xlsx case.
 */
function rbOpenAnyById_(id) {
  var file = DriveApp.getFileById(id);
  var mime = file.getMimeType();
  if (mime === MimeType.GOOGLE_SHEETS) return { ss: SpreadsheetApp.openById(id), tempId: null };
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || /\.xlsx$/i.test(file.getName())) {
    var tmp = Drive.Files.copy({ title: '_TEMP_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }, id, { convert: true });
    return { ss: SpreadsheetApp.openById(tmp.id), tempId: tmp.id };
  }
  throw new Error('ไฟล์นี้ไม่ใช่ Spreadsheet (mime=' + mime + ') — ต้องชี้ไปที่ไฟล์ assignment PSA');
}

/**
 * Simplest manual test: read ONE PSA roster file by ID, write the reports.
 * Works on a native Google Sheet OR an .xlsx assignment file.
 * Pass an LL file id + date to include the LL department, e.g.
 *   testRosterFromId('<psaId>', '<llId>', 2026, 6, 6);
 */
function testRosterFromId(ssId, llId, y, m, d) {
  ssId = ssId || 'PUT_A_ROSTER_SPREADSHEET_ID_HERE';
  var opened = rbOpenAnyById_(ssId);
  var roster = opened.ss;
  Logger.log('📄 ไฟล์: %s | ชีต: %s', roster.getName(),
             roster.getSheets().map(function (s) { return s.getName(); }).join(', '));
  var res = readRosterFromSpreadsheet(roster);
  Logger.log('➡️ เจอ %s ทีม, รวม %s คน (working %s)',
             Object.keys(res.teams).length, res.totals.staff, res.totals.working);
  if (res.totals.staff === 0) {
    Logger.log('⚠️ อ่านไม่เจอพนักงาน — ตรวจว่าไฟล์นี้เป็นไฟล์ assignment PSA (มีแท็บ EK/SQ/QR/...) ' +
               'และมีหัวตาราง ID/NAME/SHIFT ใช่ไหม');
  }
  var ll = null;
  if (llId) {
    var date = (y && m && d) ? new Date(y, m - 1, d) : new Date();
    try { ll = readLLForDate(llId, date); } catch (e) { Logger.log('⚠️ LL: ' + e.message); }
  }
  var master = null;
  try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e) { Logger.log('⚠️ Master: ' + e.message); }
  var out = rbCreateSheet_('Roster Report — ' + roster.getName());
  rbWriteDashboard_(out, res, roster.getName(), ll, master);
  rbWriteTimetable_(out, res, roster.getName(), ll);
  rbWriteFlightSLA_(out, res, roster.getName(), ll);
  rbWriteSupport_(out, res, roster.getName(), ll);
  rbWriteAssignCheck_(out, res, roster.getName(), ll);
  rbWriteFillPlan_(out, res, roster.getName(), ll);
  rbWriteAutoAssign_(out, res, roster.getName(), ll);
  var cleanup = out.getSheetByName('Sheet1') || out.getSheetByName('ชีต1');
  if (cleanup && out.getSheets().length > 1) out.deleteSheet(cleanup);
  if (opened.tempId) { try { DriveApp.getFileById(opened.tempId).setTrashed(true); } catch (e) {} }
  Logger.log('✅ Report written: %s', out.getUrl());
  return out.getUrl();
}

// ─── MAIN PIPELINE ──────────────────────────────────────────────────────────
function rbRunForDate_(date) {
  var roster = rbOpenTodayRoster_(date);
  var res = readRosterFromSpreadsheet(roster.ss, date);

  var ll = null;
  if (CONFIG_RB.LL_FILE_ID) {
    try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); }
    catch (e) { Logger.log('⚠️ LL: ' + e.message); }
  }

  var master = null;
  if (MASTER_FILE_ID_RB) {
    try { master = readMasterHeadcount(MASTER_FILE_ID_RB); }
    catch (e) { Logger.log('⚠️ Master: ' + e.message); }
  }

  var be = date.getFullYear() + 543;
  var mon = MON_RB[date.getMonth()];
  var dd = ('0' + date.getDate()).slice(-2);
  var dateStr = date.getDate() + ' ' + mon + ' ' + be;

  // one monthly file, tabs PER DAY → keeps history
  var out = rbGetMonthlyOutput_(mon, be);
  rbWriteDashboard_(out, res, dateStr, ll, master, '📊 ' + dd + ' ' + mon);
  rbWriteTimetable_(out, res, dateStr, ll, '🕓 ' + dd + ' ' + mon);
  rbWriteFlightSLA_(out, res, dateStr, ll, '✈️ ' + dd + ' ' + mon);
  rbWriteSupport_(out, res, dateStr, ll, '🆘 ' + dd + ' ' + mon);
  rbWriteAssignCheck_(out, res, dateStr, ll, '🧭 ' + dd + ' ' + mon);
  rbWriteFillPlan_(out, res, dateStr, ll, '🤖 เติม ' + dd + ' ' + mon);
  rbWriteAutoAssign_(out, res, dateStr, ll, '🤖 Auto ' + dd + ' ' + mon);
  // weekly OT (>36h) — reads the week's files; non-fatal if it can't finish
  try {
    var wr = rbWeekRange_(date);
    rbWriteWeeklyOT_(out, date, mon, '⏱️ OT ' + wr.label);
  } catch (e) { Logger.log('⚠️ Weekly OT: ' + e.message); }
  ['Sheet1', 'ชีต1', 'Sheet'].forEach(function (n) {
    var s = out.getSheetByName(n); if (s && out.getSheets().length > 1) out.deleteSheet(s);
  });
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }

  rbPostChat_(res, dateStr, out.getUrl(), ll, master);
  Logger.log('✅ Done: %s', out.getUrl());
}

// ─── DASHBOARD TAB (KPI cards — JUN_2569 style) ─────────────────────────────
var KPI_BG_ = ['#e8f0fe', '#e6f4ea', '#f5f5f5', '#fff8e1', '#fff3e0', '#fce4ec'];
var KPI_FC_ = ['#1a237e', '#1b5e20', '#424242', '#e65100', '#bf360c', '#880e4f'];

/** Write a row of KPI cards: label row + big value row, one card per column. */
function rbCards_(sh, top, labels, values) {
  for (var i = 0; i < labels.length; i++) {
    sh.getRange(top, i + 1).setValue(labels[i]).setBackground(KPI_BG_[i % 6]).setFontColor(KPI_FC_[i % 6])
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.getRange(top + 1, i + 1).setValue(values[i]).setBackground(KPI_BG_[i % 6]).setFontColor(KPI_FC_[i % 6])
      .setFontWeight('bold').setFontSize(20).setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
  sh.setRowHeight(top, 22); sh.setRowHeight(top + 1, 40);
}

function rbOtCell_(people, hrs) { return people > 0 ? (people + ' (' + hrs + 'h)') : '-'; }

/** Manpower-by-X table: X | Total | Working | OT-Off | OT ก่อนกะ | OT หลังกะ | %Working */
function rbManpowerTable_(sh, top, title, rowsData, headColor) {
  var W = 9;
  sh.getRange(top, 1, 1, W).merge().setValue(title)
    .setBackground(headColor).setFontColor('#fff').setFontWeight('bold').setFontSize(12);
  sh.setRowHeight(top, 24);
  var head = ['ทีม/ส่วน', 'Total', 'Working', 'OFF', 'Vac', 'OT-Off', 'OT ก่อนกะ', 'OT หลังกะ', '%Working'];
  sh.getRange(top + 1, 1, 1, W).setValues([head]).setBackground('#2e75b6').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  var body = rowsData.map(function (d) {
    var b = d.agg, work = b.working + b.ot_off;
    var pct = b.staff > 0 ? Math.round(work / b.staff * 100) + '%' : '-';
    return [d.label, b.staff, work, b.off, b.leave, rbOtCell_(b.ot_off, b.otOffHrs), rbOtCell_(b.otPre, b.otPreHrs), rbOtCell_(b.otPost, b.otPostHrs), pct];
  });
  if (body.length) sh.getRange(top + 2, 1, body.length, W).setValues(body);
  return top + 2 + body.length;
}

function rbWriteDashboard_(ss, res, dateStr, ll, master, tabName) {
  tabName = tabName || '📊 Dashboard';
  var oldD = ss.getSheetByName(tabName);
  if (oldD) ss.deleteSheet(oldD);                            // recreate fresh (clears stale freeze/merges)
  var sh = ss.insertSheet(tabName, 0);

  var P = res.totals;
  var L = ll && ll.totals.staff > 0 ? ll.totals : null;
  var combStaff = P.staff + (L ? L.staff : 0);
  var combWork  = (P.working + P.ot_off) + (L ? L.working + L.ot_off : 0);
  var combOff   = P.off + (L ? L.off : 0);
  var combOtOff = P.ot_off + (L ? L.ot_off : 0);
  var combOtPpl = P.otPeople + (L ? L.otPeople : 0);
  var combOtHrs = Math.round((P.otHours + (L ? L.otHours : 0)) * 10) / 10;

  // Title
  sh.getRange(1, 1, 1, 6).merge().setValue('📊 Daily Manpower Dashboard  —  ' + dateStr)
    .setBackground('#002060').setFontColor('#fff').setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 34);

  // KPI cards (PSA + LL combined) — exact JUN_2569 fields
  rbCards_(sh, 3,
    ['👥 Total Staff', '🟢 Working', '⬛ OFF', '🟡 OT OFF (XX)', '⏰ OT คน', '⏱️ OT ชั่วโมง'],
    [combStaff, combWork, combOff, combOtOff, combOtPpl, combOtHrs]);

  // Overall OT split (ก่อนกะ / หลังกะ / OT OFF) — combined PSA + LL, คน + ชม.
  var otPre = P.otPre + (L ? L.otPre : 0), otPreHrs = Math.round((P.otPreHrs + (L ? L.otPreHrs : 0)) * 10) / 10;
  var otPost = P.otPost + (L ? L.otPost : 0), otPostHrs = Math.round((P.otPostHrs + (L ? L.otPostHrs : 0)) * 10) / 10;
  var otOff = P.ot_off + (L ? L.ot_off : 0), otOffHrs = Math.round((P.otOffHrs + (L ? L.otOffHrs : 0)) * 10) / 10;
  sh.getRange(5, 1, 1, 6).merge()
    .setValue('⏱️ OT ก่อนกะ: ' + otPre + ' คน (' + otPreHrs + 'h)  |  OT หลังกะ: ' + otPost + ' คน (' + otPostHrs +
              'h)  |  OT OFF: ' + otOff + ' คน (' + otOffHrs + 'h)  |  รวม OT: ' + (P.otPeople + (L ? L.otPeople : 0)) +
              ' คน (' + Math.round((P.otHours + (L ? L.otHours : 0)) * 10) / 10 + 'h)')
    .setBackground('#241c33').setFontColor('#f5c542').setFontWeight('bold').setFontSize(11)
    .setHorizontalAlignment('center');
  sh.setRowHeight(5, 22);

  // Active establishment headcount (both departments) from MASTER file
  var row = 7;
  if (master) {
    var both = master.PSA.total + master.LL.total;
    sh.getRange(row, 1, 1, 6).merge()
      .setValue('👥 จำนวนพนักงานทั้งหมด (Active) — PSA ' + master.PSA.total +
                '  +  LL ' + master.LL.total + '  =  ' + both + ' คน')
      .setBackground('#37474f').setFontColor('#fff').setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('center');
    sh.setRowHeight(row, 22);
    row += 2;
  } else {
    row += 1;
  }

  // 📌 Manpower by Team (PSA)
  var teamRows = Object.keys(res.teams).sort(function (a, b) {
    return (res.teams[b].working + res.teams[b].ot_off) - (res.teams[a].working + res.teams[a].ot_off);
  }).map(function (t) { return { label: t, agg: res.teams[t] }; });
  teamRows.push({ label: '🔵 PSA TOTAL', agg: P });
  row = rbManpowerTable_(sh, row, '📌 Manpower by Team (PSA)', teamRows, '#1f4e79') + 1;

  // 📌 Manpower by Section (LL)
  if (L) {
    var secRows = Object.keys(ll.sections).map(function (s) { return { label: s, agg: ll.sections[s] }; });
    secRows.push({ label: '🟡 LL TOTAL', agg: L });
    row = rbManpowerTable_(sh, row, '📌 Manpower by Section (LL)', secRows, '#7f6000') + 1;
  }

  // 📌 By position group (PSA then LL) — full detail, with OT ก่อน/หลังกะ
  var ph = ['Position', 'Total', 'Working', 'OT-Off', 'Off', 'Sick', 'Leave', 'OT ก่อนกะ', 'OT หลังกะ'];
  function posBlock(title, positions, orderList, bg) {
    sh.getRange(row, 1, 1, ph.length).merge().setValue(title)
      .setBackground(bg).setFontColor('#fff').setFontWeight('bold'); row++;
    sh.getRange(row, 1, 1, ph.length).setValues([ph]).setBackground('#888').setFontColor('#fff').setFontWeight('bold'); row++;
    var body = [];
    orderList.forEach(function (p) {
      var b = positions[p]; if (!b) return;
      body.push([p, b.staff, b.working + b.ot_off, rbOtCell_(b.ot_off, b.otOffHrs), b.off, b.sick, b.leave,
                 rbOtCell_(b.otPre, b.otPreHrs), rbOtCell_(b.otPost, b.otPostHrs)]);
    });
    if (body.length) { sh.getRange(row, 1, body.length, ph.length).setValues(body); row += body.length; }
    row += 1;
  }
  posBlock('🔵 PSA by position', res.positions,
           ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign', 'DIR', 'MGR', 'Assist'], '#1f4e79');
  if (L) posBlock('🟡 LL by position', ll.positions, ['PSS', 'SNR', 'PSA', 'Porter', 'Admin', 'Trainee'], '#7f6000');

  // Combined PSA + LL working KPI footer
  if (L) {
    sh.getRange(row, 1, 1, 6).merge()
      .setValue('🏢 รวม PSA + LL  —  มาทำงาน ' + combWork + ' / ' + combStaff +
                ' คน  •  OFF ' + combOff + '  •  OT ' + combOtPpl + ' คน (' + combOtHrs + 'h)')
      .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('center');
    sh.setRowHeight(row, 24);
  }

  [110, 70, 75, 65, 70, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  for (var c = 7; c <= 9; c++) sh.setColumnWidth(c, 60);
  sh.setFrozenRows(2);
}

// ─── TIMETABLE TAB (wide flight-form layout, 3 OT columns) ──────────────────
function rbShiftCell_(r) {
  var code = r.shift || '';
  return (r.shiftTime && r.shiftTime !== code) ? (code + ' (' + r.shiftTime + ')') : code;
}
/** [OT ก่อนกะ, OT หลังกะ, OT OFF] cell strings for one record. */
function rbOtCols_(r) {
  var cell = (r.otTime ? r.otTime + ' ' : '') + (r.ot ? '(' + r.ot + 'h)' : '');
  if (r.bucket === 'ot_off') return ['', '', r.ot ? cell : '✔'];
  if (r.ot > 0) return r.otType === 'PRE' ? [cell, '', ''] : ['', cell, ''];
  return ['', '', ''];
}

function rbWriteTimetable_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🕓 Timetable';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);                              // recreate fresh (clears stale freeze/merges)
  var sh = ss.insertSheet(tabName, 1);

  // flatten ALL records (working first, then OFF/SL/ลา) — PSA teams then LL sections
  var recsAll = [];
  Object.keys(res.teams).forEach(function (team) {
    if (CONFIG_RB.SKIP_TIMETABLE_TEAMS.indexOf(team) >= 0) return;
    res.teams[team].records.forEach(function (r) { recsAll.push(r); });
  });
  if (ll && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) { recsAll.push(r); });
    });
  }
  var bkOrd = { working: 0, ot_off: 1, off: 2, vac: 3, sick: 4 };
  recsAll.sort(function (a, b) {
    return String(a.team).localeCompare(String(b.team)) ||
           ((bkOrd[a.bucket] || 0) - (bkOrd[b.bucket] || 0)) ||
           ((a.shiftStart == null ? 99999 : a.shiftStart) - (b.shiftStart == null ? 99999 : b.shiftStart));
  });

  // จำนวนคอลัมน์ไฟลท์ = มากสุดที่พนักงานคนใดได้รับ (ขั้นต่ำ 4 · เพดาน 20 กันกว้างเกิน)
  var maxFl = 4;
  recsAll.forEach(function (r) { if (r.assignments && r.assignments.length > maxFl) maxFl = r.assignments.length; });
  var MAXFL = Math.min(maxFl, 20), F = 6, B = 9, TOTAL = B + MAXFL * F + 1;
  if (sh.getMaxColumns() < TOTAL) sh.insertColumnsAfter(sh.getMaxColumns(), TOTAL - sh.getMaxColumns());

  // Title
  sh.getRange(1, 1, 1, TOTAL).merge().setValue('🕓 Timetable / ตารางงานรายคน — ' + dateStr)
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);

  // Group headers (rows 2-3)
  var baseHdr = ['Team', 'รหัสพนักงาน', 'ตำแหน่ง', 'ชื่อ', 'SHIFT เวลากะ', 'RE', 'OT ก่อนกะ', 'OT หลังกะ', 'OT OFF'];
  baseHdr.forEach(function (h, i) {
    sh.getRange(2, i + 1, 2, 1).merge().setValue(h).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
      .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  });
  var flClr = ['#0d3d6b', '#145a32', '#6e2f8e', '#784212'];
  for (var fi = 0; fi < MAXFL; fi++) {
    var base = B + fi * F + 1, clr = flClr[fi % flClr.length];
    sh.getRange(2, base, 1, F).merge().setValue('ไฟลท์ที่ ' + (fi + 1)).setBackground(clr).setFontColor('#fff')
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
    ['ชื่อไฟลท์', 'หน้าที่/Task', 'STA', 'OP', 'CL', 'STD'].forEach(function (h, k) {
      sh.getRange(3, base + k).setValue(h).setBackground(clr).setFontColor('#fff').setFontWeight('bold')
        .setFontSize(9).setHorizontalAlignment('center').setWrap(true);
    });
  }
  sh.getRange(2, TOTAL, 2, 1).merge().setValue('ชั่วโมงรวม').setBackground('#1f4e79').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(2, 20); sh.setRowHeight(3, 30);

  // Data rows
  var ST_LB = { off: '⬛ OFF', sick: '🔴 SL (ป่วย)', vac: '🌴 ลา' };
  var ST_BG = { off: '#e8eaed', sick: '#f8d7da', vac: '#fff3cd' };
  var data = recsAll.map(function (r) {
    var st = ST_LB[r.bucket];                               // off / sick / vac
    if (st) {                                               // non-working: show status, blank flights/OT
      var row0 = [r.team || '', r.id || '', r.pos || '', r.name || '', st, '', '', '', ''];
      for (var z = 0; z < MAXFL * F + 1; z++) row0.push('');
      return row0;
    }
    var ot = rbOtCols_(r);
    var row = [r.team || '', r.id || '', r.pos || '', r.name || '', rbShiftCell_(r), r.re || '', ot[0], ot[1], ot[2]];
    for (var fi = 0; fi < MAXFL; fi++) {
      var a = r.assignments && r.assignments[fi];
      row.push(a ? a.flight : '', a ? (a.task || '') : '', a ? (a.STA || '') : '', a ? (a.OP || '') : '', a ? (a.CL || '') : '', a ? (a.STD || '') : '');
    }
    var total = (r.shiftHrs || 0) + (r.ot || 0);
    row.push(total ? Math.round(total * 10) / 10 : '');
    return row;
  });
  if (data.length) {
    sh.getRange(4, 1, data.length, TOTAL).setValues(data).setFontSize(9).setVerticalAlignment('middle');
    for (var i = 0; i < data.length; i++) {
      var ro = recsAll[i];
      if (ST_BG[ro.bucket]) sh.getRange(4 + i, 1, 1, TOTAL).setBackground(ST_BG[ro.bucket]);   // OFF เทา · SL แดง · ลา เหลือง
      else if (i % 2) sh.getRange(4 + i, 1, 1, TOTAL).setBackground('#f3f7fc');
      if (ro.bucket === 'ot_off') sh.getRange(4 + i, 9).setBackground('#fff3cd');  // highlight OT OFF
    }
    sh.getRange(4, 1, data.length, 4).setFontWeight('bold');
  }

  // Column widths
  [90, 90, 70, 140, 120, 50, 95, 95, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  for (var f2 = 0; f2 < MAXFL; f2++) {
    var b2 = B + f2 * F + 1;
    [120, 130, 52, 52, 52, 52].forEach(function (w, k) { sh.setColumnWidth(b2 + k, w); });
  }
  sh.setColumnWidth(TOTAL, 70);
  sh.setFrozenRows(3);
}

// ─── WEEKLY OT (>36h/week check) ────────────────────────────────────────────
var OT_WEEK_LIMIT = 36;

/** บล็อกสัปดาห์ 7 วันในเดือน เริ่มวันที่ 1 (1-7, 8-14, 15-21, …)
 *  ตั้งแต่ มิ.ย. 2026 เป็นต้นไป: สัปดาห์สุดท้าย = 22 ถึงสิ้นเดือน (รวมวัน 29-31 เข้าสัปดาห์เดียว)
 *  ก่อน มิ.ย. 2026: คงเดิม (1-7, 8-14, 15-21, 22-28, 29-สิ้นเดือน) */
function rbWeekRange_(date) {
  // รอบสัปดาห์ = จันทร์–อาทิตย์ (ISO) ต่อเนื่อง (ข้ามเดือนได้) — ให้ตรงกับหน้า ชม./สัปดาห์
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var dow = (d.getDay() + 6) % 7;                          // 0 = จันทร์
  var start = new Date(d); start.setDate(d.getDate() - dow);
  var days = [], dayNums = [];
  for (var i = 0; i < 7; i++) { var x = new Date(start); x.setDate(start.getDate() + i); days.push(x); dayNums.push(x.getDate()); }
  var end = days[6];
  var label = (start.getMonth() === end.getMonth())
    ? (start.getDate() + '-' + end.getDate() + ' ' + MON_RB[start.getMonth()])           // 27-31 JUL
    : (start.getDate() + MON_RB[start.getMonth()] + '-' + end.getDate() + MON_RB[end.getMonth()]);  // 27JUL-2AUG
  return { start: start, end: end, days: days, dayNums: dayNums, startDay: start.getDate(), endDay: end.getDate(), label: label };
}

/** Accumulate OT hours per employee across the week (week-to-date up to `date`). */
function rbWeeklyOT_(date) {
  var wr = rbWeekRange_(date);
  var today = new Date(), people = {}, daysRead = [];
  wr.days.forEach(function (dt, idx) {
    if (dt.getTime() > today.getTime() + 43200000) return;   // วันอนาคต → ยังไม่มีไฟล์เวร
    var day = wr.dayNums[idx];
    var roster;
    try { roster = rbOpenTodayRoster_(dt); } catch (e) { return; }
    var res;
    try { res = readRosterFromSpreadsheet(roster.ss, dt); } catch (e2) { res = null; }
    if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e3) {} }
    if (!res) return;
    daysRead.push(day);
    var ll = null;
    if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, dt); } catch (e4) {} }

    function tally(team, r) {
      if ((r.bucket !== 'working' && r.bucket !== 'ot_off') || !(r.ot > 0)) return;
      var key = r.id ? ('#' + r.id) : (String(r.name).toUpperCase() + '|' + team);
      if (!people[key]) people[key] = { name: r.name, team: team, pos: r.pos || '', daily: {}, total: 0 };
      people[key].daily[day] = Math.round(((people[key].daily[day] || 0) + r.ot) * 10) / 10;
      people[key].total += r.ot;
    }
    Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { tally(t, r); }); });
    if (ll && ll.totals.staff > 0) {
      Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { tally('LL·' + s, r); }); });
    }
  });
  var list = Object.keys(people).map(function (k) { people[k].total = Math.round(people[k].total * 10) / 10; return people[k]; })
    .sort(function (a, b) { return b.total - a.total; });
  return { label: wr.label, dayNums: wr.dayNums, daysRead: daysRead, people: list,
           over: list.filter(function (p) { return p.total > OT_WEEK_LIMIT; }) };
}

/** ชื่อแท็บ OT ที่ "ถูกต้อง" (รอบ จ.–อา.) ของทุกสัปดาห์ที่คาบเกี่ยวเดือนของ date — ใช้กรองลบแท็บ OT ชื่อเก่า */
function rbValidOtTabs_(date) {
  var y = date.getFullYear(), m = date.getMonth();
  var lastDay = new Date(y, m + 1, 0).getDate();
  var first = new Date(y, m, 1), dow = (first.getDay() + 6) % 7;
  var monday = new Date(first); monday.setDate(1 - dow);          // จันทร์ของสัปดาห์ที่มีวันที่ 1
  var monthEnd = new Date(y, m, lastDay).getTime(), set = {};
  while (monday.getTime() <= monthEnd) {
    set['⏱️ OT ' + rbWeekRange_(monday).label] = 1;
    monday = new Date(monday); monday.setDate(monday.getDate() + 7);
  }
  return set;
}
/** Sheet tab: ⏱️ OT รายสัปดาห์ — per-person weekly OT + >36h flag. */
function rbWriteWeeklyOT_(ss, date, mon, tabName) {
  tabName = tabName || '⏱️ OT สัปดาห์';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  // ลบแท็บ OT ชื่อเก่า (รอบแบบเดิม เช่น "OT 1-7 JUL"/"OT 22-31 JUL") ที่ไม่ใช่รอบ จ.–อา. ของเดือนนี้
  var validOt = rbValidOtTabs_(date);
  ss.getSheets().forEach(function (s) {
    var n = s.getName();
    if (n.indexOf('⏱️ OT ') === 0 && n !== tabName && !validOt[n]) { try { ss.deleteSheet(s); } catch (e) {} }
  });
  var wk = rbWeeklyOT_(date);
  var dayCols = wk.dayNums;                                // จันทร์–อาทิตย์ (เลขวันจริง เช่น 27,28,29,30,31,1,2)
  var W = 3 + dayCols.length + 2;

  sh.getRange(1, 1, 1, W).merge()
    .setValue('⏱️ OT รายสัปดาห์ (' + wk.label + ')  •  เกิน ' + OT_WEEK_LIMIT +
              ' ชม./สัปดาห์: ' + wk.over.length + ' คน  •  อ่าน ' + wk.daysRead.length + ' วัน')
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center');
  sh.setRowHeight(1, 26);

  var head = ['ชื่อ', 'ทีม', 'ตำแหน่ง'].concat(dayCols.map(function (d) { return String(d); })).concat(['OT รวม/สัปดาห์', 'สถานะ']);
  sh.getRange(2, 1, 1, W).setValues([head]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center');

  var body = wk.people.map(function (p) {
    var row = [p.name, p.team, p.pos];
    dayCols.forEach(function (d) { row.push(p.daily[d] || ''); });
    var status = p.total > OT_WEEK_LIMIT ? '🔴 เกิน ' + OT_WEEK_LIMIT : (p.total >= 30 ? '🟡 ใกล้' : '');
    row.push(p.total, status);
    return row;
  });
  if (body.length) {
    sh.getRange(3, 1, body.length, W).setValues(body).setFontSize(9);
    for (var i = 0; i < wk.people.length; i++) {
      if (wk.people[i].total > OT_WEEK_LIMIT) sh.getRange(3 + i, 1, 1, W).setBackground('#fdecec');
      else if (wk.people[i].total >= 30) sh.getRange(3 + i, 1, 1, W).setBackground('#fff8e1');
    }
  } else {
    sh.getRange(3, 1, 1, W).merge().setValue('ยังไม่มีข้อมูล OT ในสัปดาห์นี้').setHorizontalAlignment('center');
  }
  [130, 90, 60].concat(dayCols.map(function () { return 40; })).concat([95, 90]).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
}

/** Standalone: build the weekly-OT tab for a date into the monthly file. */
function runWeeklyOTReport(y, m, d) {
  var date = (y && m && d) ? new Date(y, m - 1, d) : new Date();
  var mon = MON_RB[date.getMonth()], be = date.getFullYear() + 543;
  var out = rbGetMonthlyOutput_(mon, be);
  var wr = rbWeekRange_(date);
  rbWriteWeeklyOT_(out, date, mon, '⏱️ OT ' + wr.label);
  Logger.log('✅ Weekly OT: %s', out.getUrl());
  return out.getUrl();
}

// ─── GOOGLE CHAT ────────────────────────────────────────────────────────────
function rbPostChat_(res, dateStr, url, ll, master) {
  var webhook = PropertiesService.getScriptProperties().getProperty(CONFIG_RB.CHAT_WEBHOOK_PROP);
  if (!webhook) { Logger.log('⚠️ no webhook set in property %s', CONFIG_RB.CHAT_WEBHOOK_PROP); return; }
  var T = res.totals;
  var now = new Date();
  var hh = parseInt(Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Bangkok', 'HH'), 10);
  var clock = Utilities.formatDate(now, Session.getScriptTimeZone() || 'Asia/Bangkok', 'HH:mm');
  var round = hh < 12 ? 'รอบเช้า ☀️' : 'รอบบ่าย 🌤️';
  var lines = [
    '📊 *Daily Manpower* — ' + dateStr + '  ·  ' + round + ' (' + clock + ')',
  ];
  if (master) {
    lines.push('👥 *พนักงานทั้งหมด (Active):* PSA ' + master.PSA.total + ' + LL ' + master.LL.total +
               ' = *' + (master.PSA.total + master.LL.total) + '* คน');
  }
  lines.push('🔵 *PSA* — 👥 *' + T.staff + '*  🟢 *' + (T.working + T.ot_off) + '*  ⬛ *' + T.off +
      '*  🤒 *' + T.sick + '*  🌴 *' + T.leave + '*  ⏰ *' + T.otPeople + '* (' + T.otHours + 'h)  ✈️ *' + T.flights + '*');
  if (ll && ll.totals.staff > 0) {
    var L = ll.totals;
    lines.push('🟡 *LL* — 👥 *' + L.staff + '*  🟢 *' + (L.working + L.ot_off) + '*  ⬛ *' + L.off +
      '*  🤒 *' + L.sick + '*  🌴 *' + L.leave + '*  ⏰ *' + L.otPeople + '* (' + L.otHours + 'h)');
    lines.push('🏢 *รวม PSA+LL working: *' + (T.working + T.ot_off + L.working + L.ot_off) + '* / ' + (T.staff + L.staff) + ' คน*');
  }
  var lt = (ll && ll.totals.staff) ? ll.totals : { otPre: 0, otPreHrs: 0, otPost: 0, otPostHrs: 0, ot_off: 0, otOffHrs: 0 };
  var oPre = T.otPre + lt.otPre, oPreH = Math.round((T.otPreHrs + lt.otPreHrs) * 10) / 10;
  var oPost = T.otPost + lt.otPost, oPostH = Math.round((T.otPostHrs + lt.otPostHrs) * 10) / 10;
  var oOff = T.ot_off + lt.ot_off, oOffH = Math.round((T.otOffHrs + lt.otOffHrs) * 10) / 10;
  lines.push('⏱️ *OT ก่อนกะ:* ' + oPre + ' คน (' + oPreH + 'h)  |  *OT หลังกะ:* ' + oPost + ' คน (' + oPostH +
             'h)  |  *OT OFF:* ' + oOff + ' คน (' + oOffH + 'h)');
  try {
    var ac = acAnalyze_(res, ll).summary;
    if (ac.bad || ac.warn) {
      lines.push('🧭 *ตรวจ Assign:* 🔴 ไฟลท์นอกเวลา/ขาด OT *' + ac.bad + '*  ·  🟡 ควรตรวจ *' + ac.warn +
                 '*  (OT อาจเกิน ' + ac.otMuch + ' · ช่วงว่าง ' + ac.gap + ')');
    }
  } catch (eac) { Logger.log('⚠️ AssignCheck: ' + eac.message); }
  lines.push('', '*Top teams (working):*');
  Object.keys(res.teams).sort(function (a, b) { return res.teams[b].working - res.teams[a].working; })
    .slice(0, 8).forEach(function (t) {
      var b = res.teams[t];
      lines.push('  • ' + t + ': ' + (b.working + b.ot_off) + '/' + b.staff + '  OT ' + b.otHours + 'h  ✈️' + b.flights);
    });
  if (url) lines.push('', '🔗 ' + url);
  UrlFetchApp.fetch(webhook, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: lines.join('\n') }), muteHttpExceptions: true,
  });
}

// ─── DRIVE NAVIGATION (find today's roster, convert xlsx if needed) ─────────
function rbOpenTodayRoster_(date) {
  var dd = ('0' + date.getDate()).slice(-2);
  var mon = MON_RB[date.getMonth()];
  var mm = ('0' + (date.getMonth() + 1)).slice(-2);
  var yr2 = String(date.getFullYear()).slice(2);

  var year = DriveApp.getFolderById(CONFIG_RB.ROOT_FOLDER_ID);
  var monthFolder = rbFindMonthFolder_(year, mm, mon, yr2, date.getFullYear()) || year;
  var file = rbFindDayFile_(monthFolder, dd, mon, yr2);
  if (!file) throw new Error('ไม่พบไฟล์ roster ของวันที่ ' + dd + ' ' + mon + ' ใน ' + monthFolder.getName());

  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return { ss: SpreadsheetApp.openById(file.getId()), tempId: null, fileName: file.getName() };
  }
  var tmp = Drive.Files.copy({ title: '_TEMP_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
                             file.getId(), { convert: true });
  return { ss: SpreadsheetApp.openById(tmp.id), tempId: tmp.id, fileName: file.getName() };
}

function rbFindMonthFolder_(parent, mm, mon, yr2, year) {
  var pats = [
    new RegExp('^' + mm + '\\.?\\s*' + mon + yr2 + '$', 'i'),
    new RegExp('^' + mon + '\\s*' + yr2 + '$', 'i'),
    new RegExp('^' + mon + '\\s*' + year + '$', 'i'),
    new RegExp(mon, 'i'),
  ];
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next(), nm = f.getName();
    for (var p = 0; p < pats.length; p++) if (pats[p].test(nm)) return f;
  }
  return null;
}

function rbFindDayFile_(folder, dd, mon, yr2) {
  var d = parseInt(dd, 10);
  var pats = [
    new RegExp('^' + dd + '\\s*' + mon + yr2 + '(\\.|$| )', 'i'),
    new RegExp('^' + dd + '\\s*' + mon + '(\\.|$| )', 'i'),
    new RegExp('^' + d + '\\s*' + mon + '(\\.|$| )', 'i'),
    new RegExp('^' + dd + '\\s*' + mon, 'i'),
    new RegExp('^' + d + '\\s*' + mon, 'i'),
  ];
  var best = null;
  ['application/vnd.google-apps.spreadsheet',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].forEach(function (mime) {
    var it = folder.getFilesByType(mime);
    while (it.hasNext()) {
      var f = it.next(), nm = f.getName();
      for (var p = 0; p < pats.length; p++) {
        if (pats[p].test(nm) && (!best || p < best.p)) best = { f: f, p: p };
      }
    }
  });
  return best ? best.f : null;
}

function rbGetMonthlyOutput_(mon, be) {
  var name = 'Roster Report ' + mon + ' ' + be;
  var folder = null;
  if (CONFIG_RB.OUTPUT_FOLDER_ID) {
    try { folder = DriveApp.getFolderById(CONFIG_RB.OUTPUT_FOLDER_ID); }
    catch (e) { Logger.log('⚠️ OUTPUT_FOLDER_ID เข้าไม่ได้ (' + e.message + ') → สร้างไฟล์ใน My Drive แทน'); }
  }
  var it = folder ? folder.getFilesByName(name) : DriveApp.getFilesByName(name);
  if (it.hasNext()) return SpreadsheetApp.openById(it.next().getId());
  var ss = rbCreateSheet_(name);
  if (folder) {
    try {
      var file = DriveApp.getFileById(ss.getId());
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (e2) { Logger.log('⚠️ ย้ายไฟล์เข้าโฟลเดอร์ไม่ได้: ' + e2.message); }
  }
  return ss;
}
