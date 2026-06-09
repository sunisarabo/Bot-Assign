/**
 * AutoPlan.gs — ตัวช่วยจัดเวรอัตโนมัติ (ข้อเสนอ "อ่านอย่างเดียว" ไม่แตะไฟล์ต้นฉบับ)
 * =============================================================================
 * สร้างแท็บข้อเสนอ "🤖 จัดเวรอัตโนมัติ" จากข้อมูลที่ parse แล้ว 2 โหมด:
 *
 *   A) เติมเฉพาะไฟลท์ที่คนไม่พอ (gap-fill) — ต่อยอดจากตารางจริง
 *      ดูว่าไฟลท์ไหนส่งคนไม่ครบ SLA แล้ว "จัดคนว่าง (ข้ามทีม)" มาเสริมจริง
 *      โดยไม่ให้คนคนเดียวถูกดึงซ้ำ (commit แล้วล็อกเวลาไว้)
 *
 *   B) จัดเวรใหม่ทั้งหมด (full re-plan) — ล้างการ assign เดิม แล้วเอาคนที่
 *      ขึ้นเวรวันนั้นทั้งพูล มาจัดลงไฟลท์/บทบาทใหม่ให้ครบ SLA ทุกไฟลท์
 *
 * ใช้ primitive จาก SLA.gs / AssignCheck.gs ทั้งหมด:
 *   slaCollectFlights_ · slaSupportPool_ · slaTeamSystems_ · slaPhaseWindow_ ·
 *   slaNeedSys_ · slaWinTxt_ · slaReq_ · acOwnerTeams_ · rrFmtMin_
 *
 * หลักการจัด (greedy): ไล่ไฟลท์ตามเวลา → แต่ละ phase ที่ต้องการ → เลือกคนที่
 *   1) ระบบเช็คอินตรง (เฉพาะ CI/SUP, iPort = ใครก็ได้)  2) ตำแหน่งเหมาะกับ phase
 *   3) เวลางานครอบช่วงนั้น & ไม่ติดไฟลท์อื่น  4) งานยังน้อย (กระจายงาน)
 * เลือกได้ก็ "ล็อก" เวลาคนนั้นไว้ กันโดนจัดซ้ำ. ถ้าไม่พอ → บันทึกว่ายังขาดกี่คน.
 *
 * Entry: apFillGaps_(res, ll) · apReplan_(res, ll)
 *        rbWriteFillPlan_ / rbWriteAutoAssign_ (ชีต) · rbFillPlanHtml / rbAutoAssignHtml (เว็บ)
 */

var AP_TOL = 30;   // ผ่อนเวลาเข้า/ออกงานรอบหน้าต่าง phase (นาที)

/** clone พูลคนว่าง ให้พร้อมจัด (ก๊อป busy เพื่อไม่กระทบของจริง + ตัวนับงานที่จัด) */
function apClonePool_(res, ll) {
  var teamSys = slaTeamSystems_(res, ll);
  var pool = slaSupportPool_(res, ll, teamSys);
  pool.forEach(function (p) {
    p.busy = (p.busy || []).map(function (b) { return [b[0], b[1]]; });   // clone กัน mutate ของจริง
    p.plan = 0;                                                           // จำนวนที่จัดให้ในแผนนี้
  });
  return pool;
}

/** คน p ว่างในหน้าต่าง win ไหม (เวลางานครอบ + ไม่ชนงานที่ถือ/จัดไว้แล้ว) */
function apFree_(p, win) {
  if (!win) return true;                                                  // ไม่มีเวลา → ไม่จำกัด
  if (!(p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL)) return false;
  for (var i = 0; i < p.busy.length; i++) {
    var b = p.busy[i];
    if (win[0] < b[1] - 10 && win[1] > b[0] + 10) return false;           // ซ้อนทับ
  }
  return true;
}

/** คน p ทำ phase ph ของไฟลท์ f ได้ไหม (ระบบ + ตำแหน่ง + เวลาว่าง) */
function apEligible_(p, f, ph, win, sameTeamOk) {
  if (!sameTeamOk && f.teams && f.teams[p.team]) return false;            // โหมดเสริม = ข้ามทีมเท่านั้น
  var needSys = slaNeedSys_(f.airline, ph);
  if (needSys && !p.sys[slaSysNorm_(needSys)]) return false;              // CI/SUP ต้องรู้ระบบ (ยกเว้น iPort)
  if (ph === 'SUP' && p.posGroup !== 'PSS') return false;                 // SUP/Flight Controller ต้องเป็น Sup
  return apFree_(p, win);
}

