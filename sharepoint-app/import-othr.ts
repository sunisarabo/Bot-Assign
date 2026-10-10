/*
 * import-othr.ts — Office Script: ไฟล์ "OT OCT25 - JUL 26.xlsx" (OT จ่ายจริงจาก HR ทั้งปีงบ) → OT Dashboard
 *   อ่านชีตที่ไฟล์คำนวณไว้แล้ว (ตัดรายการซ้ำแล้ว — ตรงกับชีต แดชบอร์ด ของไฟล์):
 *   · "ข้อมูลคำนวณ"  : วันที่ · รหัสพนักงาน · ชื่อ-สกุล · แผนก (KP/LP/LL) · ทีม/ตำแหน่ง · ประเภท OT · อัตรา · Code · ชั่วโมง
 *   · "พนักงานคำนวณ" : รหัส · แผนก · วันเริ่มงาน · วันพ้นสภาพ → กำลังพล ณ สิ้นเดือน / เข้าใหม่ / ลาออก
 *   · "ไฟลท์"        : วันที่ · จำนวนไฟลท์ (ไม่บังคับ)
 *   · "ตรวจข้อมูล"   : "อัปเดตข้อมูลเมื่อ" (ไม่บังคับ — แสดงบนหน้าแอป)
 *
 * เขียน 4 List (ทุกแถวมี month_key → flow ลบของเดือนนั้นแล้วเขียนใหม่):
 *   PAS_OTHR_Day    วัน × แผนก × ทีม   (ชั่วโมง · ครั้ง · คน · แยกประเภท OT)
 *   PAS_OTHR_Person เดือน × คน         (ชั่วโมง · ครั้ง · วัน · สัปดาห์สูงสุด)
 *   PAS_OTHR_Over   เกินเพดาน          (> 36 ชม./สัปดาห์ จ.–อา. · > 144 ชม./เดือน)
 *   PAS_OTHR_Month  เดือน × แผนก (ALL/KP/LP/LL) · ประเภท/Code OT เป็น JSON · กำลังพล · ไฟลท์ · sig (เขียนท้ายสุด)
 *
 * นำเข้าเฉพาะเดือนที่ข้อมูลเปลี่ยน: flow ส่ง sigs = JSON [{Title, sig}] ของ PAS_OTHR_Month (dept ALL)
 * → เดือนที่ sig ตรงกันจะข้าม · ส่งทีละไม่เกิน maxRows แถว แล้วคืน more = true ให้ flow เรียกซ้ำ
 * คืน { status, months[], more, pending, counts, batches[], updated }
 */
const SITE_O = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const BATCH_O = 100;
const OT_VER = "1";
const WEEK_LIMIT = 36, MONTH_LIMIT = 144;
const DEPT_LBL: { [d: string]: string } = { ALL: "ฝ่ายการโดยสาร", KP: "แผนกการโดยสาร (KP)", LP: "แผนกบริการผู้โดยสารพิเศษ (LP)", LL: "แผนกติดตามสัมภาระ (LL)" };
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
type Cell = string | number | boolean;
interface OBatch { list: string; boundary: string; body: string; n: number }
interface ORec { day: string; month: string; week: string; emp: string; name: string; dept: string; team: string; kind: string; code: string; hrs: number; h: number }
interface Agg { hours: number; cnt: number; t15: number; off: number; hol: number; t30: number; who: { [e: string]: boolean } }

