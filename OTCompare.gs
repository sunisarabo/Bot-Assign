/**
 * OTCompare.gs — ตรวจ OT: ขอจริง (HumanSoft) เทียบ แผน (Assignment Plan)
 * =============================================================================
 * ยกฟีเจอร์จากโปรเจกต์ "OT Daily & Team Analytics" มาไว้ใน PAS เป็นแท็บเว็บ
 *   • เทียบ OT 2 ฝั่ง แล้วหา "ขอจริงแต่ไม่ได้ลง Plan / เกิน PLAN"
 *   • อ่านจากสเปรดชีตต้นทาง (ชีต 'ทีม', 'ชีต1'/'สำเนาของ ชีต1', 'วันที่ 7/8/9')
 *   • ไอดีไฟล์: Script Property HUMANSOFT_OT_FILE_ID (ไม่ตั้ง = ใช้ค่า fallback)
 *
 * แสดงผล: แท็บ "🔍 ตรวจ OT (ขอจริง vs แผน)" บนหน้าเว็บ PAS  →  rbOTCompareHtml(iso)
 */

var OTC_FILE_ID_FALLBACK = '19Dz_NUdCEgYaY_FHwkolgETc7Z4khqLtJDdKKeO-6IE';
var OTC_DATES = ['07/09/2026', '08/09/2026', '09/09/2026'];        // วันที่ที่เทียบ (dd/mm/yyyy)
var OTC_SHEET_MAP = { '07/09/2026': 'วันที่ 7', '08/09/2026': 'วันที่ 8', '09/09/2026': 'วันที่ 9' };

function otcFileId_() {
  var id = null;
  try { id = PropertiesService.getScriptProperties().getProperty('HUMANSOFT_OT_FILE_ID'); } catch (e) {}
  return id || OTC_FILE_ID_FALLBACK;
}

/** ── helpers (ยกมาจากโปรเจกต์เดิม) ── */
function otcParsePlanHrs_(planText) {
  if (!planText) return 0;
  var m = String(planText).match(/(\d+(\.\d+)?)\s*h/i);
  return m ? parseFloat(m[1]) : 0;
}
function otcFmtTime_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return ('0' + val.getHours()).slice(-2) + ':' + ('0' + val.getMinutes()).slice(-2);
  }
  return String(val).trim();
}
function otcParseHrs_(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (Object.prototype.toString.call(val) === '[object Date]') return val.getHours() + (val.getMinutes() / 60);
  var s = String(val).trim();
  if (s.indexOf(':') !== -1) { var p = s.split(':'); return (parseFloat(p[0]) || 0) + ((parseFloat(p[1]) || 0) / 60); }
  return parseFloat(s) || 0;
}

