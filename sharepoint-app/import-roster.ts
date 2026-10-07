/*
 * import-roster.ts — Office Script: ไฟล์เวรรายวัน (.xlsx) → แถวสำหรับ SharePoint Lists
 *   PAS_Manpower · PAS_Duty · PAS_Assignment   (ไซต์ /sites/0AAYJ05_KoLORUk9PVA)
 *
 * เรียกจาก Power Automate (Excel Online (Business) → "Run script") ไม่แก้ไขไฟล์ต้นทาง
 *   พารามิเตอร์: workDate = "YYYY-MM-DD" (เว้นว่างได้ → เดาจากชื่อไฟล์/หัวชีต MANPOWER)
 *                fileName = ชื่อไฟล์ (เช่น 19SEP26.xlsx) ใช้เดาวันที่ + เก็บใน source_file
 *   คืนค่า: { work_date, manpower[], duty[], assignment[], counts }  — คีย์ตรงกับชื่อคอลัมน์ใน List
 *
 * layout แท็บทีม (0-based) เหมือน office-script-dashboard.ts:
 *   0=ID 2=NAME 3=SHIFT 4=IN 6=ชม. 12,15=OT 16=STATUS 17=REMARK · ไฟลท์เริ่มคอลัมน์ 19 ทีละ 4
 *   หัวไฟลท์ = แถวที่คอลัมน์ 18 ขึ้นต้น "FLIGHT" / "STA" / "OP"
 */
const DEP_LEAD = 60, ARR_TAIL = 45, DEF_JOB = 45;
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type Cell = string | number | boolean;
interface MpRow { Title: string; day_key: string; work_date: string; team: string; total: number; working: number; sick: number; annual: number; training: number; ot_hours: number; util_pct: number }
interface DutyRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; bucket: string; shift_code: string; shift_start: string; shift_hours: number; ot_hours: number; duty_min: number; busy_min: number; util_pct: number; source_file: string }
interface AsgRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; task: string; sta: string; std: string; counter_open: string; counter_close: string; win_lo: number; win_hi: number; is_flight: boolean }
interface Result { work_date: string; manpower: MpRow[]; duty: DutyRow[]; assignment: AsgRow[]; counts: { teams: number; duty: number; assignment: number } }