function main(workbook: ExcelScript.Workbook, sigs?: string, siteUrl?: string, filePath?: string, maxRows?: number) {
  const site = (siteUrl || SITE_O).replace(/\/$/, "");
  const ws = workbook.getWorksheet("ข้อมูลคำนวณ");
  if (!ws) return { status: "skipped", reason: "ไม่พบชีต \"ข้อมูลคำนวณ\" (กดปุ่มอัปเดตในไฟล์ OT ก่อน)", months: [] as string[], more: false, pending: 0, counts: {}, batches: [] as OBatch[], updated: "" };
  const recs = readOt(ws);
  if (!recs.length) return { status: "skipped", reason: "ชีต \"ข้อมูลคำนวณ\" ไม่มีรายการ (หัวคอลัมน์ไม่ตรง?)", months: [] as string[], more: false, pending: 0, counts: {}, batches: [] as OBatch[], updated: "" };
  const emps = readEmps(workbook.getWorksheet("พนักงานคำนวณ"));
  const flights = readFlights(workbook.getWorksheet("ไฟลท์"));
  const updated = readUpdated(workbook.getWorksheet("ตรวจข้อมูล"));

  // เดือนที่มีข้อมูล · สัปดาห์ (จ.) ที่เริ่มก่อนเดือนแรก นับเป็นเดือนแรก
  const monthSet: { [m: string]: boolean } = {};
  for (const r of recs) monthSet[r.month] = true;
  const months = Object.keys(monthSet).sort();
  const first = months[0];
  const weekMonth = (wk: string) => wk.slice(0, 7) < first ? first : wk.slice(0, 7);

  // sig ต่อเดือน (ไม่ขึ้นกับลำดับแถว) = รายการของเดือน + รายการในสัปดาห์ที่นับเป็นของเดือน + กำลังพล + ไฟลท์
  const sigA: { [m: string]: number } = {}, sigB: { [m: string]: number } = {}, sigN: { [m: string]: number } = {};
  const addSig = (m: string, s: string) => { const h = fnv(s); sigA[m] = ((sigA[m] || 0) + h) % 4294967296; sigB[m] = ((sigB[m] || 0) ^ h) >>> 0; sigN[m] = (sigN[m] || 0) + 1; };
  for (const r of recs) {
    const s = r.day + "|" + r.emp + "|" + r.name + "|" + r.dept + "|" + r.team + "|" + r.kind + "|" + r.code + "|" + r.hrs;
    addSig(r.month, s);
    const wm = weekMonth(r.week); if (wm !== r.month) addSig(wm, s);
  }
  const hc: { [m: string]: { [d: string]: number[] } } = {};
  for (const m of months) {
    hc[m] = headcount(emps, m);
    addSig(m, "HC" + JSON.stringify(hc[m]) + "|F" + JSON.stringify(flightsOf(flights, m)) + "|U" + updated + "|V" + OT_VER);
  }
  const sig: { [m: string]: string } = {};
  for (const m of months) sig[m] = sigN[m] + "-" + sigA[m].toString(36) + "-" + sigB[m].toString(36);

  const old: { [m: string]: string } = {};
  if (sigs) for (const s of JSON.parse(sigs) as { Title?: string; sig?: string }[]) if (s.Title) old[String(s.Title).split("|")[0]] = String(s.sig || "");
  const last = months[months.length - 1];                                  // เดือนในช่วงของไฟล์ที่ไม่มีรายการแล้ว → ลบอย่างเดียว
  const gone = Object.keys(old).filter(m => !monthSet[m] && m >= first && m <= last).sort();   // (นอกช่วง = ปีงบอื่น → ไม่แตะ)
  const changed = months.filter(m => old[m] !== sig[m]);

  // แบ่งรอบตามจำนวนแถว (ประมาณจาก วัน×ทีม + คน)
  const est: { [m: string]: number } = {};
  { const dk: { [k: string]: boolean } = {}, pk: { [k: string]: boolean } = {};
    for (const r of recs) { dk[r.day + "|" + r.dept + "|" + r.team] = true; pk[r.month + "|" + r.emp] = true; }
    for (const k of Object.keys(dk)) est[k.slice(0, 7)] = (est[k.slice(0, 7)] || 0) + 1;
    for (const k of Object.keys(pk)) est[k.slice(0, 7)] = (est[k.slice(0, 7)] || 0) + 1; }
  const limit = maxRows && maxRows > 0 ? maxRows : 3000;
  const pick: string[] = []; let tot = 0;
  for (const m of changed) { if (pick.length && tot + (est[m] || 0) > limit) break; pick.push(m); tot += est[m] || 0; }

  const byMonth: { [m: string]: ORec[] } = {};
  for (const r of recs) (byMonth[r.month] = byMonth[r.month] || []).push(r);
  const dayRows: object[] = [], perRows: object[] = [], overRows: object[] = [], monRows: object[] = [];
  const src = (filePath || "").slice(0, 255);
  for (const m of pick) buildMonth(m, byMonth[m] || [], recs, weekMonth, hc[m], flightsOf(flights, m), sig[m], updated, src, dayRows, perRows, overRows, monRows);

  const batches: OBatch[] = [];
  toBatchesO(batches, site, "PAS_OTHR_Day", dayRows);
  toBatchesO(batches, site, "PAS_OTHR_Person", perRows);
  toBatchesO(batches, site, "PAS_OTHR_Over", overRows);
  toBatchesO(batches, site, "PAS_OTHR_Month", monRows);                  // ท้ายสุด: ถ้า flow ล้มกลางทาง sig ยังไม่ถูกบันทึก → รอบหน้าทำเดือนนั้นใหม่
  const H = recs.reduce((s, r) => s + r.h, 0);
  return { status: "ok", reason: "", months: gone.concat(pick), more: changed.length > pick.length, pending: changed.length - pick.length,
    counts: { records: recs.length, hours: r2(H), people: Object.keys(recs.reduce((o: { [e: string]: boolean }, r) => { o[r.emp] = true; return o; }, {})).length,
      months: months.length, changed: changed.length, written: pick.length, removed: gone.length,
      day: dayRows.length, person: perRows.length, over: overRows.length, month: monRows.length },
    batches, updated };
}