/** ── data: เทียบ HumanSoft (ขอจริง) vs Assignment Plan (แผน) ── */
function rbOTCompareData_(fileId) {
  var ss = SpreadsheetApp.openById(fileId || otcFileId_());

  // 1) master ทีม จากชีต "ทีม"
  var teamSheet = ss.getSheetByName('ทีม'), empInfoMap = {};
  if (teamSheet) {
    var tData = teamSheet.getDataRange().getValues();
    for (var i = 1; i < tData.length; i++) {
      var code = String(tData[i][0]).trim();
      if (code) empInfoMap[code] = { team: String(tData[i][1]).trim() || 'ไม่ระบุทีม', position: 'เจ้าหน้าที่' };
    }
  }

  // 2) HumanSoft (ขอจริง)
  var hsSheet = ss.getSheetByName('สำเนาของ ชีต1') || ss.getSheetByName('ชีต1');
  if (!hsSheet) throw new Error('ไม่พบชีตข้อมูล HumanSoft (สำเนาของ ชีต1 / ชีต1) ในไฟล์ต้นทาง');
  var hsData = hsSheet.getDataRange().getValues(), hsRecords = [];
  var curCode = '', curName = '', curPos = '';
  for (var i = 0; i < hsData.length; i++) {
    var col0 = String(hsData[i][0]).trim(), col1 = String(hsData[i][1]).trim(), col2 = String(hsData[i][2]).trim();
    if (col0.match(/^\d{6,7}$/)) { curCode = col0; curName = col1; curPos = col2 || 'เจ้าหน้าที่'; }
    else if (col1.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      var hoursNum = otcParseHrs_(hsData[i][11]);
      var masterInfo = empInfoMap[curCode] || {};
      hsRecords.push({
        empCode: curCode, empName: curName, position: curPos || masterInfo.position || 'เจ้าหน้าที่',
        date: col1, team: masterInfo.team || String(hsData[i][3]).trim() || 'ไม่ระบุทีม',
        timeStart: otcFmtTime_(hsData[i][8]), timeEnd: otcFmtTime_(hsData[i][9]),
        hoursNum: hoursNum, reason: String(hsData[i][12] || 'ไม่ได้ระบุ').trim()
      });
    }
  }

  // 3) Assignment Plan (แผน) จากชีต "วันที่ N"
  var assignDataMap = {}, assignDailyStats = {}, teamPlanStats = {};
  OTC_DATES.forEach(function (dStr) {
    var sheet = ss.getSheetByName(OTC_SHEET_MAP[dStr]);
    assignDailyStats[dStr] = { items: 0, peopleSet: {}, teamsSet: {} };
    teamPlanStats[dStr] = {};
    if (!sheet) return;
    var aData = sheet.getDataRange().getValues();
    for (var r = 2; r < aData.length; r++) {
      var empCode = String(aData[r][2]).trim(), rawTeam = String(aData[r][1]).trim(),
          rawPos = String(aData[r][3]).trim(), otPlan = String(aData[r][6]).trim();
      if (empCode && otPlan !== '' && otPlan !== '-') {
        var masterInfo = empInfoMap[empCode] || {};
        var teamName = masterInfo.team || rawTeam || 'ไม่ระบุทีม', planHours = otcParsePlanHrs_(otPlan);
        assignDataMap[dStr + '_' + empCode] = { otPlan: otPlan, hours: planHours, team: teamName, position: rawPos };
        assignDailyStats[dStr].items++;
        assignDailyStats[dStr].peopleSet[empCode] = true;
        assignDailyStats[dStr].teamsSet[teamName] = true;
        if (!teamPlanStats[dStr][teamName]) teamPlanStats[dStr][teamName] = { peopleMap: {}, hours: 0 };
        teamPlanStats[dStr][teamName].peopleMap[empCode] = planHours;
        teamPlanStats[dStr][teamName].hours += planHours;
      }
    }
  });

  // 4) ส่วนต่าง + รายการหลุด
  var unassignedDetails = [], dailySummary = {}, teamActualStats = {};
  OTC_DATES.forEach(function (dStr) {
    dailySummary[dStr] = { hsItems: 0, hsPeopleSet: {}, hsTeamsSet: {}, unassignedItems: 0, unassignedPeopleSet: {}, unassignedHours: 0 };
    teamActualStats[dStr] = {};
  });
  hsRecords.forEach(function (rec) {
    var dStr = rec.date; if (!dailySummary[dStr]) return;
    var tName = rec.team;
    dailySummary[dStr].hsItems++;
    dailySummary[dStr].hsPeopleSet[rec.empCode] = true;
    dailySummary[dStr].hsTeamsSet[tName] = true;
    if (!teamActualStats[dStr][tName]) teamActualStats[dStr][tName] = { hsPeopleMap: {}, hsHours: 0, unPeopleSet: {}, unHours: 0, unItems: 0 };
    if (!teamActualStats[dStr][tName].hsPeopleMap[rec.empCode]) teamActualStats[dStr][tName].hsPeopleMap[rec.empCode] = 0;
    teamActualStats[dStr][tName].hsPeopleMap[rec.empCode] += rec.hoursNum;
    teamActualStats[dStr][tName].hsHours += rec.hoursNum;
    if (!assignDataMap[dStr + '_' + rec.empCode]) {
      dailySummary[dStr].unassignedItems++;
      dailySummary[dStr].unassignedPeopleSet[rec.empCode] = true;
      dailySummary[dStr].unassignedHours += rec.hoursNum;
      teamActualStats[dStr][tName].unPeopleSet[rec.empCode] = true;
      teamActualStats[dStr][tName].unHours += rec.hoursNum;
      teamActualStats[dStr][tName].unItems++;
      unassignedDetails.push({
        date: rec.date, empCode: rec.empCode, empName: rec.empName, position: rec.position, team: tName,
        timeRange: rec.timeStart + ' - ' + rec.timeEnd, hours: rec.hoursNum, reason: rec.reason
      });
    }
  });

  // 5) รวมสรุป
  var summaryByDate = {}, teamSummaryByDate = {};
  OTC_DATES.forEach(function (dStr) {
    var hsP = Object.keys(dailySummary[dStr].hsPeopleSet).length, asP = Object.keys(assignDailyStats[dStr].peopleSet).length;
    var hsI = dailySummary[dStr].hsItems, asI = assignDailyStats[dStr].items;
    summaryByDate[dStr] = {
      date: dStr, hsTeams: Object.keys(dailySummary[dStr].hsTeamsSet).length, hsPeople: hsP, hsItems: hsI,
      asTeams: Object.keys(assignDailyStats[dStr].teamsSet).length, asPeople: asP, asItems: asI,
      diffPeople: hsP - asP, diffItems: hsI - asI,
      unPeople: Object.keys(dailySummary[dStr].unassignedPeopleSet).length,
      unItems: dailySummary[dStr].unassignedItems, unHours: dailySummary[dStr].unassignedHours
    };
    var daySet = {};
    Object.keys(teamActualStats[dStr]).forEach(function (t) { daySet[t] = true; });
    Object.keys(teamPlanStats[dStr]).forEach(function (t) { daySet[t] = true; });
    var teamList = [];
    Object.keys(daySet).sort().forEach(function (tName) {
      var act = teamActualStats[dStr][tName] || { hsPeopleMap: {}, hsHours: 0, unPeopleSet: {}, unHours: 0 };
      var pln = teamPlanStats[dStr][tName] || { peopleMap: {}, hours: 0 };
      teamList.push({
        team: tName, hsPeople: Object.keys(act.hsPeopleMap).length, hsHours: act.hsHours,
        planPeople: Object.keys(pln.peopleMap).length, planHours: pln.hours,
        unPeople: Object.keys(act.unPeopleSet).length, unHours: act.unHours
      });
    });
    teamSummaryByDate[dStr] = teamList;
  });

  return { dates: OTC_DATES, summaryByDate: summaryByDate, teamSummaryByDate: teamSummaryByDate, details: unassignedDetails };
}