/** คะแนนเลือกคน (น้อย = ดีกว่า): ตำแหน่งเหมาะ + ทีมเดิม + งานน้อย */
function apScore_(p, ph, homeTeam) {
  var s = 0;
  if (ph === 'SUP')      s += (p.posGroup === 'PSS' ? 0 : 6);
  else if (ph === 'CI')  s += (p.posGroup === 'PSA' ? 0 : (p.posGroup === 'SNR' ? 1 : 3));
  else                   s += (p.posGroup === 'PSA' ? 0 : (p.posGroup === 'SNR' ? 1 : 2));   // GATE/ARR
  if (homeTeam && p.team === homeTeam) s -= 3;                            // ลดการสลับข้ามทีม
  s += p.plan * 2;                                                        // กระจายงาน
  return s;
}

/** เลือกคนดีที่สุด 1 คนมาจัด 1 สลอต แล้ว "ล็อก" เวลาไว้ (กันจัดซ้ำ) */
function apPick_(pool, f, ph, win, sameTeamOk, homeTeam) {
  var best = null, bs = 1e9;
  for (var i = 0; i < pool.length; i++) {
    var p = pool[i];
    if (!apEligible_(p, f, ph, win, sameTeamOk)) continue;
    var sc = apScore_(p, ph, homeTeam);
    if (sc < bs) { bs = sc; best = p; }
  }
  if (best) {
    if (win) best.busy.push([win[0], win[1]]);
    best.plan++;
  }
  return best;
}

var AP_PHASES = ['SUP', 'CI', 'ARR', 'GATE'];     // ลำดับจัด: ระบบ/หายากก่อน (SUP, CI) แล้วค่อย ARR/GATE

/** ข้อมูลคนที่ถูกจัด (พร้อมรายละเอียดงาน/OT/ไฟลท์ สำหรับโชว์ชิพ + popup) */
function apPersonView_(p) {
  return { name: p.name, pos: slaPosShort_(p.posGroup), team: p.team,
           shift: p.shiftDisp, ot: p.otDisp, hrs: p.hrs, n: p.nflt, flts: p.flts || [] };
}

/** โหมด A: เติมเฉพาะไฟลท์ที่คนไม่พอ — เลือกคนว่างข้ามทีมมาเสริมจริง (commit) */
function apFillGaps_(res, ll) {
  var flights = slaCollectFlights_(res, ll);
  var pool = apClonePool_(res, ll);
  var rows = [];
  flights.filter(function (f) { return acIsFlight_(f.flight) && !f.ok; }).forEach(function (f) {
    AP_PHASES.forEach(function (ph) {
      var need = f.short[ph]; if (!need) return;
      var win = slaPhaseWindow_(f, ph);
      var picked = [];
      for (var k = 0; k < need; k++) {
        var p = apPick_(pool, f, ph, win, false, null);                   // ข้ามทีม
        if (!p) break;
        picked.push(apPersonView_(p));
      }
      rows.push({
        flight: f.flight, airline: f.airline, std: f.STD || f.STA || '',
        phase: SLA_PH_LB[ph], need: need, win: slaWinTxt_(f, ph),
        needSys: slaNeedSys_(f.airline, ph),
        picked: picked, remain: need - picked.length,
      });
    });
  });
  return rows;
}

/** โหมด B: จัดเวรใหม่ทั้งหมด — ล้าง assign เดิม แล้วจัดทุกคนลงไฟลท์ให้ครบ SLA */
function apReplan_(res, ll) {
  var flights = slaCollectFlights_(res, ll);
  var owner = acOwnerTeams_(res, ll);
  var pool = apClonePool_(res, ll);
  pool.forEach(function (p) { p.busy = []; p.plan = 0; });                // จัดใหม่ → ล้างงานเดิมทั้งหมด

  var fl = flights.filter(function (f) { return acIsFlight_(f.flight); }).sort(function (a, b) {
    return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz'));
  });

  var plan = [];
  fl.forEach(function (f) {
    var home = owner[f.airline] || (f.teamList || '').split(',')[0] || '';
    var assign = { SUP: [], CI: [], ARR: [], GATE: [] };
    var shortx = {};
    var phaseReq = { SUP: f.req.SUP, CI: f.req.CI, ARR: f.req.ARR, GATE: f.req.GATE };
    // TTL เกินผลรวม phase = พนักงานเสริม (เกท "จากเช็คอิน") → ปกติลงเป็น Check-in agent
    // แต่สายการบินที่ "ไม่มีเช็คอิน" (เช่น PG: CI=0 ตาม SLA) ให้ลงเป็น Gate agent แทน
    var sumPh = f.req.SUP + f.req.CI + f.req.ARR + f.req.GATE;
    var extra = Math.max(0, (f.req.total || 0) - sumPh);
    if (f.req.CI > 0) phaseReq.CI += extra; else phaseReq.GATE += extra;
    AP_PHASES.forEach(function (ph) {
      if (!phaseReq[ph]) return;                                         // ไม่ต้องการ phase นี้ (เช่น PG ไม่มีเช็คอิน)
      var win = slaPhaseWindow_(f, ph);
      for (var k = 0; k < phaseReq[ph]; k++) {
        var p = apPick_(pool, f, ph, win, true, home);                   // จัดใหม่ = ทีมเดียวกันได้
        if (p) assign[ph].push(apPersonView_(p));
        else { shortx[ph] = phaseReq[ph] - k; break; }
      }
    });
    var totAssigned = assign.SUP.length + assign.CI.length + assign.ARR.length + assign.GATE.length;
    plan.push({ flight: f.flight, airline: f.airline, system: slaSystemOf_(f.airline),
      std: f.STD || '', sta: f.STA || '', home: home, req: f.req, phaseReq: phaseReq,
      assign: assign, shortx: shortx, totReq: phaseReq.SUP + phaseReq.CI + phaseReq.ARR + phaseReq.GATE,
      totAssigned: totAssigned });
  });

  var bench = pool.filter(function (p) { return p.plan === 0; })
    .map(function (p) { return { name: p.name, pos: slaPosShort_(p.posGroup), team: p.team, shift: p.shiftDisp, sys: p.sys }; });
  return { plan: plan, bench: bench, nPeople: pool.length,
    nAssigned: pool.filter(function (p) { return p.plan > 0; }).length,
    nFlights: plan.length };
}

