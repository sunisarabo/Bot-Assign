/*
 * import-roster.ts — Office Script: ไฟล์เวรรายวัน (.xlsx) → SharePoint Lists (PAS_Manpower · PAS_Duty · PAS_Assignment)
 *   ไซต์ /sites/0AAYJ05_KoLORUk9PVA · เรียกจาก Power Automate (Excel Online (Business) → Run script) · ไม่แก้ไฟล์ต้นทาง
 *
 * พารามิเตอร์
 *   filePath  = path เต็มของไฟล์ เช่น "Shared Documents/2025/09.SEP26/19SEP.xlsx"  (ใช้หาวันที่ — รองรับเดือนใหม่/ปีใหม่เอง)
 *   workDate  = "YYYY-MM-DD" (ไม่บังคับ — ใส่เมื่ออยากบังคับวันที่)
 *   siteUrl   = URL ไซต์ (ไม่บังคับ — ค่าเริ่มต้น SITE)
 *   holidays  = JSON วันหยุดประเพณีจาก List PAS_Holidays (ไม่บังคับ) → มาทำงานวันนั้น = OT นักขัต X1 เท่าชั่วโมงกะ
 *
 * OT (ตรงกับระบบเดิม): ot_total = OT ปกติ + OT นักขัต · แถวซัพพอร์ต "ชื่อ (ทีม)" ไม่นับ OT
 *   PAS_Manpower = OT รายทีม/วัน (OT Dashboard) · PAS_OT_Person = OT รายคน/วัน เฉพาะคนที่มี OT (เตือนสัปดาห์/เดือน)
 *
 * ลำดับหาวันที่: workDate → ชื่อไฟล์ (+เดือน/ปีจากโฟลเดอร์แม่) → หัวชีต MANPOWER → (ไม่พบ = skipped)
 *   รองรับ: 19SEP · 19SEP26 · 19 SEP 2026 · 2026-09-19 · 20260919 · 19.09.26 · 19/09/2569 · 19 ก.ย. 69 · "19" (เดือน/ปีจากโฟลเดอร์)
 *   โฟลเดอร์เดือน: 09.SEP26 · SEP 2026 · SEP · 09 · ก.ย.69 · กันยายน 2569  · โฟลเดอร์ปี: 2026 / 2569
 *   ปีจากโฟลเดอร์เดือน (SEP26) ชนะโฟลเดอร์ปี (เช่น /2025/09.SEP26 → 2026) · ไม่มีปีเลย → เลือกปีที่ใกล้วันนี้ที่สุด (ข้ามธ.ค.→ม.ค. ถูก)
 *
 * คืนค่า: { status:"ok"|"skipped", reason, work_date, date_source, warnings[], counts{teams,duty,assignment,ot_people}, batches[{list,boundary,body,n}] }
 *   batches = เนื้อ SharePoint $batch (≤100 แถว/ก้อน) → flow ส่งด้วย "Send an HTTP request to SharePoint" ทีละก้อน
 *
 * layout แท็บทีม (0-based): 0=ID 2=NAME 3=SHIFT 4=IN 6=ชม. 12,15=OT 16=STATUS 17=REMARK · ไฟลท์เริ่มคอลัมน์ 19 ทีละ 4
 *   หัวไฟลท์ = แถวที่คอลัมน์ 18 ขึ้นต้น "FLIGHT" / "STA" / "OP"
 */
const SITE = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const BATCH_SIZE = 100;
const DEP_LEAD = 60, ARR_TAIL = 45, DEF_JOB = 45;
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const TH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_ABBR = ["มค", "กพ", "มีค", "เมย", "พค", "มิย", "กค", "สค", "กย", "ตค", "พย", "ธค"];

