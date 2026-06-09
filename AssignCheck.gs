/**
 * AssignCheck.gs — ตรวจความเหมาะสมของการ Assign รายคน
 * =============================================================================
 * ต่อยอดจาก record ที่ RosterReader ผลิต (shiftTime / shiftStart / shiftHrs,
 * ot / otType / otTime, assignments[]{flight,task,STA,STD,OP,CL}) เพื่อตอบ 4 คำถาม
 * ที่หัวหน้าใช้ตัดสินตารางจริง:
 *
 *   1) เวลากะ (รวม OT) ครอบคลุมเที่ยวบินที่ได้รับมอบหมายไหม  → COVERAGE
 *   2) ให้ OT มาก/น้อยไปไหม                                  → OT FIT
 *   3) มีช่วงว่าง (idle gap) ตรงไหนบ้าง                        → GAP
 * คนที่ไม่มีไฟลท์เลย (bench/standby/support เช่น WY SNR/Agent) จะนับเป็น
 * ตัวเลขสรุปเฉย ๆ ไม่ flag เป็นปัญหารายแถว เพื่อไม่ให้ตารางรก.
 *
 * หน้าต่าง "เวลางาน" (duty window) = ช่วงเวลากะ ขยายด้วย OT ก่อนกะ/หลังกะ
 * (ถ้ามีช่วงเวลา OT ระบุก็ใช้ช่วงนั้น ไม่งั้นขยายด้วยจำนวนชั่วโมง OT).
 * "หน้าต่างไฟลท์" = ช่วง min–max ของเวลา STA/STD/OP/CL ของไฟลท์นั้น.
 * ไฟลท์ถือว่า "ครอบคลุม" เมื่ออยู่ในเวลางาน (มี tolerance ±COVER_TOL นาที).
 *
 * เกณฑ์ (ปรับได้):
 *   COVER_TOL = 45 นาที   — ผ่อนผันก่อน/หลังไฟลท์
 *   GAP_MIN   = 180 นาที  — ช่วงว่างระหว่างไฟลท์ (split-duty dead time) ที่จะแจ้ง
 *   EDGE_MIN  = 240 นาที  — ช่วงว่างก่อนไฟลท์แรก/หลังไฟลท์สุดท้าย (prep/standby) ที่จะแจ้ง
 *
 * Entry: acAnalyze_(res, ll) -> { rows:[...], summary:{...} }
 *        rbWriteAssignCheck_(ss, res, dateStr, ll, tabName) -> เขียนแท็บรายงาน
 */

var AC_COVER_TOL = 45;
var AC_GAP_MIN   = 180;
var AC_EDGE_MIN  = 240;

function acMin_(s) {
  var m = String(s == null ? '' : s).match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1] * 60 + +m[2]) : null;
}

/** ไฟลท์จริง (มีรหัสไฟลท์) ที่ต้องเช็คครอบคลุม — ไม่ใช่ pool/counter/common
 *  (CHECK-IN COMMON, LP MORNING/AFTERNOON, Counter G2/G11, Gate A1 ฯลฯ).
 *  รหัสไฟลท์จริงจะ "ขึ้นต้น" ด้วยโค้ดสายการบิน (EK378, 6E1077, G9687, QZ246) —
 *  งานเคาน์เตอร์/zone จะขึ้นต้นด้วยคำอังกฤษ (Counter/Gate/LP …) จึงตัดด้วย prefix. */
function acIsFlight_(name) {
  var s = String(name || '').trim().toUpperCase();
  if (!s) return false;
  if (/^(COUNTER|GATE|CHECK|ZONE|BELT|PIER|STBY|STAND|POOL|OFFICE|BRIEF|NIL|OFF\b|LP\s+(MORNING|AFTERNOON|NIGHT|DAY))/.test(s)) return false;
  return /[A-Z]{1,3}\s*\d{2,4}/.test(s);
}

