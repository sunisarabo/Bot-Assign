/**
 * Productivity.gs — คำนวณ + แสดง "ประสิทธิภาพการใช้กำลังพล" ในหน้า Timetable
 * =============================================================================
 * Utilization = เวลาที่ติดงานไฟลท์ (รวมงานซัพ) ÷ เวลาพร้อมทำงาน (กะ+OT)
 * ใช้ตัวเดิมของ PAS: acDuty_ (ช่วงกะ/OT) · acFlightWin_ (ช่วงงานไฟลท์) · acIsFlight_ · rrAlignTo_
 * แสดง: แถบ KPI บนหัว Timetable · Util%/ชม.ว่าง ต่อคนในแถว Gantt · ตารางรายทีม · flags ควรทบทวน
 */

/** ประสิทธิภาพรายคน — คืน {dutyMin, busyMin, idleMin, util, maxGap, nFlt, outMin, overlaps[]} หรือ null */
function rbPUCalc_(r) {
  var d = acDuty_(r);
  if (d.ds == null || d.de == null || d.de <= d.ds) return null;
  var dutyMin = d.de - d.ds, capMax = (typeof AC_WIN_MAX !== 'undefined') ? AC_WIN_MAX : 840;
  var iv = [], flts = [];
  (r.assignments || []).forEach(function (a) {
    if (!a.flight) return;
    if (typeof acIsActivity_ === 'function' && (a.activity || acIsActivity_(a.flight))) return;   // อบรม/ประชุม ไม่นับเป็นงานไฟลท์
    var w = null; try { w = acFlightWin_(a); } catch (e) {}
    if (!w || (w[1] - w[0]) > capMax) return;
    var lo = w[0], hi = w[1];
    if (typeof rrAlignTo_ === 'function') { var fa = rrAlignTo_(lo, hi, d.ds, d.de); lo = fa[0]; hi = fa[1]; }
    else if (lo < d.ds - 720) { lo += 1440; hi += 1440; }
    var clo = Math.max(lo, d.ds), chi = Math.min(hi, d.de);
    if (chi > clo) iv.push([clo, chi]);
    flts.push({ f: a.flight, lo: lo, hi: hi, real: acIsFlight_(a.flight) });
  });
  iv.sort(function (a, b) { return a[0] - b[0]; });
  var merged = [];
  iv.forEach(function (w) { var last = merged[merged.length - 1]; if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]); else merged.push([w[0], w[1]]); });
  var busy = 0, maxGap = 0, cur = d.ds;
  merged.forEach(function (w) { if (w[0] - cur > maxGap) maxGap = w[0] - cur; busy += w[1] - w[0]; cur = Math.max(cur, w[1]); });
  if (d.de - cur > maxGap) maxGap = d.de - cur;
  // งานนอกกะ (busy เกินขอบกะจริง ss/se) — นาทีที่ทำงานนอก [ss,se]
  var outMin = 0;
  if (d.ss != null && d.se != null) merged.forEach(function (w) { outMin += Math.max(0, d.ss - w[0]) + Math.max(0, w[1] - d.se); });
  // งานซ้อนเวลา ≥30 นาที (คนเดียว 2 ไฟลท์คนละลำ)
  var overlaps = [];
  for (var i = 0; i < flts.length; i++) for (var j = i + 1; j < flts.length; j++) {
    var A = flts[i], B = flts[j];
    if (!A.real || !B.real) continue;
    if (A.f.split('/')[0] === B.f.split('/')[0]) continue;   // ไฟลท์เดียวกัน (ขา) ข้าม
    var ov = Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo);
    if (ov >= 30) overlaps.push(A.f + ' × ' + B.f);
  }
  var nFlt = 0, seen = {};
  flts.forEach(function (x) { if (x.real) { var k = x.f.split('/')[0]; if (!seen[k]) { seen[k] = 1; nFlt++; } } });
  return { dutyMin: dutyMin, busyMin: busy, idleMin: dutyMin - busy, util: dutyMin > 0 ? busy / dutyMin : 0,
           maxGap: maxGap, nFlt: nFlt, outMin: outMin, overlaps: overlaps };
}