type Cell = string | number | boolean;
interface MpRow { Title: string; day_key: string; month_key: string; work_date: string; team: string; total: number; working: number; sick: number; annual: number; training: number; ot_hours: number; ot_hol_hours: number; ot_total: number; ot_people: number; ot_off_hours: number; is_holiday: boolean; util_pct: number }
interface DutyRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; bucket: string; shift_code: string; shift_start: string; shift_hours: number; ot_hours: number; ot_hol_hours: number; is_support: boolean; duty_min: number; busy_min: number; util_pct: number; source_file: string }
interface AsgRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; task: string; sta: string; std: string; counter_open: string; counter_close: string; win_lo: number; win_hi: number; is_flight: boolean }
interface OtRow { Title: string; day_key: string; month_key: string; week_key: string; emp_code: string; emp_name: string; team: string; ot_hours: number; ot_hol_hours: number; ot_total: number }
interface Batch { list: string; boundary: string; body: string; n: number }
interface Result { status: string; reason: string; work_date: string; date_source: string; warnings: string[]; counts: { teams: number; duty: number; assignment: number; ot_people: number }; batches: Batch[] }
interface DatePick { iso: string; source: string }

function main(workbook: ExcelScript.Workbook, filePath?: string, workDate?: string, siteUrl?: string, holidays?: string): Result {
  const path = filePath || "";
  const warnings: string[] = [];
  const empty = (reason: string, iso: string, src: string): Result =>
    ({ status: "skipped", reason, work_date: iso, date_source: src, warnings, counts: { teams: 0, duty: 0, assignment: 0, ot_people: 0 }, batches: [] });

  const mp = workbook.getWorksheet("MANPOWER");
  const mv: Cell[][] = mp ? mp.getUsedRange().getValues() : [];
  const headerText = mv.slice(0, 6).map(r => r.join(" ")).join(" ");

  // ---- วันที่ ----
  let pick: DatePick | null = null;
  const forced = normDate(workDate || "");
  if (forced) pick = { iso: forced, source: "workDate" };
  if (!pick) pick = dateFromPath(path, new Date());
  const hdr = dateFromPath(headerText.replace(/\//g, "-"), new Date());   // หัว MANPOWER (ข้อความ ไม่ใช่ path)
  if (!pick && hdr) pick = { iso: hdr.iso, source: "MANPOWER header" };
  if (pick && hdr && hdr.iso !== pick.iso) warnings.push("วันที่หัว MANPOWER (" + hdr.iso + ") ไม่ตรงกับ " + pick.source + " (" + pick.iso + ")");

  // ---- ทีม ----
  const teams = readTeams(workbook, mv);
  if (!teams.length) return empty("ไม่ใช่ไฟล์เวร PSA (ไม่พบ Team (..) ใน MANPOWER และไม่พบแท็บที่มีหัว FLIGHT)", pick ? pick.iso : "", pick ? pick.source : "");
  if (!pick) return empty("หาวันที่ไม่ได้จาก path/ชื่อไฟล์/หัว MANPOWER — ตั้งชื่อไฟล์เช่น 19SEP.xlsx ในโฟลเดอร์ 09.SEP26 หรือส่ง workDate", "", "");

  const hol = holidaySet(holidays);
  const p = parseRoster(workbook, teams, pick.iso, baseName(path), !!hol[pick.iso]);
  const site = (siteUrl || SITE).replace(/\/$/, "");
  const batches: Batch[] = [];
  addBatches(batches, site, "PAS_Manpower", p.manpower);
  addBatches(batches, site, "PAS_Duty", p.duty);
  addBatches(batches, site, "PAS_Assignment", p.assignment);
  addBatches(batches, site, "PAS_OT_Person", p.otPerson);
  return {
    status: "ok", reason: "", work_date: pick.iso, date_source: pick.source, warnings,
    counts: { teams: p.manpower.length, duty: p.duty.length, assignment: p.assignment.length, ot_people: p.otPerson.length }, batches
  };
}

// ======================= อ่านไฟล์เวร =======================
interface TeamHead { code: string; total: number; working: number; sick: number; annual: number; training: number }

function readTeams(workbook: ExcelScript.Workbook, mv: Cell[][]): TeamHead[] {
  const teams: TeamHead[] = [];
  for (const r of mv) {
    const m = String(r[0] || "").match(/Team\s*\((.+?)\)/);
    if (m) teams.push({ code: m[1].trim(), total: n(r[1]), working: n(r[9]), sick: n(r[3]), annual: n(r[5]), training: n(r[8]) });
  }
  if (!teams.length) for (const ws of workbook.getWorksheets()) {
    if (findByS(ws.getRange("A1:AQ60").getValues(), "FLIGHT") >= 0)
      teams.push({ code: ws.getName(), total: 0, working: 0, sick: 0, annual: 0, training: 0 });
  }
  return teams;
}

function parseRoster(workbook: ExcelScript.Workbook, teams: TeamHead[], day: string, src: string, isHol: boolean) {
  const duty: DutyRow[] = [], assignment: AsgRow[] = [], manpower: MpRow[] = [], otPerson: OtRow[] = [];
  const month = day.slice(0, 7), week = mondayOf(day);
  for (const t of teams) {
    const ws = workbook.getWorksheet(t.code);
    let otSum = 0, holSum = 0, otOff = 0, otPpl = 0, uSum = 0, uN = 0;
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
        // แถวซัพพอร์ต "ชื่อ (WY)" = มาช่วยจากทีมอื่น → ไม่นับ OT ที่ทีมนี้ (นับที่ทีมต้นสังกัด) — เหมือน RosterReader
        const sup = name.match(/\(([A-Z0-9]{2,4})\)\s*$/i);
        const isSup = !!sup && sup[1].toUpperCase() !== t.code.toUpperCase();
        const ot = isSup ? 0 : n(row[12]) + n(row[15]);
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
          assignment.push({
            Title: f.code, day_key: day, work_date: day, team: t.code, emp_code: emp, emp_name: name,
            task: cells.join(" ").slice(0, 255), sta: f.STA, std: f.STD, counter_open: f.OP, counter_close: f.CL,
            win_lo: w ? w[0] : 0, win_hi: w ? w[1] : 0, is_flight: /\d/.test(f.code)
          });
        }
        const busy = mergeMin(dutyMin > 0 ? clampIv(iv, ds as number, de as number) : iv);
        const util = dutyMin > 0 ? Math.min(100, Math.round(busy / dutyMin * 100)) : 0;
        if (dutyMin > 0) { uSum += util; uN++; }
        // วันหยุดประเพณี: มาทำงาน = OT นักขัต X1 เท่าชั่วโมงกะ (ไม่นับอบรม/ซัพพอร์ต)
        const otHol = (isHol && !isSup && bucket === "WORKING" && hrs > 0) ? hrs : 0;
        if (!isSup) {
          otSum += ot; holSum += otHol;
          if (bucket === "OT_OFF") otOff += ot;
          if (ot > 0) otPpl++;
          if (ot + otHol > 0) otPerson.push({
            Title: day + "|" + emp + "|" + t.code, day_key: day, month_key: month, week_key: week, emp_code: emp, emp_name: name,
            team: t.code, ot_hours: round1(ot), ot_hol_hours: round1(otHol), ot_total: round1(ot + otHol)
          });
        }
        const k = day + "|" + t.code + "|" + emp;
        seen[k] = (seen[k] || 0) + 1;
        duty.push({
          Title: seen[k] > 1 ? k + "#" + seen[k] : k, day_key: day, work_date: day, team: t.code, emp_code: emp, emp_name: name,
          bucket, shift_code: String(row[3] || "").trim(), shift_start: ds != null ? m2hhmm(ds) : "",
          shift_hours: hrs, ot_hours: round1(ot), ot_hol_hours: round1(otHol), is_support: isSup, duty_min: dutyMin, busy_min: busy, util_pct: util, source_file: src
        });
      }
    }
    manpower.push({
      Title: day + "|" + t.code, day_key: day, month_key: month, work_date: day, team: t.code, total: t.total, working: t.working,
      sick: t.sick, annual: t.annual, training: t.training, ot_hours: round1(otSum), ot_hol_hours: round1(holSum),
      ot_total: round1(otSum + holSum), ot_people: otPpl, ot_off_hours: round1(otOff), is_holiday: isHol, util_pct: uN ? Math.round(uSum / uN) : 0
    });
  }
  return { manpower, duty, assignment, otPerson };
}