/** [lo,hi] นาทีของช่วงที่พนักงาน "ต้องอยู่" ตามบทบาท (task) ของไฟลท์นั้น:
 *  · check-in (CT/CI/GK/COUNTER) → ช่วงเปิด-ปิดเคาน์เตอร์ OP-CL
 *  · arrival (ARR/MEET/AC/RF)    → รอบ STA
 *  · gate (GATE/GA/GM/BOARD)     → CL/STD จนเครื่องออก
 *  · อื่น ๆ → min-max ของเวลาที่มี (STA/OP/CL/STD)
 *  00:00 เป็น placeholder ตัดทิ้ง. คืน null ถ้าไม่มีเวลา. */
function acFlightWin_(a) {
  var task = String(a.task || '').toUpperCase();
  var sta = acMin_(a.STA), op = acMin_(a.OP), cl = acMin_(a.CL), std = acMin_(a.STD);
  var lo = null, hi = null;
  if (/CT|CI|GK|CHECK|COUNTER|CTR/.test(task) && op) { lo = op; hi = cl || std || op; }
  else if (/ARR|MEET|\bAC\b|\bRF\b|ESCORT/.test(task) && sta) { lo = sta; hi = sta; }
  else if (/GATE|\bGA\b|\bGM\b|BOARD|\bGC\b|BIR|MAAS|PFD/.test(task) && (cl || std)) { lo = cl || std; hi = std || cl; }
  if (lo == null) {
    var ts = [sta, op, cl, std].filter(function (x) { return x; });
    if (!ts.length) return null;
    lo = Math.min.apply(null, ts); hi = Math.max.apply(null, ts);
  }
  if (hi - lo > 14 * 60) hi -= 1440;                       // ป้องกัน min/max ข้ามเที่ยงคืนเพี้ยน
  if (hi < lo) { var t = lo; lo = hi; hi = t; }
  if (hi - lo < 30) {                                      // ไฟลท์ที่มีเวลาจุดเดียว (เช่น PG STA=00:00 เหลือ STD)
    var mid = (lo + hi) / 2; lo = mid - 30; hi = mid + 30; // → ให้เป็นบล็อกงาน ~60 นาที จะได้ตัด gap ถูก
  }
  return [lo, hi];
}

/** หน้าต่างเวลางาน (duty) ของหนึ่ง record. */
function acDuty_(r) {
  var sr = rrRangeStr_(r.shiftTime || '');
  var ss = sr[0], se = sr[1];
  if (ss != null && se != null && se <= ss) se += 1440;
  if (ss == null && r.shiftStart != null && r.shiftHrs) {
    ss = r.shiftStart; se = ss + Math.round(r.shiftHrs * 60);
  }
  var orr = rrRangeStr_(r.otTime || '');
  var oi = orr[0], oo = orr[1];
  if (oi != null && oo != null && oo <= oi) oo += 1440;

  var ds = ss, de = se;
  if (r.bucket === 'ot_off') {
    // OT OFF = วันหยุดมาทำ OT — เวลางานจริง = ช่วง OT เท่านั้น (ไม่ใช่กะปกติที่ค้างอยู่)
    ds = oi; de = oo;
  } else if (oi != null) {
    if (ss != null) { while (oi < ss - 720) { oi += 1440; oo += 1440; } }  // จัด OT ให้อยู่ใกล้กะ
    ds = (ds == null) ? oi : Math.min(ds, oi);
    de = (de == null) ? oo : Math.max(de, oo);
  } else if (r.ot > 0 && ss != null) {
    if (r.otType === 'PRE') ds = ss - Math.round(r.ot * 60);
    else de = se + Math.round(r.ot * 60);
  }
  return { ss: ss, se: se, ds: ds, de: de };
}

