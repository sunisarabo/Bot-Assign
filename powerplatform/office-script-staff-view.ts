/*
 * office-script-staff-view.ts — Office Script · ไฟล์ PAS_2026-10 (export รวมรายเดือน)
 *   สร้างชีต "Staff View" สำหรับ "พนักงานหน้างานที่ไม่มีบัญชี M365" (เปิดด้วยเมลกลางทีม · อ่านอย่างเดียว)
 *   - รวมทุกแท็บวัน แต่ "ตัดวันอนาคตเกินพรุ่งนี้ (วันนี้+1) ทิ้ง" → เห็นได้ย้อนหลังทั้งหมด + ล่วงหน้าถึงพรุ่งนี้
 *   - 1 แถว = 1 คน-ต่อวัน · มี AutoFilter → Staff พิมพ์ "รหัส" ตัวเอง = งานของฉัน · พิมพ์ "ทีม" = งานทีม
 *
 *   เพดานวันบังคับที่ "ข้อมูล" ไม่ใช่ "สิทธิ์" — ชีตนี้ไม่มีวันอนาคตไกล จึงแอบดูแผนที่ยังไม่ fix ไม่ได้
 *
 *   parameters:
 *     todayISO = วันอ้างอิง "วันนี้" (เช่น "2026-10-15"); เว้นว่าง = ใช้วันจริงของเครื่อง
 *                (จาก Power Automate ส่ง utcNow('yyyy-MM-dd') มาได้)
 *     year     = ปี ค.ศ. ของแท็บวัน (เช่น 2026); 0 = เดาจากชื่อไฟล์ / ปีของ todayISO
 * ใช้: เปิด PAS_2026-10 ใน Excel Online → Automate → New Script → วาง → Run
 */
function main(workbook: ExcelScript.Workbook, todayISO: string = "", year: number = 0): void {
  const ROYAL = "#1D428A";
  const MONTHS: { [k: string]: number } = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

  // "วันนี้" + เพดาน = วันนี้+1 (สิ้นวันพรุ่งนี้)
  const today = todayISO ? new Date(todayISO + "T00:00:00") : new Date();
  const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 23, 59, 59);
  if (!year) year = guessYear(workbook.getName(), today.getFullYear());

  type Row = { date: string; d: Date; code: string; name: string; team: string; pos: string; shift: string; util: number; jobs: string };
  const out: Row[] = [];
  let skipped = 0;

  for (const ws of workbook.getWorksheets()) {
    const nm = ws.getName();
    const m = nm.match(/^(\d{2})([A-Z]{3})$/);                 // เช่น 15OCT
    if (!m || !(m[2] in MONTHS)) continue;
    const dt = new Date(year, MONTHS[m[2]], +m[1]);
    if (dt.getTime() > maxDate.getTime()) { skipped++; continue; }   // อนาคตเกินพรุ่งนี้ → ตัดทิ้ง

    const vals = ws.getUsedRange().getValues();
    const du = section(vals, "PAS_Duty"), ag = section(vals, "PAS_Assignment");
    const D = col(du.header), A = col(ag.header);

    // งานที่รับ (รวมต่อคน)
    const jobs: { [code: string]: string[] } = {};
    for (const r of ag.rows) {
      const code = str(r[A.emp_code]); if (!code) continue;
      const label = (str(r[0]) + (str(r[A.task]) ? " " + str(r[A.task]) : "")).trim();
      if (label) (jobs[code] = jobs[code] || []).push(label);
    }
    for (const r of du.rows) {
      const bucket = str(r[D.bucket]).toUpperCase();
      if (bucket.indexOf("WORK") < 0 && bucket.indexOf("OT_OFF") < 0) continue;   // เฉพาะคนทำงาน
      const code = str(r[D.emp_code]); const js = jobs[code] || [];
      out.push({ date: nm, d: dt, code, name: str(r[D.emp_name]), team: str(r[D.team]), pos: str(r[D.pos_group]), shift: str(r[D.shift_code]), util: n(r[D.util_pct]), jobs: js.join(" · ") });
    }
  }
  out.sort((a, b) => (b.d.getTime() - a.d.getTime()) || a.team.localeCompare(b.team) || a.code.localeCompare(b.code));

  // ---- สร้างชีต Staff View ----
  const old = workbook.getWorksheet("Staff View"); if (old) old.delete();
  const sv = workbook.addWorksheet("Staff View"); sv.activate();
  bold(sv.getRange("A1"), "PAS · งานของฉัน/ทีม (พิมพ์รหัสหรือทีมในช่องกรอง)", 16, ROYAL);
  bold(sv.getRange("A2"), "ย้อนหลังได้ทุกวัน · ล่วงหน้าถึงพรุ่งนี้เท่านั้น · อ่านอย่างเดียว", 10, "#5b7189");

  const H = ["วันที่", "รหัส", "ชื่อ", "ทีม", "ตำแหน่ง", "กะ", "Util%", "ไฟลท์/งานที่รับ"];
  sv.getRangeByIndexes(3, 0, 1, H.length).setValues([H]); headerFmt(sv.getRangeByIndexes(3, 0, 1, H.length), ROYAL);
  const body = out.map(r => [r.date, r.code, r.name, r.team, r.pos, r.shift, r.util, r.jobs]);
  if (body.length) sv.getRangeByIndexes(4, 0, body.length, H.length).setValues(body);
  try { sv.getAutoFilter().apply(sv.getRangeByIndexes(3, 0, body.length + 1, H.length)); } catch (e) { }
  sv.getRangeByIndexes(3, 0, body.length + 1, H.length).getFormat().autofitColumns();

  console.log("Staff View: " + body.length + " แถว · ตัดวันอนาคต " + skipped + " แท็บ · เพดาน " + maxDate.toDateString());
}

// ---- helpers ----
function guessYear(fileName: string, fallback: number): number {
  const m = fileName.match(/(20\d{2})/); return m ? +m[1] : fallback;
}
function section(vals: (string | number | boolean)[][], name: string): { header: string[]; rows: (string | number | boolean)[][] } {
  let start = -1, cnt = 0;
  for (let i = 0; i < vals.length; i++) {
    const a = String(vals[i][0] || "");
    if (a.indexOf("■ " + name) === 0 || a.indexOf("■" + name) === 0) { start = i; const m = a.match(/(\d+)\s*แถว/); cnt = m ? +m[1] : 9999; break; }
  }
  if (start < 0) return { header: [], rows: [] };
  const header = (vals[start + 1] || []).map(x => String(x || ""));
  const rows: (string | number | boolean)[][] = [];
  for (let i = start + 2; i < vals.length && rows.length < cnt; i++) { if (String(vals[i][0] || "").indexOf("■") === 0) break; if (String(vals[i][0] || "") === "") break; rows.push(vals[i]); }
  return { header, rows };
}
function col(header: string[]): { [k: string]: number } { const m: { [k: string]: number } = {}; header.forEach((h, i) => { m[h] = i; }); return m; }
function str(v: (string | number | boolean)): string { return v == null ? "" : String(v).trim(); }
function n(v: (string | number | boolean)): number { const x = Number(String(v == null ? "" : v).trim()); return isFinite(x) ? x : 0; }
function bold(rg: ExcelScript.Range, t: string, size: number, color: string) { rg.setValue(t); rg.getFormat().getFont().setSize(size); rg.getFormat().getFont().setBold(true); rg.getFormat().getFont().setColor(color); }
function headerFmt(rg: ExcelScript.Range, color: string) { rg.getFormat().getFill().setColor(color); rg.getFormat().getFont().setColor("#FFFFFF"); rg.getFormat().getFont().setBold(true); }