// ======================= SharePoint $batch =======================
function addBatches(out: Batch[], site: string, list: string, rows: object[]) {
  const CRLF = "\r\n";
  const url = site + "/_api/web/lists/getbytitle('" + list + "')/items";
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const id = list + "_" + (i / BATCH_SIZE) + "_" + Math.floor(Math.random() * 1e9);
    const b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = rows.slice(i, i + BATCH_SIZE);
    for (const r of chunk) {
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF +
        "POST " + url + " HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF +
        "Accept: application/json;odata=nometadata" + CRLF + CRLF + JSON.stringify(r) + CRLF + CRLF;
    }
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    out.push({ list, boundary: b, body, n: chunk.length });
  }
}

// ======================= วันที่จาก path =======================
interface Parts { d: number; m: number; y: number }

function dateFromPath(path: string, today: Date): DatePick | null {
  const segs = path.split("/").map(s => s.trim()).filter(s => s !== "");
  if (!segs.length) return null;
  const file = segs[segs.length - 1].replace(/\.[a-z0-9]{2,5}$/i, "");
  const parents = segs.slice(0, -1).reverse();                    // ใกล้สุดก่อน

  const f = partsFromName(file);
  let d = f.d, m = f.m, y = f.y, src = "ชื่อไฟล์";
  if (!d) return null;
  for (const p of parents) {                                      // เดือน (+ปีที่ติดกับเดือน) จากโฟลเดอร์ใกล้สุด
    if (m && y) break;
    const fm = partsFromFolder(p);
    if (!m && fm.m) { m = fm.m; if (!y && fm.y) y = fm.y; src += " + โฟลเดอร์ " + p; }
    else if (m && !y && fm.m === m && fm.y) { y = fm.y; src += " + โฟลเดอร์ " + p; }
  }
  if (m && !y) for (const p of parents) {                         // ปีจากโฟลเดอร์ปี (2026 / 2569)
    const yy = p.match(/(?:^|\D)((?:20|25)\d{2})(?!\d)/);
    if (yy) { y = toCE(+yy[1]); src += " + โฟลเดอร์ปี " + p; break; }
  }
  if (!m) return null;
  if (!y) {                                                        // เดาปีที่ทำให้วันที่ใกล้วันนี้สุด
    const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    let best = 0, bestDiff = Infinity;
    for (const cy of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
      const diff = Math.abs(Date.UTC(cy, m - 1, d) - t);
      if (diff < bestDiff) { bestDiff = diff; best = cy; }
    }
    y = best; src += " + ปีที่ใกล้วันนี้";
  }
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return { iso: y + "-" + pad(m) + "-" + pad(d), source: src };
}