/** วิเคราะห์ความเหมาะสมของหนึ่ง record (ที่มาทำงาน). */
function acAnalyzeRecord_(r) {
  var d = acDuty_(r);
  // เชื่อถือได้เมื่อมีเวลากะจริง (ss) หรือเป็น OT OFF (ทำเฉพาะ OT วันหยุด).
  // ถ้าเป็นคนทำงานแต่กะเป็นรหัสไม่มีเวลา (เช่น NN0 กะดึก) → อย่าเอาช่วง OT มาตัดสิน coverage
  var reliable = (d.ss != null) || (r.bucket === 'ot_off' && d.ds != null);
  var out = {
    hasWindow: reliable && d.ds != null && d.de != null,
    shiftStr: r.bucket === 'ot_off' ? 'OFF' : ((d.ss != null && d.se != null) ? (rrFmtMin_(d.ss) + '–' + rrFmtMin_(d.se)) : (r.shift || '-')),
    dutyStr: '', dutyMins: 0, ss: d.ss, se: d.se, ds: d.ds, de: d.de,
    flightN: 0, coveredN: 0, uncovered: [], gaps: [], wins: [],
    otVerdict: '', issues: [], status: 'ok',
  };
  if (out.hasWindow) {
    out.dutyStr = rrFmtMin_(d.ds) + '–' + rrFmtMin_(d.de);
    out.dutyMins = d.de - d.ds;
  }

  // หน้าต่างไฟลท์ (เฉพาะที่มีเวลา)
  (r.assignments || []).forEach(function (a) {
    if (!a || !a.flight) return;
    var coverable = acIsFlight_(a.flight);
    var w = acFlightWin_(a);
    if (!w) return;                                         // ไฟลท์ไม่มีเวลา → ข้ามการเช็คครอบคลุม
    var lo = w[0], hi = w[1];
    if (d.ds != null && lo < d.ds - 720) { lo += 1440; hi += 1440; }
    out.wins.push({ flight: a.flight, lo: lo, hi: hi });    // ใช้ทุก task เพื่อหา gap (รวม pool)
    if (!coverable) return;
    out.flightN++;                                          // นับเฉพาะไฟลท์จริงในการครอบคลุม
    if (d.ds != null && d.de != null) {
      if (lo >= d.ds - AC_COVER_TOL && hi <= d.de + AC_COVER_TOL) out.coveredN++;
      else out.uncovered.push(a.flight + ' (' + rrFmtMin_(lo) + '–' + rrFmtMin_(hi) + ')');
    }
  });

  // ช่วงว่าง (gap) ภายในเวลางาน — union ของหน้าต่างไฟลท์ (แยก edge/internal)
  if (out.hasWindow && out.wins.length) {
    var iv = out.wins.map(function (w) { return [Math.max(w.lo, d.ds), Math.min(w.hi, d.de)]; })
      .filter(function (w) { return w[1] > w[0]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    iv.forEach(function (w) {
      var last = merged[merged.length - 1];
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
      else merged.push([w[0], w[1]]);
    });
    if (merged.length) {
      if (merged[0][0] - d.ds >= AC_EDGE_MIN) out.gaps.push({ a: d.ds, b: merged[0][0], kind: 'edge' });
      for (var gi = 0; gi < merged.length - 1; gi++) {
        if (merged[gi + 1][0] - merged[gi][1] >= AC_GAP_MIN) out.gaps.push({ a: merged[gi][1], b: merged[gi + 1][0], kind: 'mid' });
      }
      if (d.de - merged[merged.length - 1][1] >= AC_EDGE_MIN) out.gaps.push({ a: merged[merged.length - 1][1], b: d.de, kind: 'edge' });
    }
  }

  // สรุปคำตัดสิน OT + ปัญหา
  if (out.uncovered.length) {
    out.status = 'bad';
    out.issues.push('ไฟลท์นอกเวลางาน: ' + out.uncovered.join(', '));
    out.otVerdict = r.ot > 0 ? '🔴 OT ไม่พอครอบคลุมไฟลท์' : '🔴 ควรให้ OT/Re-Sked';
  } else if (r.ot > 0 && r.bucket !== 'ot_off') {
    // OT เกินจำเป็นไหม — ตรวจว่ามีไฟลท์เลยขอบกะจริงหรือไม่
    var justified = out.flightN === 0;                      // ไม่มีไฟลท์ → ตัดสินไม่ได้ ถือว่าผ่าน (อาจเป็นงาน support)
    out.wins.forEach(function (w) {
      if (r.otType === 'PRE'  && d.ss != null && w.lo <  d.ss - AC_COVER_TOL) justified = true;
      if (r.otType !== 'PRE'  && d.se != null && w.hi >  d.se + AC_COVER_TOL) justified = true;
    });
    if (!justified && out.flightN > 0) {
      out.status = 'warn';
      out.otVerdict = '🟡 OT อาจเกินจำเป็น (ไฟลท์อยู่ในเวลากะ)';
      out.issues.push(out.otVerdict);
    } else {
      out.otVerdict = '🟢 OT เหมาะสม';
    }
  } else if (r.bucket === 'ot_off') {
    out.otVerdict = '🟢 OT OFF (เข้าช่วยวันหยุด)';
  }

  // ช่วงว่างยาว
  if (out.gaps.length) {
    if (out.status === 'ok') out.status = 'warn';
    out.issues.push('ช่วงว่าง ' + out.gaps.map(function (g) {
      return rrFmtMin_(g.a) + '–' + rrFmtMin_(g.b) + ' (' + Math.round((g.b - g.a) / 6) / 10 + 'h' +
             (g.kind === 'mid' ? ' ระหว่างไฟลท์' : '') + ')';
    }).join(', '));
  }

  // ไม่มีไฟลท์เลย = นับเป็นข้อมูล (bench/standby/support) ไม่ flag เป็นปัญหา เพื่อไม่ให้ตารางรก
  out.noFlight = (out.flightN === 0 && r.bucket === 'working');
  return out;
}

/** ทีม "เจ้าของ" ของแต่ละสายการบิน = ทีมที่มีพนักงานทำไฟลท์สายการบินนั้นมากสุด
 *  (ใช้บอกว่าไฟลท์ไหนเป็นการ "ซัพพอร์ตข้ามทีม") */
function acOwnerTeams_(res, ll) {
  var cnt = {};
  function tally(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    if (slaSkipTeam_(team)) return;          // Porter/Crewsign/Admin Doc ไม่นับเป็นเจ้าของสายการบิน
    (r.assignments || []).forEach(function (a) {
      if (!acIsFlight_(a.flight)) return;
      var al = slaAirlineOf_(a.flight);
      (cnt[al] = cnt[al] || {})[team] = (cnt[al][team] || 0) + 1;
    });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { tally(t, r); }); });
  if (ll && ll.totals && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { tally('LL·' + s, r); }); });
  var owner = {};
  Object.keys(cnt).forEach(function (al) {
    var best = '', bn = -1;
    Object.keys(cnt[al]).forEach(function (t) { if (cnt[al][t] > bn) { bn = cnt[al][t]; best = t; } });
    owner[al] = best;
  });
  return owner;
}