// ---------- อ่านชีต ----------
function readOt(ws: ExcelScript.Worksheet): ORec[] {
  const used = ws.getUsedRange(true); if (!used) return [];
  const nr = used.getRowIndex() + used.getRowCount(), nc = Math.min(40, used.getColumnIndex() + used.getColumnCount());
  const hd = ws.getRangeByIndexes(0, 0, Math.min(5, nr), nc).getValues();
  let hr = -1, c: { [k: string]: number } = {};
  for (let i = 0; i < hd.length && hr < 0; i++) {
    const row = hd[i].map(x => String(x).trim());
    const f = (re: RegExp) => row.findIndex(x => re.test(x));
    const m = { date: f(/^วันที่$/), emp: f(/^รหัส/), name: f(/^ชื่อ/), dept: f(/^แผนก$/), team: f(/^ทีม/), kind: f(/^ประเภท/), code: f(/^code/i), hrs: f(/^ชั่วโมง$/) };
    if (m.date >= 0 && m.emp >= 0 && m.hrs >= 0) { hr = i; c = m; }
  }
  if (hr < 0) return [];
  const out: ORec[] = [], CH = 10000;
  for (let r0 = hr + 1; r0 < nr; r0 += CH) {
    const v = ws.getRangeByIndexes(r0, 0, Math.min(CH, nr - r0), nc).getValues();
    for (const row of v) {
      const day = isoOf(row[c.date]); const emp = String(row[c.emp]).trim();
      if (!day || !emp) continue;
      const h = num(row[c.hrs]); if (!(h > 0)) continue;
      const dept = c.dept >= 0 ? String(row[c.dept]).trim().toUpperCase() || "KP" : "KP";
      out.push({ day, month: day.slice(0, 7), week: mondayOf(day), emp, name: c.name >= 0 ? String(row[c.name]).trim() : "",
        dept, team: teamOf(dept, c.team >= 0 ? String(row[c.team]) : ""), kind: kindOf(c.kind >= 0 ? String(row[c.kind]) : ""),
        code: c.code >= 0 ? String(row[c.code]).trim().toUpperCase() : "", hrs: h, h });
    }
  }
  return out;
}
interface OEmp { dept: string; start: string; end: string }
function readEmps(ws: ExcelScript.Worksheet | undefined): OEmp[] {
  if (!ws) return [];
  const used = ws.getUsedRange(true); if (!used) return [];
  const v = ws.getRangeByIndexes(0, 0, used.getRowIndex() + used.getRowCount(), Math.min(20, used.getColumnIndex() + used.getColumnCount())).getValues();
  const h = v[0].map(x => String(x).trim());
  const ci = h.findIndex(x => /^รหัส/.test(x)), cd = h.indexOf("แผนก"), cs = h.findIndex(x => /^วันเริ่ม/.test(x)), ce = h.findIndex(x => /^วันพ้น/.test(x));
  if (ci < 0 || cs < 0) return [];
  const out: OEmp[] = [];
  for (let i = 1; i < v.length; i++) {
    if (!String(v[i][ci]).trim()) continue;
    const start = isoOf(v[i][cs]); if (!start) continue;
    out.push({ dept: cd >= 0 ? String(v[i][cd]).trim().toUpperCase() : "KP", start, end: ce >= 0 ? isoOf(v[i][ce]) : "" });
  }
  return out;
}
function readFlights(ws: ExcelScript.Worksheet | undefined): { [d: string]: number } {
  const out: { [d: string]: number } = {};
  if (!ws) return out;
  const used = ws.getUsedRange(true); if (!used) return out;
  const v = ws.getRangeByIndexes(0, 0, used.getRowIndex() + used.getRowCount(), 2).getValues();
  for (const row of v) { const d = isoOf(row[0]); const n = num(row[1]); if (d && n > 0) out[d] = n; }
  return out;
}
function readUpdated(ws: ExcelScript.Worksheet | undefined): string {
  if (!ws) return "";
  const used = ws.getUsedRange(true); if (!used) return "";
  const t = ws.getRangeByIndexes(0, 0, Math.min(30, used.getRowIndex() + used.getRowCount()), 2).getTexts();
  for (const row of t) if (/อัปเดต/.test(String(row[0]))) return String(row[1]).trim();
  return "";
}