/** รวมรายชื่อคนเป็นข้อความสั้น (จัดกลุ่มตามทีม) */
function apNames_(arr) {
  if (!arr.length) return '';
  var by = {}, order = [];
  arr.forEach(function (p) { if (!by[p.team]) { by[p.team] = []; order.push(p.team); } by[p.team].push(p.name + '(' + p.pos + ')'); });
  return order.map(function (t) { return '[' + t + '] ' + by[t].join(', '); }).join('  ·  ');
}

// ─── แท็บ 1: "🤖 เติม Assign เดิม" (โหมด A) ──────────────────────────────────
function rbWriteFillPlan_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🤖 เติม Assign เดิม';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var W = 9;

  var gaps = apFillGaps_(res, ll);
  var filledN = 0, remainN = 0;
  gaps.forEach(function (g) { filledN += g.picked.length; remainN += g.remain; });

  sh.getRange(1, 1, 1, W).merge()
    .setValue('🤖 เติมจาก Assign เดิม — จัดคนว่างข้ามทีมมาเสริมไฟลท์ที่ขาด (ข้อเสนอ แก้ชื่อในเซลล์ได้) — ' + dateStr)
    .setBackground('#1b3a2b').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  sh.getRange(2, 1, 1, W).merge()
    .setValue('เสริม ' + filledN + ' คน' + (remainN ? ('  ·  ยังขาดอีก ' + remainN + ' คน (ไม่มีคนว่าง/ระบบตรง)') : '  ·  เติมครบทุกตำแหน่ง ✅'))
    .setBackground('#2e5d3e').setFontColor('#fff').setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
  sh.setRowHeight(2, 22);
  var headA = ['Flight', 'สายการบิน', 'STD/STA', 'ตำแหน่งที่ขาด', 'จำนวน', 'ช่วงเวลา', 'ระบบที่ต้องใช้', 'คนที่จัดให้ (ข้ามทีม + งาน/OT/ไฟลท์)', 'สถานะ'];
  sh.getRange(3, 1, 1, W).setValues([headA]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  if (!gaps.length) {
    sh.getRange(4, 1, 1, W).merge().setValue('✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA แล้ว — ไม่ต้องเสริม')
      .setBackground('#e8f5e9').setFontColor('#1b5e20').setFontWeight('bold').setHorizontalAlignment('center');
  } else {
    var bodyA = gaps.map(function (g) {
      var who = g.picked.length ? apNamesFull_(g.picked) : (g.needSys ? '— ไม่มีคนว่างที่รู้ระบบ ' + g.needSys : '— ไม่มีคนว่าง');
      var st = g.remain === 0 ? '✅ เติมครบ' : (g.picked.length ? ('⚠️ ยังขาด ' + g.remain) : '🔴 ขาด ' + g.remain);
      return [g.flight, g.airline, g.std, g.phase + (g.needSys ? ' (' + g.needSys + ')' : ''), g.need, g.win, g.needSys || 'iPort/ใดก็ได้', who, st];
    });
    sh.getRange(4, 1, bodyA.length, W).setValues(bodyA).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (var i = 0; i < gaps.length; i++) {
      sh.getRange(4 + i, 1, 1, W).setBackground(gaps[i].remain === 0 ? '#f1f8e9' : (gaps[i].picked.length ? '#fff8e1' : '#fdecec'));
    }
  }
  [110, 70, 80, 130, 55, 95, 110, 340, 90].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  return { gapFilled: filledN, gapRemain: remainN };
}

