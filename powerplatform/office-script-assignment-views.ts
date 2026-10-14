/*
 * office-script-assignment-views.ts — Office Script · ไฟล์ PAS_2026-10 (export รวมรายเดือน)
 *   อ่านแท็บวัน (เช่น 01OCT) ซึ่งมีตารางสะอาดซ้อนกัน (■ PAS_FlightSLA / ■ PAS_Assignment / ■ PAS_Duty)
 *   สร้าง 2 ชีต:
 *     - "Flight Coverage" (B รายไฟลท์ + H ครบ-ขาด): ไฟลท์ · เวลา · ต้องการ vs จัดได้ vs ขาด · สถานะ · รายชื่อ
 *     - "By Person" (G งานของฉัน): รายคน · กะ · Util · ไฟลท์/งานที่รับ  (กรองด้วยรหัส/ชื่อได้ · ถ้าอยาก "เฉพาะตัวเอง" อัตโนมัติใช้ Power Apps)
 *
 *   parameter: dayTab = ชื่อแท็บวัน (เว้นว่าง = แท็บวันแรก)
 * ใช้: เปิด PAS_2026-10 ใน Excel Online → Automate → New Script → วาง → Run
 */
function main(workbook: ExcelScript.Workbook, dayTab: string = ""): void {
  const ROYAL = "#1D428A", RED = "#fdecec";
  // เลือกแท็บวัน
  let ws = dayTab ? workbook.getWorksheet(dayTab) : null;
  if (!ws) ws = workbook.getWorksheets().filter(w => /^\d{2}[A-Z]{3}$/.test(w.getName()))[0] || null;
  if (!ws) { console.log("ไม่พบแท็บวัน"); return; }
  const vals = ws.getUsedRange().getValues();
  const dname = ws.getName();

  // ---- Flight Coverage (จาก PAS_FlightSLA) ----
  const fs = section(vals, "PAS_FlightSLA");
  const cov = fresh(workbook, "Flight Coverage"); cov.activate();
  bold(cov.getRange("A1"), "ไฟลท์ + Coverage (ครบ-ขาด) · " + dname, 16, ROYAL);
  const H1 = ["ไฟลท์", "สายการบิน", "A/C", "STA", "STD", "ต้องการ", "จัดได้", "ขาด", "สถานะ", "รายชื่อ/หมายเหตุ"];
  cov.getRangeByIndexes(2, 0, 1, H1.length).setValues([H1]); headerFmt(cov.getRangeByIndexes(2, 0, 1, H1.length), ROYAL);
  const C = col(fs.header);
  const body1 = fs.rows.map(r => [
    str(r[C.flight]), str(r[C.airline]), str(r[C.ac]), str(r[C.sta]), str(r[C.std]),
    n(r[C.req_total]), n(r[C.as_total]), n(r[C.short_total]),
    (n(r[C.short_total]) > 0 ? "⚠️ ขาด " + n(r[C.short_total]) : "✅ ครบ"),
    str(r[C.short_text]) || str(r[C.staff_text])
  ]);
  if (body1.length) {
    cov.getRangeByIndexes(3, 0, body1.length, H1.length).setValues(body1);
    // ไฮไลต์แถวที่ขาด
    for (let i = 0; i < body1.length; i++) if ((body1[i][7] as number) > 0) cov.getRangeByIndexes(3 + i, 0, 1, H1.length).getFormat().getFill().setColor(RED);
  }
  const short = body1.filter(x => (x[7] as number) > 0).length;
  bold(cov.getRange("A2"), "ไฟลท์ทั้งหมด " + body1.length + " · ขาดคน " + short + " ไฟลท์", 11, short ? "#b02a2a" : "#1c7a4f");
  cov.getUsedRange().getFormat().autofitColumns();

  // ---- By Person (จาก PAS_Duty + PAS_Assignment) ----
  const du = section(vals, "PAS_Duty"), ag = section(vals, "PAS_Assignment");
  const D = col(du.header), A = col(ag.header);
  const jobs: { [code: string]: string[] } = {};
  for (const r of ag.rows) {
    const code = str(r[A.emp_code]); if (!code) continue;
    const fl = str(r[A.Title] !== undefined ? r[0] : "");   // Title = flight code (คอลัมน์ 0)
    const label = (fl || "") + (str(r[A.task]) ? " " + str(r[A.task]) : "");
    (jobs[code] = jobs[code] || []).push(label.trim());
  }
  const per = fresh(workbook, "By Person");
  bold(per.getRange("A1"), "งานรายคน (กรองด้วยรหัส/ชื่อได้) · " + dname, 16, ROYAL);
  const H2 = ["รหัส", "ชื่อ", "ทีม", "กะ", "Util%", "จำนวนงาน", "ไฟลท์/งานที่รับ"];
  per.getRangeByIndexes(2, 0, 1, H2.length).setValues([H2]); headerFmt(per.getRangeByIndexes(2, 0, 1, H2.length), ROYAL);
  const body2 = du.rows
    .filter(r => str(r[D.bucket]).toUpperCase().indexOf("WORK") >= 0 || str(r[D.bucket]).toUpperCase().indexOf("OT_OFF") >= 0)
    .map(r => {
      const code = str(r[D.emp_code]); const js = jobs[code] || [];
      return [code, str(r[D.emp_name]), str(r[D.team]), str(r[D.shift_code]), n(r[D.util_pct]), js.length, js.join(" · ")];
    });
  if (body2.length) per.getRangeByIndexes(3, 0, body2.length, H2.length).setValues(body2);
  // เปิด AutoFilter ให้กรองได้
  per.getRangeByIndexes(2, 0, body2.length + 1, H2.length).getFormat().autofitColumns();
  try { per.getAutoFilter().apply(per.getRangeByIndexes(2, 0, body2.length + 1, H2.length)); } catch (e) { }

  console.log("Coverage: " + body1.length + " ไฟลท์ (ขาด " + short + ") · By Person: " + body2.length + " คน");
}

// ---- helpers ----
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
function fresh(wb: ExcelScript.Workbook, name: string): ExcelScript.Worksheet { const o = wb.getWorksheet(name); if (o) o.delete(); return wb.addWorksheet(name); }
function bold(rg: ExcelScript.Range, t: string, size: number, color: string) { rg.setValue(t); rg.getFormat().getFont().setSize(size); rg.getFormat().getFont().setBold(true); rg.getFormat().getFont().setColor(color); }
function headerFmt(rg: ExcelScript.Range, color: string) { rg.getFormat().getFill().setColor(color); rg.getFormat().getFont().setColor("#FFFFFF"); rg.getFormat().getFont().setBold(true); }