/** รวมประสิทธิภาพทั้งวัน → { kpi, teams[], byKey{}, flags{} } */
function rbProductivity_(res, ll) {
  var teams = {}, byKey = {}, persons = [];
  var flagOverlap = [], flagOut = [], flagIdle = [];
  var flightSet = {}, supOutTot = 0;
  function key(team, name) { return String(team) + '|' + String(name); }
  function walk(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    if (r.training) return;
    var t = teams[team] || (teams[team] = { team: team, n: 0, nFlt: 0, dutyMin: 0, busyMin: 0, idleMin: 0, otMin: 0, supOut: 0, supIn: 0, fset: {} });
    t.n++;
    if (r.ot > 0) t.otMin += Math.round(r.ot * 60);
    var pu = rbPUCalc_(r);
    (r.assignments || []).forEach(function (a) {
      if (a.supportOut) { t.supOut++; supOutTot++; }
      else if (a.flight && acIsFlight_(a.flight) && !slaSkipTeam_(team)) { var k = a.flight.split('/')[0]; t.fset[k] = 1; flightSet[k] = 1; }
      if (r.support && a.flight) t.supIn = (t.supIn || 0);   // supIn นับจาก r.support ด้านล่าง
    });
    if (r.support) t.supIn++;
    if (pu) {
      t.dutyMin += pu.dutyMin; t.busyMin += pu.busyMin; t.idleMin += pu.idleMin;
      byKey[key(team, r.name)] = { util: pu.util, idleMin: pu.idleMin, dutyMin: pu.dutyMin };
      if (pu.overlaps.length) pu.overlaps.forEach(function (o) { flagOverlap.push({ team: team, name: r.name, pair: o }); });
      if (pu.outMin >= 60) flagOut.push({ team: team, name: r.name, shift: r.shiftTime || r.shift || '', min: pu.outMin });
      if (pu.maxGap >= 240) flagIdle.push({ team: team, name: r.name, shift: r.shiftTime || r.shift || '', gap: pu.maxGap });
    }
  }
  Object.keys(res.teams || {}).forEach(function (t) { (res.teams[t].records || []).forEach(function (r) { walk(t, r); }); });
  if (ll && ll.sections) Object.keys(ll.sections).forEach(function (s) { (ll.sections[s].records || []).forEach(function (r) { walk('LL·' + s, r); }); });

  var teamArr = Object.keys(teams).map(function (t) {
    var x = teams[t]; x.nFlt = Object.keys(x.fset).length; x.util = x.dutyMin > 0 ? x.busyMin / x.dutyMin : 0;
    return x;
  }).sort(function (a, b) { return b.util - a.util; });
  var TD = teamArr.reduce(function (s, x) { return s + x.dutyMin; }, 0);
  var TB = teamArr.reduce(function (s, x) { return s + x.busyMin; }, 0);
  var TN = teamArr.reduce(function (s, x) { return s + x.n; }, 0);
  var TOT = teamArr.reduce(function (s, x) { return s + x.otMin; }, 0);
  var kpi = {
    staff: TN, util: TD > 0 ? TB / TD : 0, flights: Object.keys(flightSet).length, support: supOutTot,
    otHrs: Math.round(TOT / 60 * 10) / 10, idleHrs: Math.round((TD - TB) / 60),
    nOverlap: flagOverlap.length, nOut: flagOut.length, nIdle: flagIdle.length
  };
  return { kpi: kpi, teams: teamArr, byKey: byKey, flags: { overlap: flagOverlap, out: flagOut, idle: flagIdle } };
}

/** แถบ KPI (บนหัว Timetable) */
function rbProductivityBar_(p) {
  var k = p.kpi;
  function u(v) { return Math.round(v * 1000) / 10; }
  function card(big, lbl, tone) {
    return '<div class="pu-kpi ' + (tone || '') + '"><div class="pu-big">' + big + '</div><div class="pu-lbl">' + lbl + '</div></div>';
  }
  var utCls = k.util >= 0.75 ? 'hi' : (k.util >= 0.5 ? 'ok' : (k.util >= 0.3 ? 'lo' : 'vlo'));
  return '<div class="pu-bar">' +
    card(k.staff, 'คนทำงาน') +
    card('<span class="pu-' + utCls + '">' + u(k.util) + '%</span>', 'Utilization รวม') +
    card(k.flights, 'คู่ไฟลท์') +
    card(k.support, 'ซัพข้ามทีม') +
    card(k.otHrs, 'OT ชม.') +
    '</div>';
}