/** ── Lazy tab: 🔍 ตรวจ OT (ขอจริง vs แผน) — render server-side สลับวันที่ในตัว ── */
function rbOTCompareHtml(iso) {
  try {
    var D = rbOTCompareData_(otcFileId_());
    function f2(n) { return (Math.round((n || 0) * 100) / 100).toFixed(2); }
    var pills = '', days = '';
    D.dates.forEach(function (dStr, idx) {
      pills += '<button class="otcpill' + (idx === 0 ? ' active' : '') + '" onclick="' +
        "var w=this.closest('.otc-wrap');[].forEach.call(w.querySelectorAll('.otcpill'),function(b){b.classList.remove('active')});this.classList.add('active');" +
        "[].forEach.call(w.querySelectorAll('.otc-day'),function(d){d.style.display='none'});var t=w.querySelector('#otc-" + idx + "');if(t)t.style.display='';" +
        '">' + rbEsc_(dStr) + '</button>';

      var s = D.summaryByDate[dStr] || {};
      // KPI cards
      var kpi = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
        otcCard_('ชั่วโมง OT นอกแผน (เกิน PLAN)', f2(s.unHours) + ' <small>ชม.</small>', '#ef4444', '#fef2f2') +
        otcCard_('รายการหลุด Assign', (s.unItems || 0) + ' <small>รายการ</small>', '#f59e0b', '#fffbeb') +
        otcCard_('ขอจริงแต่ไม่ได้ลง Plan', (s.unPeople || 0) + ' <small>คน</small>', '#3b82f6', '#eff6ff') + '</div>';

      // daily comparison
      function dcell(v, warn) { return '<td class="tnum b" style="text-align:center' + (warn ? ';color:#c0392b' : '') + '">' + v + '</td>'; }
      var daily = rbTblCard_('📊 สรุปเปรียบเทียบภาพรวม — ' + rbEsc_(dStr),
        '<tr><th>รายการวิเคราะห์</th><th style="text-align:center">HumanSoft (ขอจริง)</th><th style="text-align:center">Assignment Plan (แผน)</th><th style="text-align:center">ส่วนต่าง</th></tr>',
        '<tr><td>• จำนวนทีมที่ขอ OT</td><td class="tnum" style="text-align:center">' + (s.hsTeams || 0) + '</td><td class="tnum" style="text-align:center">' + (s.asTeams || 0) + '</td>' + dcell((s.hsTeams - s.asTeams), (s.hsTeams - s.asTeams) !== 0) + '</tr>' +
        '<tr><td>• จำนวนคน (Headcount)</td><td class="tnum" style="text-align:center">' + (s.hsPeople || 0) + '</td><td class="tnum" style="text-align:center">' + (s.asPeople || 0) + '</td>' + dcell(s.diffPeople, s.diffPeople !== 0) + '</tr>' +
        '<tr><td>• จำนวนรายการ OT</td><td class="tnum" style="text-align:center">' + (s.hsItems || 0) + '</td><td class="tnum" style="text-align:center">' + (s.asItems || 0) + '</td>' + dcell(s.diffItems, s.diffItems !== 0) + '</tr>');

      // team table
      var tl = D.teamSummaryByDate[dStr] || [], tHsP = 0, tHsH = 0, tPlP = 0, tPlH = 0, tUnP = 0, tUnH = 0, trs = '';
      tl.forEach(function (t) {
        tHsP += t.hsPeople; tHsH += t.hsHours; tPlP += t.planPeople; tPlH += t.planHours; tUnP += t.unPeople; tUnH += t.unHours;
        var un = t.unPeople > 0 ? '<b style="color:#c0392b">' + t.unPeople + ' คน <small>(+' + f2(t.unHours) + ' ชม.)</small></b>' : '<span class="muted">-</span>';
        trs += '<tr' + (t.unPeople > 0 ? ' style="background:#fef2f2"' : '') + '><td class="b">' + rbEsc_(t.team) + '</td><td class="tnum" style="text-align:center">' + t.hsPeople + '</td><td class="tnum" style="text-align:right">' + f2(t.hsHours) +
          '</td><td class="tnum" style="text-align:center">' + t.planPeople + '</td><td class="tnum" style="text-align:right">' + (t.planHours > 0 ? f2(t.planHours) : '-') + '</td><td style="text-align:center">' + un + '</td></tr>';
      });
      if (!trs) trs = '<tr><td colspan="6" class="muted" style="text-align:center;padding:14px">ไม่พบข้อมูลทีมในวันนี้</td></tr>';
      else trs += '<tr class="b" style="background:#f1f5f9"><td>รวมทั้งหมด (' + tl.length + ' ทีม)</td><td class="tnum" style="text-align:center">' + tHsP + '</td><td class="tnum" style="text-align:right">' + f2(tHsH) +
        '</td><td class="tnum" style="text-align:center">' + tPlP + '</td><td class="tnum" style="text-align:right">' + f2(tPlH) + '</td><td style="text-align:center;color:#c0392b">' + (tUnP > 0 ? tUnP + ' คน (+' + f2(tUnH) + ' ชม.)' : '-') + '</td></tr>';
      var team = rbTblCard_('👥 สรุป OT จำแนกรายทีม — ' + rbEsc_(dStr),
        '<tr><th>ทีม</th><th style="text-align:center">ขอจริง (คน)</th><th style="text-align:right">ขอจริง (ชม.)</th><th style="text-align:center">PLAN (คน)</th><th style="text-align:right">PLAN (ชม.)</th><th style="text-align:center;background:#fef2f2;color:#991b1b">เกิน PLAN / หลุดแผน (คน/ชม.)</th></tr>', trs);

      // detail table
      var det = D.details.filter(function (d) { return d.date === dStr; }), drs = '';
      det.forEach(function (d) {
        drs += '<tr><td><code>' + rbEsc_(d.empCode) + '</code></td><td class="b">' + rbEsc_(d.empName) + '</td><td>' + rbEsc_(d.position) + '</td><td>' + rbEsc_(d.team) +
          '</td><td>' + rbEsc_(d.timeRange) + '</td><td class="tnum b" style="text-align:right;color:#c0392b">' + f2(d.hours) + '</td><td class="muted" style="font-size:11px">' + rbEsc_(d.reason) + '</td></tr>';
      });
      if (!drs) drs = '<tr><td colspan="7" class="okk" style="text-align:center;padding:16px">✅ ไม่พบรายการที่หลุด Assign ในวันนี้</td></tr>';
      var detail = rbTblCard_('🚩 รายชื่อคนขอจริง แต่ไม่ได้ลง Assign — ' + rbEsc_(dStr),
        '<tr><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>ทีม</th><th>ช่วงเวลา OT</th><th style="text-align:right">จำนวน (ชม.)</th><th>เหตุผลใน HumanSoft</th></tr>', drs);

      days += '<div class="otc-day" id="otc-' + idx + '"' + (idx === 0 ? '' : ' style="display:none"') + '>' + kpi + daily + team + detail + '</div>';
    });

    var css = '<style>.otcpill{border:1.5px solid #cbd5e1;background:#fff;color:#64748b;border-radius:30px;padding:6px 18px;font-weight:500;cursor:pointer;margin:2px}.otcpill.active{background:#3b82f6;color:#fff;border-color:#3b82f6}</style>';
    var hd = '<div class="sectionlabel">🔍 ตรวจ OT — ขอจริง (HumanSoft) เทียบ แผน (Assignment) · เลือกวันที่ด้านล่าง' +
      '<div class="muted" style="font-size:11px;margin-top:2px">แดง = คน/ชม. ที่ขอจริงแต่ไม่ได้ลง Plan (หลุด Assign / เกิน PLAN) · อ่านจากไฟล์ต้นทาง HumanSoft</div></div>';
    return css + '<div class="otc-wrap">' + hd +
      '<div style="margin:8px 0 14px">' + pills + '</div>' + days + '</div>';
  } catch (e) {
    return '<div class="panel">โหลดตรวจ OT ไม่ได้: ' + rbEsc_(e.message) +
      '<div class="muted" style="margin-top:6px;font-size:12px">ตรวจว่าบัญชีที่รัน PAS มีสิทธิ์เข้าไฟล์ต้นทาง (HUMANSOFT_OT_FILE_ID) และมีชีต ทีม / ชีต1 / วันที่ 7-9</div></div>';
  }
}

function otcCard_(label, val, bar, bg) {
  return '<div style="flex:1;min-width:200px;background:' + bg + ';border-left:5px solid ' + bar + ';border-radius:12px;padding:14px 16px">' +
    '<div class="muted" style="font-size:12px">' + label + '</div><div style="font-size:22px;font-weight:700;color:' + bar + ';margin-top:4px">' + val + '</div></div>';
}