/** วิเคราะห์ทั้งไฟล์ (PSA teams + LL sections). คืน rows ที่ต้องตรวจ + summary. */
function acAnalyze_(res, ll) {
  var rows = [];
  var owner = acOwnerTeams_(res, ll);
  var sum = { working: 0, checked: 0, bad: 0, warn: 0, otMuch: 0, gap: 0, noFlt: 0, noWin: 0, support: 0 };

  function consider(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    sum.working++;
    var a = acAnalyzeRecord_(r);
    if (!a.hasWindow) { sum.noWin++; return; }              // ไม่มีเวลากะระบุ → ตรวจครอบคลุมไม่ได้
    sum.checked++;
    // ไฟลท์ที่ทำ + ตั้ง flag ไฟลท์ "ซัพพอร์ตข้ามทีม" (สายการบินที่ทีมอื่นเป็นเจ้าของ)
    var nSupport = 0, skipT = slaSkipTeam_(team);
    var jobList = (r.assignments || []).filter(function (x) { return acIsFlight_(x.flight); })
      .map(function (x) {
        var ow = owner[slaAirlineOf_(x.flight)];
        if (!skipT && ow && ow !== team) { nSupport++; return x.flight + ' (ซัพพอร์ต)'; }
        return x.flight;
      });
    if (nSupport) sum.support++;
    if (a.status === 'bad') sum.bad++;
    if (a.status === 'warn') sum.warn++;
    if (a.otVerdict.indexOf('เกินจำเป็น') >= 0) sum.otMuch++;
    if (a.gaps.length) sum.gap++;
    if (a.noFlight) sum.noFlt++;
    if (a.status === 'bad' || a.status === 'warn') {
      rows.push({
        team: team, id: r.id || '', pos: r.pos || r.posGroup || '', name: r.name || '',
        job: jobList.join(', '),
        support: nSupport,
        shift: a.shiftStr, duty: a.dutyStr,
        ot: r.ot > 0 ? (r.ot + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) +
                        (r.otTime ? ' ' + r.otTime : '')) : '-',
        flights: a.flightN ? (a.coveredN + '/' + a.flightN + ' ครอบคลุม') : 'ไม่มี',
        uncovered: a.uncovered.join('; '),
        gaps: a.gaps.map(function (g) { return rrFmtMin_(g.a) + '–' + rrFmtMin_(g.b); }).join(', '),
        otVerdict: a.otVerdict,
        issue: a.issues.join(' · '),
        status: a.status,
      });
    }
  }

  Object.keys(res.teams).forEach(function (t) {
    res.teams[t].records.forEach(function (r) { consider(t, r); });
  });
  if (ll && ll.totals && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) { consider('LL·' + s, r); });
    });
  }

  var order = { bad: 0, warn: 1 };
  rows.sort(function (x, y) {
    if (order[x.status] !== order[y.status]) return order[x.status] - order[y.status];
    return String(x.team).localeCompare(String(y.team));
  });
  return { rows: rows, summary: sum };
}