function main(workbook: ExcelScript.Workbook, workDate?: string, fileName?: string): Result {
  const mp = workbook.getWorksheet("MANPOWER");
  const mv: Cell[][] = mp ? mp.getUsedRange().getValues() : [];
  const day = normDate(workDate || "") || dateFromText(fileName || "") || dateFromText(mv.slice(0, 6).map(r => r.join(" ")).join(" "));
  if (!day) throw new Error("หา work_date ไม่ได้ — ส่ง workDate=YYYY-MM-DD หรือตั้งชื่อไฟล์เช่น 19SEP26.xlsx");
  const src = fileName || "";

  // ---- ทีมจาก MANPOWER ("Team (XX)") ; ไม่มี MANPOWER → ใช้ทุกแท็บที่มีหัว FLIGHT ----
  const teams: { code: string; total: number; working: number; sick: number; annual: number; training: number }[] = [];
  for (const r of mv) {
    const m = String(r[0] || "").match(/Team\s*\((.+?)\)/);
    if (m) teams.push({ code: m[1].trim(), total: n(r[1]), working: n(r[9]), sick: n(r[3]), annual: n(r[5]), training: n(r[8]) });
  }
  if (!teams.length) for (const ws of workbook.getWorksheets()) {
    const g = ws.getRange("A1:AQ60").getValues();
    if (findByS(g, "FLIGHT") >= 0) teams.push({ code: ws.getName(), total: 0, working: 0, sick: 0, annual: 0, training: 0 });
  }

  const duty: DutyRow[] = [], asg: AsgRow[] = [], manpower: MpRow[] = [];
  for (const t of teams) {
    const ws = workbook.getWorksheet(t.code);
    let otSum = 0, uSum = 0, uN = 0;
    if (ws) {
      const g = ws.getRange("A1:AQ300").getValues();
      const fRow = findByS(g, "FLIGHT"), sRow = findByS(g, "STA"), oRow = findByS(g, "OP");
      const flights: { base: number; code: string; STA: string; STD: string; OP: string; CL: string }[] = [];
      if (fRow >= 0) for (let b = 19; b + 3 < g[fRow].length; b += 4) {
        const code = String(g[fRow][b] || "").trim();
        if (!code || !/\d|BRE?IF|GOM/i.test(code)) continue;
        flights.push({ base: b, code, STA: hhmm(sRow >= 0 ? g[sRow][b] : ""), STD: hhmm(sRow >= 0 ? g[sRow][b + 2] : ""), OP: hhmm(oRow >= 0 ? g[oRow][b] : ""), CL: hhmm(oRow >= 0 ? g[oRow][b + 2] : "") });
      }
      const seen: { [k: string]: number } = {};
      for (const row of g) {
        const id = row[0], name = String(row[2] || "").trim();
        if (typeof id !== "number" || !name || name.indexOf("Ex.") === 0) continue;
        const emp = String(id);
        const ot = n(row[12]) + n(row[15]);
        otSum += ot;
        const bucket = bucketOf(String(row[16] || ""), String(row[17] || ""), ot);
        const ds = t2m(row[4]), hrs = n(row[6]);
        let de = (ds != null && hrs) ? ds + Math.round(hrs * 60) : null;
        if (ds != null && de != null && de <= ds) de += 1440;
        const dutyMin = (ds != null && de != null && isWork(bucket)) ? de - ds : 0;

        const iv: number[][] = [];
        if (isWork(bucket)) for (const f of flights) {
          const cells = [0, 1, 2, 3].map(k => String(row[f.base + k] == null ? "" : row[f.base + k]).trim()).filter(x => x !== "");
          if (!cells.length) continue;
          const w = winOf(f);
          if (w) iv.push(w);
          asg.push({
            Title: f.code, day_key: day, work_date: day, team: t.code, emp_code: emp, emp_name: name,
            task: cells.join(" ").slice(0, 255), sta: f.STA, std: f.STD, counter_open: f.OP, counter_close: f.CL,
            win_lo: w ? w[0] : 0, win_hi: w ? w[1] : 0, is_flight: /\d/.test(f.code)
          });
        }
        const busy = mergeMin(dutyMin > 0 ? clampIv(iv, ds as number, de as number) : iv);
        const util = dutyMin > 0 ? Math.min(100, Math.round(busy / dutyMin * 100)) : 0;
        if (dutyMin > 0) { uSum += util; uN++; }
        const k = day + "|" + t.code + "|" + emp;
        seen[k] = (seen[k] || 0) + 1;
        duty.push({
          Title: seen[k] > 1 ? k + "#" + seen[k] : k, day_key: day, work_date: day, team: t.code, emp_code: emp, emp_name: name,
          bucket, shift_code: String(row[3] || "").trim(), shift_start: ds != null ? m2hhmm(ds) : "",
          shift_hours: hrs, ot_hours: round1(ot), duty_min: dutyMin, busy_min: busy, util_pct: util, source_file: src
        });
      }
    }
    manpower.push({
      Title: day + "|" + t.code, day_key: day, work_date: day, team: t.code, total: t.total, working: t.working,
      sick: t.sick, annual: t.annual, training: t.training, ot_hours: round1(otSum), util_pct: uN ? Math.round(uSum / uN) : 0
    });
  }
  return { work_date: day, manpower, duty, assignment: asg, counts: { teams: manpower.length, duty: duty.length, assignment: asg.length } };
}