// ---------- สร้างแถวของเดือน ----------
function buildMonth(m: string, rs: ORec[], all: ORec[], weekMonth: (wk: string) => string, hcm: { [d: string]: number[] }, fl: number[], sig: string,
  updated: string, src: string, dayRows: object[], perRows: object[], overRows: object[], monRows: object[]) {
  // วัน × แผนก × ทีม
  const dmap: { [k: string]: Agg } = {};
  for (const r of rs) addAgg(dmap[r.day + "|" + r.dept + "|" + r.team] = dmap[r.day + "|" + r.dept + "|" + r.team] || newAgg(), r);
  for (const k of Object.keys(dmap).sort()) {
    const [day, dept, team] = k.split("|"), a = dmap[k];
    dayRows.push({ Title: k.slice(0, 255), day_key: day, month_key: m, week_key: mondayOf(day), dept, team: team.slice(0, 255),
      hours: r2(a.hours), cnt: a.cnt, people: Object.keys(a.who).length, h_t15: r2(a.t15), h_off: r2(a.off), h_hol: r2(a.hol), h_t30: r2(a.t30) });
  }
  // สัปดาห์ (จ.–อา.) ที่นับเป็นของเดือนนี้ — รวมวันที่ข้ามไปเดือนถัดไป
  const wk: { [k: string]: number } = {}, wInfo: { [e: string]: ORec } = {};
  for (const r of all) if (weekMonth(r.week) === m) { const k = r.week + "|" + r.emp; wk[k] = (wk[k] || 0) + r.h; wInfo[r.emp] = r; }
  const maxWeek: { [e: string]: number } = {};
  for (const k of Object.keys(wk)) { const e = k.split("|")[1]; if (wk[k] > (maxWeek[e] || 0)) maxWeek[e] = wk[k]; }
  // เดือน × คน
  const pmap: { [e: string]: { a: Agg; days: { [d: string]: boolean }; name: string; dept: string; teamH: { [t: string]: number } } } = {};
  for (const r of rs) {
    const p = pmap[r.emp] = pmap[r.emp] || { a: newAgg(), days: {}, name: r.name, dept: r.dept, teamH: {} };
    addAgg(p.a, r); p.days[r.day] = true; p.teamH[r.team] = (p.teamH[r.team] || 0) + r.h; if (r.name) p.name = r.name;
  }
  const mainTeam = (t: { [k: string]: number }) => Object.keys(t).sort((a, b) => t[b] - t[a] || (a < b ? -1 : 1))[0] || "";
  for (const e of Object.keys(pmap).sort()) {
    const p = pmap[e];
    perRows.push({ Title: m + "|" + e, month_key: m, emp_code: e, emp_name: p.name.slice(0, 255), dept: p.dept, team: mainTeam(p.teamH).slice(0, 255),
      hours: r2(p.a.hours), cnt: p.a.cnt, days: Object.keys(p.days).length, h_t15: r2(p.a.t15), h_off: r2(p.a.off), h_hol: r2(p.a.hol), h_t30: r2(p.a.t30),
      max_week: r2(maxWeek[e] || 0), over_month: p.a.hours > MONTH_LIMIT });
  }
  // เกินเพดาน
  const overW: { [d: string]: { [e: string]: boolean } } = { ALL: {} }, overM: { [d: string]: { [e: string]: boolean } } = { ALL: {} };
  const nW: { [d: string]: number } = {}, nM: { [d: string]: number } = {};
  for (const k of Object.keys(wk).sort()) {
    if (!(wk[k] > WEEK_LIMIT)) continue;
    const [w, e] = k.split("|"), info = wInfo[e];
    const pm = pmap[e], dept = pm ? pm.dept : info.dept, team = pm ? mainTeam(pm.teamH) : info.team, name = pm ? pm.name : info.name;
    overRows.push({ Title: "week|" + w + "|" + e, month_key: m, kind: "week", period_key: w, period_label: weekLabel(w), emp_code: e, emp_name: name.slice(0, 255),
      dept, team: team.slice(0, 255), hours: r2(wk[k]), limit_h: WEEK_LIMIT });
    for (const d of ["ALL", dept]) { (overW[d] = overW[d] || {})[e] = true; nW[d] = (nW[d] || 0) + 1; }
  }
  for (const e of Object.keys(pmap).sort()) {
    const p = pmap[e]; if (!(p.a.hours > MONTH_LIMIT)) continue;
    overRows.push({ Title: "month|" + m + "|" + e, month_key: m, kind: "month", period_key: m, period_label: monthLabel(m), emp_code: e, emp_name: p.name.slice(0, 255),
      dept: p.dept, team: mainTeam(p.teamH).slice(0, 255), hours: r2(p.a.hours), limit_h: MONTH_LIMIT });
    for (const d of ["ALL", p.dept]) { (overM[d] = overM[d] || {})[e] = true; nM[d] = (nM[d] || 0) + 1; }
  }
  // เดือน × แผนก
  const depts = ["ALL"].concat(Object.keys(rs.reduce((o: { [d: string]: boolean }, r) => { o[r.dept] = true; return o; }, {})).concat(Object.keys(hcm)).filter((d, i, a) => d !== "ALL" && a.indexOf(d) === i).sort());
  const [y, mo] = m.split("-").map(x => Number(x)), nd = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  for (const d of depts) {
    const sub = d === "ALL" ? rs : rs.filter(r => r.dept === d), a = newAgg(), codes: { [c: string]: Agg } = {}, kinds: { [k: string]: Agg } = {};
    for (const r of sub) { addAgg(a, r); addAgg(codes[r.code || "-"] = codes[r.code || "-"] || newAgg(), r); addAgg(kinds[r.kind] = kinds[r.kind] || newAgg(), r); }
    const cj = Object.keys(codes).sort().map(c => ({ c, h: r2(codes[c].hours), n: codes[c].cnt, p: Object.keys(codes[c].who).length }));
    const tj = ["t15", "hol", "off", "t30"].filter(k => kinds[k]).map(k => ({ t: k, h: r2(kinds[k].hours), n: kinds[k].cnt, p: Object.keys(kinds[k].who).length }));
    const h = hcm[d] || [0, 0, 0];
    monRows.push({ Title: m + "|" + d, month_key: m, dept: d, dept_label: DEPT_LBL[d] || d, month_label: monthLabel(m), days_in_month: nd,
      hours: r2(a.hours), cnt: a.cnt, people: Object.keys(a.who).length, h_t15: r2(a.t15), h_off: r2(a.off), h_hol: r2(a.hol), h_t30: r2(a.t30),
      codes_json: JSON.stringify(cj), types_json: JSON.stringify(tj), headcount: h[0], new_hires: h[1], resigned: h[2],
      flights: d === "ALL" ? fl[0] : 0, flight_days: d === "ALL" ? fl[1] : 0,
      over36_people: Object.keys(overW[d] || {}).length, over36_times: nW[d] || 0, over144_people: Object.keys(overM[d] || {}).length, over144_times: nM[d] || 0,
      sig: d === "ALL" ? sig : "", data_updated: updated.slice(0, 255), source_file: src });
  }
}

