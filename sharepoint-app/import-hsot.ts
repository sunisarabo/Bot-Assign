/*
 * import-hsot.ts — Office Script: ไฟล์ OT ที่ขอจริงจาก HumanSoft → PAS_OT_Request (ใช้หน้า 🔍 ตรวจ OT)
 *   กติกาอ่านเดียวกับ OTCompare.gs (rbOTCompareData_ ข้อ 1–2):
 *   · แถวหัวคน  : คอลัมน์ A = รหัส 6–7 หลัก · B = ชื่อ · C = ตำแหน่ง
 *   · แถวรายการ : คอลัมน์ B = วันที่ dd/mm/yyyy · D = ทีม · I = เวลาเริ่ม · J = เวลาเลิก · L = ชั่วโมง · M = เหตุผล
 *   · ชีตข้อมูล : "สำเนาของ ชีต1" → "ชีต1" → ชีตแรกที่มีรายการ · ชีต "ทีม" (A = รหัส · B = ทีม) ถ้ามี ใช้ก่อน
 *   ทีมของคน: ชีต "ทีม" → PAS_Employees (พารามิเตอร์ emps) → คอลัมน์ D ของ HumanSoft
 *
 * พารามิเตอร์: emps = JSON [{Title, team}] จาก PAS_Employees (ไม่บังคับ) · siteUrl (ไม่บังคับ)
 * คืน { status, days[], counts, batches[] } → flow ลบแถวเดิมของวันใน days[] ก่อน แล้วส่ง batches (_api/$batch)
 */
const SITE_H = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const BATCH_H = 100;
interface HBatch { list: string; boundary: string; body: string; n: number }
interface HRow { Title: string; day_key: string; month_key: string; emp_code: string; emp_name: string; position: string; team: string;
  time_start: string; time_end: string; hours: number; reason: string; source_file: string }

function main(workbook: ExcelScript.Workbook, emps?: string, siteUrl?: string, filePath?: string) {
  const teamOf: { [c: string]: string } = {};
  if (emps) for (const e of JSON.parse(emps) as { Title?: string; team?: string }[]) if (e.Title && e.team) teamOf[String(e.Title).replace(/\D/g, "")] = String(e.team);
  const ts = workbook.getWorksheet("ทีม");
  if (ts) {
    const t = ts.getUsedRange().getTexts();
    for (let i = 1; i < t.length; i++) { const c = String(t[i][0]).trim(); if (c && String(t[i][1]).trim()) teamOf[c] = String(t[i][1]).trim(); }
  }
  const order = ["สำเนาของ ชีต1", "ชีต1"];
  const sheets = workbook.getWorksheets().slice().sort((a, b) => rank(a.getName()) - rank(b.getName()));
  function rank(n: string): number { const i = order.indexOf(n.trim()); return i < 0 ? 9 : i; }
  let rows: HRow[] = [], used = "";
  for (const ws of sheets) {
    if (ws.getName().trim() === "ทีม") continue;
    const r = ws.getUsedRange(); if (!r) continue;
    rows = parseHs(r.getTexts(), r.getValues(), teamOf, filePath || "");
    if (rows.length) { used = ws.getName(); break; }
  }
  const days: string[] = [];
  for (const r of rows) if (days.indexOf(r.day_key) < 0) days.push(r.day_key);
  days.sort();
  const batches: HBatch[] = [];
  toBatches(batches, (siteUrl || SITE_H).replace(/\/$/, ""), "PAS_OT_Request", rows);
  return { status: rows.length ? "ok" : "skipped", reason: rows.length ? "" : "ไม่พบรายการ OT (แถวรหัส 6–7 หลัก ตามด้วยแถววันที่ dd/mm/yyyy)",
    sheet: used, days, counts: { rows: rows.length, people: Object.keys(rows.reduce((m: { [k: string]: boolean }, r) => { m[r.emp_code] = true; return m; }, {})).length,
      hours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100 }, batches };
}