// ---------- helpers ----------
function n(v: Cell): number { return typeof v === "number" ? v : 0; }
function round1(x: number): number { return Math.round(x * 10) / 10; }
function pad(x: number): string { return (x < 10 ? "0" : "") + x; }
function m2hhmm(m: number): string { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
function t2m(v: Cell): number | null {
  if (typeof v === "number") return Math.round((v - Math.floor(v)) * 1440);   // Excel time serial
  const m = String(v || "").match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function hhmm(v: Cell): string { const m = t2m(v); return m == null || (typeof v === "number" && v === 0) ? "" : m2hhmm(m); }
function isWork(b: string): boolean { return b === "WORKING" || b === "OT_OFF"; }
function bucketOf(status: string, remark: string, ot: number): string {
  const txt = (remark || status).toUpperCase().trim();
  if (txt.indexOf("SICK") >= 0 || txt === "SL" || txt === "MC") return "SICK";
  if (txt.indexOf("VAC") >= 0 || ["AL", "VL"].indexOf(txt) >= 0) return "VACATION";
  if (["BL", "ML", "PL", "LEAVE"].indexOf(txt) >= 0 || txt.indexOf("LEAVE") >= 0) return "LEAVE";
  if (txt.indexOf("TRAIN") >= 0) return "TRAINING";
  if (txt.indexOf("OFF") === 0 || txt === "X") return ot > 0 ? "OT_OFF" : "OFF";
  return "WORKING";
}
function findByS(g: Cell[][], label: string): number {
  for (let i = 0; i < g.length; i++) { const s = String(g[i][18] || "").toUpperCase().trim(); if (s.indexOf(label) === 0) return i; }
  return -1;
}
function winOf(a: { STA: string; STD: string; OP: string; CL: string }): number[] | null {
  const op = t2m(a.OP), cl = t2m(a.CL), sta = t2m(a.STA), std = t2m(a.STD);
  if (op != null && cl != null) return [op, cl < op ? cl + 1440 : cl];
  if (std != null) return [Math.max(0, std - DEP_LEAD), std];
  if (sta != null) return [sta, sta + ARR_TAIL];
  if (op != null) return [op, op + DEF_JOB];
  return null;
}
function mergeMin(iv: number[][]): number {
  if (!iv.length) return 0;
  iv = iv.slice().sort((a, b) => a[0] - b[0]);
  let tot = 0, lo = iv[0][0], hi = iv[0][1];
  for (let i = 1; i < iv.length; i++) { if (iv[i][0] <= hi) hi = Math.max(hi, iv[i][1]); else { tot += hi - lo; lo = iv[i][0]; hi = iv[i][1]; } }
  return tot + (hi - lo);
}
// ช่วงงานที่ตัดกับกะ (รองรับกะข้ามเที่ยงคืน: ลองเลื่อนช่วงงาน +1440)
function clampIv(iv: number[][], lo: number, hi: number): number[][] {
  const o: number[][] = [];
  for (const s of iv) for (const sh of [0, 1440]) { const a = Math.max(s[0] + sh, lo), b = Math.min(s[1] + sh, hi); if (b > a) o.push([a, b]); }
  return o;
}
function normDate(s: string): string {
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]) : "";
}
// "19SEP26" / "19 SEP 2026" / "2026-09-19" / "19/09/2026"
function dateFromText(s: string): string {
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (iso) return normDate(iso[0]);
  const a = s.toUpperCase().match(/(\d{1,2})\s*-?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*-?\s*(\d{2,4})?/);
  if (a) {
    let y = a[3] ? +a[3] : new Date().getFullYear();
    if (y < 100) y += 2000; if (y > 2400) y -= 543;               // ปี พ.ศ.
    return y + "-" + pad(MON.indexOf(a[2]) + 1) + "-" + pad(+a[1]);
  }
  const d = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (d) { let y = +d[3]; if (y > 2400) y -= 543; return y + "-" + pad(+d[2]) + "-" + pad(+d[1]); }
  return "";
}