// ─── รายงานแท็บ "🧭 ตรวจ Assign" ────────────────────────────────────────────
function rbWriteAssignCheck_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🧭 ตรวจ Assign';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var an = acAnalyze_(res, ll);
  var W = 13;

  sh.getRange(1, 1, 1, W).merge()
    .setValue('🧭 ตรวจความเหมาะสมการ Assign — ' + dateStr)
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);

  var s = an.summary;
  sh.getRange(2, 1, 1, W).merge()
    .setValue('ตรวจ ' + s.checked + '/' + s.working + ' คนที่มาทำงาน  ·  🔴 ไฟลท์นอกเวลา/ขาด OT ' + s.bad +
              '  ·  🟡 ควรตรวจ ' + s.warn + '  ·  OT อาจเกิน ' + s.otMuch + '  ·  มีช่วงว่าง ' + s.gap +
              '  ·  ไม่มีไฟลท์ ' + s.noFlt + ' (bench/standby)' +
              (s.noWin ? '  ·  (ไม่มีเวลากะระบุ ' + s.noWin + ' — ข้าม)' : ''))
    .setBackground('#241c33').setFontColor('#f5c542').setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center');
  sh.setRowHeight(2, 22);

  var head = ['สถานะ', 'ทีม/ส่วน', 'รหัส', 'ตำแหน่ง', 'ชื่อ', 'กะ (เข้า-ออก)', 'OT', 'ไฟลท์', 'ไฟลท์ที่ทำ',
              'ไฟลท์นอกเวลา', 'ช่วงว่าง', 'OT เหมาะสม?', 'ปัญหา/คำแนะนำ'];
  sh.getRange(3, 1, 1, W).setValues([head]).setBackground('#1f4e79').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  var emo = { bad: '🔴', warn: '🟡', ok: '🟢' };
  var body = an.rows.map(function (r) {
    return [emo[r.status] || '', r.team, r.id, r.pos, r.name, r.shift, r.ot, r.flights, r.job || '',
            r.uncovered, r.gaps, r.otVerdict, r.issue];
  });
  if (body.length) {
    sh.getRange(4, 1, body.length, W).setValues(body).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (var i = 0; i < an.rows.length; i++) {
      if (an.rows[i].status === 'bad') sh.getRange(4 + i, 1, 1, W).setBackground('#fdecec');
      else if (i % 2) sh.getRange(4 + i, 1, 1, W).setBackground('#fff8e1');
    }
    sh.getRange(4, 5, body.length, 1).setFontWeight('bold');
  } else {
    sh.getRange(4, 1, 1, W).merge().setValue('✅ ไม่พบการ Assign ที่ผิดปกติ — ทุกคนเวลากะครอบคลุมไฟลท์และ OT เหมาะสม')
      .setHorizontalAlignment('center').setBackground('#e6f4ea').setFontColor('#1b5e20').setFontWeight('bold');
  }

  [44, 90, 80, 90, 140, 110, 110, 90, 180, 180, 120, 160, 230].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  return an.summary;
}