function parseHs(t: string[][], v: (string | number | boolean)[][], teamOf: { [c: string]: string }, src: string): HRow[] {
  const out: HRow[] = [], seq: { [k: string]: number } = {};
  let code = "", name = "", pos = "";
  for (let i = 0; i < t.length; i++) {
    const c0 = String(t[i][0] || "").trim(), c1 = String(t[i][1] || "").trim(), c2 = String(t[i][2] || "").trim();
    if (/^\d{6,7}$/.test(c0)) { code = c0; name = c1; pos = c2 || "เจ้าหน้าที่"; continue; }
    const iso = dateIso(c1, v[i] ? v[i][1] : "");
    if (!iso || !code) continue;
    const k = iso + "|" + code; seq[k] = (seq[k] || 0) + 1;
    out.push({ Title: k + "|" + seq[k], day_key: iso, month_key: iso.slice(0, 7), emp_code: code, emp_name: name, position: pos,
      team: teamOf[code] || String(t[i][3] || "").trim() || "ไม่ระบุทีม",
      time_start: hhmm(t[i][8], v[i] ? v[i][8] : ""), time_end: hhmm(t[i][9], v[i] ? v[i][9] : ""),
      hours: hrs(String(t[i][11] || ""), v[i] ? v[i][11] : ""), reason: (String(t[i][12] || "").trim() || "ไม่ได้ระบุ").slice(0, 255), source_file: src.slice(0, 255) });
  }
  return out;
}
// วันที่: ข้อความ dd/mm/yyyy (พ.ศ. ได้) หรือเลขวันที่ของ Excel
function dateIso(txt: string, val: string | number | boolean): string {
  const m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) { let y = +m[3]; if (y > 2400) y -= 543; return y + "-" + p2(+m[2]) + "-" + p2(+m[1]); }
  if (typeof val === "number" && val > 30000 && val < 80000 && /\d/.test(txt)) {
    const d = new Date(Math.round((val - 25569) * 86400000));
    return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
  }
  return "";
}
function hhmm(txt: string, val: string | number | boolean): string {
  const m = String(txt || "").match(/(\d{1,2})[:.](\d{2})/);
  if (m) return p2(+m[1]) + ":" + m[2];
  if (typeof val === "number" && val > 0 && val < 1) { const mm = Math.round(val * 1440); return p2(Math.floor(mm / 60) % 24) + ":" + p2(mm % 60); }
  return String(txt || "").trim();
}
// ชั่วโมง: "3:30" = 3.5 · ตัวเลข = ชั่วโมง · ค่าเวลาของ Excel (เศษวัน) = ×24
function hrs(txt: string, val: string | number | boolean): number {
  const s = txt.trim();
  if (s.indexOf(":") >= 0) { const p = s.split(":"); return round2((parseFloat(p[0]) || 0) + (parseFloat(p[1]) || 0) / 60); }
  if (typeof val === "number") return round2(val > 0 && val < 1 && /:/.test(s) ? val * 24 : val);
  return round2(parseFloat(s) || 0);
}
function round2(x: number): number { return Math.round(x * 100) / 100; }
function p2(x: number): string { return (x < 10 ? "0" : "") + x; }
function toBatches(out: HBatch[], site: string, list: string, rows: object[]) {
  const CRLF = "\r\n", url = site + "/_api/web/lists/getbytitle('" + list + "')/items";
  for (let i = 0; i < rows.length; i += BATCH_H) {
    const id = list + "_" + (i / BATCH_H) + "_" + Math.floor(Math.random() * 1e9), b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = rows.slice(i, i + BATCH_H);
    for (const r of chunk)
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF +
        "POST " + url + " HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF +
        "Accept: application/json;odata=nometadata" + CRLF + CRLF + JSON.stringify(r) + CRLF + CRLF;
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    out.push({ list, boundary: b, body, n: chunk.length });
  }
}