// กำลังพล ณ สิ้นเดือน (เริ่มงาน ≤ สิ้นเดือน และยังไม่พ้นสภาพ ณ สิ้นเดือน) · เข้าใหม่ · ลาออก — ตามชีต แดชบอร์ด
function headcount(emps: OEmp[], m: string): { [d: string]: number[] } {
  const [y, mo] = m.split("-").map(x => Number(x)), end = m + "-" + p2o(new Date(Date.UTC(y, mo, 0)).getUTCDate()), start = m + "-01";
  const out: { [d: string]: number[] } = {};
  for (const e of emps) {
    for (const d of ["ALL", e.dept]) {
      const o = out[d] = out[d] || [0, 0, 0];
      if (e.start <= end && (!e.end || e.end > end)) o[0]++;
      if (e.start >= start && e.start <= end) o[1]++;
      if (e.end && e.end >= start && e.end <= end) o[2]++;
    }
  }
  return out;
}
function flightsOf(f: { [d: string]: number }, m: string): number[] {
  let n = 0, d = 0;
  for (const k of Object.keys(f)) if (k.slice(0, 7) === m) { n += f[k]; d++; }
  return [n, d];
}

// ---------- ตัวช่วย ----------
function newAgg(): Agg { return { hours: 0, cnt: 0, t15: 0, off: 0, hol: 0, t30: 0, who: {} }; }
function addAgg(a: Agg, r: ORec) {
  a.hours += r.h; a.cnt++; a.who[r.emp] = true;
  if (r.kind === "hol") a.hol += r.h; else if (r.kind === "off") a.off += r.h; else if (r.kind === "t30") a.t30 += r.h; else a.t15 += r.h;
}
// ประเภท OT: ก่อน/หลังเลิกงาน x1.5 · วันหยุด x1.0 · นักขัตฤกษ์ x1.0 · ก่อน/หลังเลิกงาน วันหยุด x3.0
function kindOf(s: string): string {
  if (/นักขัต/.test(s)) return "hol";
  if (/x\s*3/i.test(s)) return "t30";
  if (/วันหยุด/.test(s)) return "off";
  return "t15";
}
// LL ใช้ตำแหน่งแทนทีม → รวมเป็น "LL" · ตัด " / สถานที่ทำงาน : …"
function teamOf(dept: string, raw: string): string {
  if (dept === "LL") return "LL";
  const t = String(raw).split(" / ")[0].replace(/\s+/g, " ").trim();
  return t || "ไม่ระบุทีม";
}
function isoOf(v: Cell): string {
  if (typeof v === "number" && v > 30000 && v < 80000) {
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
    return d.getUTCFullYear() + "-" + p2o(d.getUTCMonth() + 1) + "-" + p2o(d.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + "-" + p2o(+m[2]) + "-" + p2o(+m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { let y = +m[3]; if (y > 2400) y -= 543; return y + "-" + p2o(+m[2]) + "-" + p2o(+m[1]); }
  return "";
}
function num(v: Cell): number {
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+:\d{2}/.test(s)) { const p = s.split(":"); return (+p[0]) + (+p[1]) / 60; }
  return parseFloat(s.replace(/,/g, "")) || 0;
}
function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z"), wd = (d.getUTCDay() + 6) % 7;
  const m = new Date(d.getTime() - wd * 86400000);
  return m.getUTCFullYear() + "-" + p2o(m.getUTCMonth() + 1) + "-" + p2o(m.getUTCDate());
}
function thDate(iso: string): string { const [y, m, d] = iso.split("-").map(x => Number(x)); return d + " " + TH_MON[m - 1] + " " + String(y + 543).slice(2); }
function weekLabel(mon: string): string {
  const s = new Date(new Date(mon + "T00:00:00Z").getTime() + 6 * 86400000);
  return thDate(mon) + " – " + thDate(s.getUTCFullYear() + "-" + p2o(s.getUTCMonth() + 1) + "-" + p2o(s.getUTCDate()));
}
function monthLabel(m: string): string { const [y, mo] = m.split("-").map(x => Number(x)); return TH_MON[mo - 1] + " " + String(y + 543).slice(2); }
function fnv(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function r2(x: number): number { return Math.round(x * 100) / 100; }
function p2o(x: number): string { return (x < 10 ? "0" : "") + x; }
function toBatchesO(out: OBatch[], site: string, list: string, rows: object[]) {
  const CRLF = "\r\n", url = site + "/_api/web/lists/getbytitle('" + list + "')/items";
  for (let i = 0; i < rows.length; i += BATCH_O) {
    const id = list + "_" + (i / BATCH_O) + "_" + Math.floor(Math.random() * 1e9), b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = rows.slice(i, i + BATCH_O);
    for (const r of chunk)
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF +
        "POST " + url + " HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF +
        "Accept: application/json;odata=nometadata" + CRLF + CRLF + JSON.stringify(r) + CRLF + CRLF;
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    out.push({ list, boundary: b, body, n: chunk.length });
  }
}