// ─── แท็บ 2: "🤖 Auto Assign" (โหมด B) ──────────────────────────────────────
function rbWriteAutoAssign_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🤖 Auto Assign';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var W = 9;

  var rp = apReplan_(res, ll);
  var shortF = 0;
  rp.plan.forEach(function (p) { if (Object.keys(p.shortx).length) shortF++; });

  sh.getRange(1, 1, 1, W).merge()
    .setValue('🤖 Auto Assign — จัดเวรใหม่ทั้งหมดตาม SLA (ข้อเสนอ แก้ชื่อในเซลล์ได้) — ' + dateStr)
    .setBackground('#1b3a2b').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  sh.getRange(2, 1, 1, W).merge()
    .setValue('จัดคน ' + rp.nAssigned + '/' + rp.nPeople + ' คน ลง ' + rp.nFlights + ' ไฟลท์  ·  พัก/สำรอง ' + rp.bench.length +
              ' คน' + (shortF ? ('  ·  ' + shortF + ' ไฟลท์ยังขาด') : '  ·  ครบทุกไฟลท์ ✅'))
    .setBackground('#2e5d3e').setFontColor('#fff').setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
  sh.setRowHeight(2, 22);
  var headB = ['Flight', 'สายการบิน', 'ระบบ', 'STA', 'STD', 'SUP', 'Check-in', 'Gate', 'Arrival'];
  sh.getRange(3, 1, 1, W).setValues([headB]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  function phCell(arr, req, shortN) {
    if (!req) return '— ไม่มี';                                          // เช่น PG ไม่มีเช็คอิน
    var t = apNamesFull_(arr) || '—';
    return arr.length + '/' + req + (shortN ? ' ⚠️ขาด' + shortN : ' ✓') + (arr.length ? '\n' + t : '');
  }
  var bodyB = rp.plan.map(function (p) {
    return [p.flight, p.airline, p.system || 'iPort', p.sta, p.std,
            phCell(p.assign.SUP, p.phaseReq.SUP, p.shortx.SUP),
            phCell(p.assign.CI, p.phaseReq.CI, p.shortx.CI),
            phCell(p.assign.GATE, p.phaseReq.GATE, p.shortx.GATE),
            phCell(p.assign.ARR, p.phaseReq.ARR, p.shortx.ARR)];
  });
  var row = 4;
  if (bodyB.length) {
    sh.getRange(row, 1, bodyB.length, W).setValues(bodyB).setFontSize(8).setVerticalAlignment('top').setWrap(true);
    for (var j = 0; j < rp.plan.length; j++) {
      var ok = Object.keys(rp.plan[j].shortx).length === 0;
      sh.getRange(row + j, 1, 1, W).setBackground(ok ? (j % 2 ? '#f1f8e9' : '#fff') : '#fff3cd');
    }
    row += bodyB.length;
  }
  row++;
  sh.getRange(row, 1, 1, W).merge()
    .setValue('คนพัก/สำรอง (ยังไม่ถูกจัด) — ' + rp.bench.length + ' คน')
    .setBackground('#37474f').setFontColor('#fff').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  row++;
  if (rp.bench.length) {
    var byTeam = {}, ord = [];
    rp.bench.forEach(function (b) { if (!byTeam[b.team]) { byTeam[b.team] = []; ord.push(b.team); } byTeam[b.team].push(b.name + '(' + b.pos + ')'); });
    var benchTxt = ord.map(function (t) { return '[' + t + '] ' + byTeam[t].join(', '); }).join('   ·   ');
    sh.getRange(row, 1, 1, W).merge().setValue(benchTxt).setFontSize(9).setVerticalAlignment('top').setWrap(true).setBackground('#eceff1');
    sh.setRowHeight(row, Math.min(300, 20 + Math.ceil(benchTxt.length / 140) * 16));
  }
  [110, 70, 90, 55, 55, 190, 240, 220, 190].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  return { replanAssigned: rp.nAssigned, bench: rp.bench.length, shortFlights: shortF };
}

/** รายชื่อคน (จัดกลุ่มทีม) แบบมีรายละเอียดงาน/OT/ไฟลท์ — สำหรับเซลล์ในชีต */
function apNamesFull_(arr) {
  if (!arr.length) return '';
  var by = {}, order = [];
  arr.forEach(function (p) { if (!by[p.team]) { by[p.team] = []; order.push(p.team); } by[p.team].push(p); });
  return order.map(function (t) {
    return '[' + t + '] ' + by[t].map(function (p) {
      var fl = (p.flts && p.flts.length) ? ' {' + p.flts.join(', ') + '}' : '';
      var ot = (p.ot && p.ot !== '-') ? ' OT:' + p.ot : '';
      return p.name + '(' + p.pos + ' · กะ ' + (p.shift || '-') + ot + fl + ')';
    }).join(', ');
  }).join('\n');
}