function partsFromName(s: string): Parts {
  const u = s.toUpperCase();
  let r = u.match(/(?:^|\D)((?:20|25)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/);                  // 2026-09-19 / 20260919
  if (r && +r[2] >= 1 && +r[2] <= 12) return { y: toCE(+r[1]), m: +r[2], d: +r[3] };
  r = u.match(/(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?!\d)/);                       // 19.09.26 / 19/09/2569
  if (r && +r[2] >= 1 && +r[2] <= 12) return { d: +r[1], m: +r[2], y: yearTok(r[3]) };
  r = u.match(/(?:^|[^0-9])(\d{1,2})\s*[-_.]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*[-_.]?\s*(\d{4}|\d{2}(?!\d))?/);
  if (r) return { d: +r[1], m: MON.indexOf(r[2]) + 1, y: r[3] ? yearTok(r[3]) : 0 };
  const th = thaiMonth(s);
  if (th.m) {
    const dd = s.slice(0, th.at).match(/(\d{1,2})\s*$/);
    const yy = s.slice(th.end).match(/^\s*(\d{4}|\d{2})(?!\d)/);
    if (dd) return { d: +dd[1], m: th.m, y: yy ? yearTok(yy[1]) : 0 };
  }
  r = u.match(/^\s*(\d{1,2})(?!\d)/);                                                            // "19" / "19 roster"
  if (r && +r[1] >= 1 && +r[1] <= 31) return { d: +r[1], m: 0, y: 0 };
  return { d: 0, m: 0, y: 0 };
}

function partsFromFolder(s: string): Parts {
  const u = s.toUpperCase();
  let r = u.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*[-_.]?\s*(\d{4}|\d{2}(?!\d))?/);
  if (r) return { d: 0, m: MON.indexOf(r[1]) + 1, y: r[2] ? yearTok(r[2]) : 0 };
  const th = thaiMonth(s);
  if (th.m) { const yy = s.slice(th.end).match(/^\s*(\d{4}|\d{2})(?!\d)/); return { d: 0, m: th.m, y: yy ? yearTok(yy[1]) : 0 }; }
  r = u.match(/^\s*(\d{1,2})\s*(?:[._\- ]\s*((?:20|25)\d{2}|\d{2}))?\s*$/);                     // "09" / "09.26" / "09-2026"
  if (r && +r[1] >= 1 && +r[1] <= 12) return { d: 0, m: +r[1], y: r[2] ? yearTok(r[2]) : 0 };
  r = u.match(/^\s*((?:20|25)\d{2})\s*[._\-]\s*(\d{1,2})\s*$/);                                  // "2026-09"
  if (r && +r[2] >= 1 && +r[2] <= 12) return { d: 0, m: +r[2], y: toCE(+r[1]) };
  return { d: 0, m: 0, y: 0 };
}