/** ตารางรายทีม + flags (ใต้ Gantt) */
function rbProductivityPanel_(p) {
  function u(v) { return Math.round(v * 1000) / 10; }
  function h(m) { return Math.round(m / 60 * 10) / 10; }
  function bar(v) {
    var cls = v >= 0.75 ? 'hi' : (v >= 0.5 ? 'ok' : (v >= 0.3 ? 'lo' : 'vlo'));
    return '<div class="pu-track"><div class="pu-fill ' + cls + '" style="width:' + Math.min(100, u(v)) + '%"></div><span>' + u(v) + '%</span></div>';
  }
  var rows = p.teams.map(function (t) {
    return '<tr><td class="b">' + rbEsc_(t.team) + '</td><td class="tnum">' + t.n + '</td><td class="tnum">' + t.nFlt + '</td>' +
      '<td style="min-width:120px">' + bar(t.util) + '</td><td class="tnum">' + h(t.idleMin) + '</td><td class="tnum">' + h(t.otMin) + '</td>' +
      '<td class="tnum">' + (t.supOut || 0) + ' / ' + (t.supIn || 0) + '</td></tr>';
  }).join('');
  var teamTbl = rbTblCard_('📊 สรุป Utilization รายทีม',
    '<tr><th>ทีม</th><th>คน</th><th>ไฟลท์</th><th>Utilization</th><th>ว่าง(ชม.)</th><th>OT(ชม.)</th><th>ซัพ ออก/เข้า</th></tr>', rows);

  function flagCard(title, items, render) {
    var body = items.length ? items.slice(0, 40).map(render).join('') + (items.length > 40 ? '<tr><td colspan="3" class="muted">…อีก ' + (items.length - 40) + '</td></tr>' : '')
      : '<tr><td colspan="3" class="okk" style="text-align:center;padding:10px">✅ ไม่มี</td></tr>';
    return rbTblCard_(title, '<tr><th>ทีม</th><th>ชื่อ</th><th>รายละเอียด</th></tr>', body);
  }
  var f = p.flags;
  var fOverlap = flagCard('🔴 งานซ้อนเวลา ≥30 นาที (คนเดียว 2 ไฟลท์คนละลำ)', f.overlap, function (x) { return '<tr><td>' + rbEsc_(x.team) + '</td><td class="b">' + rbEsc_(x.name) + '</td><td>' + rbEsc_(x.pair) + '</td></tr>'; });
  var fOut = flagCard('🟠 งานอยู่นอกเวลากะ ≥60 นาที', f.out, function (x) { return '<tr><td>' + rbEsc_(x.team) + '</td><td class="b">' + rbEsc_(x.name) + '</td><td>กะ ' + rbEsc_(x.shift) + ' · เกิน ' + Math.round(x.min) + ' นาที</td></tr>'; });
  var fIdle = flagCard('🟡 ว่างต่อเนื่อง ≥4 ชม. ในกะ', f.idle, function (x) { return '<tr><td>' + rbEsc_(x.team) + '</td><td class="b">' + rbEsc_(x.name) + '</td><td>กะ ' + rbEsc_(x.shift) + ' · ว่าง ' + (Math.round(x.gap / 6) / 10) + ' ชม.</td></tr>'; });

  return '<details class="pu-det"><summary>📈 ประสิทธิภาพการใช้กำลังพล (Productivity) — Utilization รายทีม + รายการควรทบทวน</summary>' +
    '<div class="pu-panel">' + teamTbl + fOverlap + fOut + fIdle + '</div></details>';
}

/** CSS ของ productivity */
function rbProductivityCss_() {
  return '<style>' +
    '.pu-bar{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}' +
    '.pu-kpi{flex:1;min-width:110px;background:#f6f8fb;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;text-align:center}' +
    '.pu-kpi.warn{background:#fff4e6;border-color:#f0c479}' +
    '.pu-big{font-size:22px;font-weight:800;color:#1f4e79;line-height:1.1}' +
    '.pu-lbl{font-size:11px;color:#64748b;margin-top:3px;font-weight:600}' +
    '.pu-hi{color:#c0392b}.pu-ok{color:#1c7a4f}.pu-lo{color:#b26a10}.pu-vlo{color:#8a4f06}' +
    '.pu-track{position:relative;height:18px;background:#eef2f7;border-radius:6px;overflow:hidden}' +
    '.pu-fill{position:absolute;left:0;top:0;bottom:0;border-radius:6px}' +
    '.pu-fill.hi{background:#e88a8a}.pu-fill.ok{background:#7ecfa0}.pu-fill.lo{background:#f0c479}.pu-fill.vlo{background:#e0a3a3}' +
    '.pu-track span{position:absolute;right:6px;top:0;line-height:18px;font-size:11px;font-weight:700;color:#243244}' +
    '.pu-det{margin-top:14px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}' +
    '.pu-det>summary{cursor:pointer;padding:11px 15px;font-weight:700;color:#1f4e79}' +
    '.pu-panel{padding:0 12px 12px;display:grid;gap:12px}' +
    '.gt-lbl .pu-u{display:block;font-size:10px;font-weight:600;margin-top:2px}' +
    '.gt-lbl .pu-u b{font-weight:800}' +
    '</style>';
}