function thaiMonth(s: string): { m: number; at: number; end: number } {
  for (let i = 0; i < 12; i++) { const k = s.indexOf(TH_FULL[i]); if (k >= 0) return { m: i + 1, at: k, end: k + TH_FULL[i].length }; }
  for (let i = 0; i < 12; i++) {                                   // ก.ย. / กย / ก.ย  (ไล่ยาวก่อน: มี.ค. ก่อน มค)
    const order = [2, 3, 5, 0, 1, 4, 6, 7, 8, 9, 10, 11][i];
    const pat = TH_ABBR[order].split("").join("\\.?\\s?") + "\\.?";
    const r = s.match(new RegExp(pat));
    if (r && r.index !== undefined) return { m: order + 1, at: r.index, end: r.index + r[0].length };
  }
  return { m: 0, at: -1, end: -1 };
}
function toCE(y: number): number { return y > 2400 ? y - 543 : y; }
// 2 หลัก: ≥60 = พ.ศ. (69 → 2026) · <60 = ค.ศ. (26 → 2026)
function yearTok(t: string): number { const v = +t; return t.length === 2 ? (v >= 60 ? 2500 + v - 543 : 2000 + v) : toCE(v); }
function normDate(s: string): string {
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]) : "";
}
function baseName(p: string): string { const s = p.split("/"); return s[s.length - 1] || ""; }

// ======================= OT helpers =======================
// วันจันทร์ของสัปดาห์ (สัปดาห์ จ.–อา. เหมือนเกณฑ์ OT เดิม) → "YYYY-MM-DD"
function mondayOf(iso: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}
// วันหยุดจาก List PAS_Holidays (flow ส่ง JSON: ["2026-10-13", …] หรือ [{"day_key":"2026-10-13"}, …])
function holidaySet(json?: string): { [k: string]: boolean } {
  const out: { [k: string]: boolean } = {};
  if (!json) return out;
  const arr: (string | { day_key?: string })[] = JSON.parse(json);
  for (const x of arr) { const k = typeof x === "string" ? x : (x.day_key || ""); if (k) out[k.slice(0, 10)] = true; }
  return out;
}

// ======================= helpers =======================
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
