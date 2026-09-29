/*
 * office-script-dashboard.ts — Office Script (Excel Online) สำหรับไฟล์เวร PAS
 *   1) แก้สูตรที่พังจากการแปลง Google→Excel:
 *        - MANPOWER!K (OT รวม): SUMPRODUCT+IF  →  SUM  (แก้ #VALUE!)
 *        - ลบ "_xludf." ในทุกสูตร (แก้ #NAME? จาก TEXTJOIN)
 *   2) สร้างชีต "Dashboard": KPI + สรุปกำลังพลรายทีม + กราฟ (โทน AOTGA)
 *
 * ใช้: Excel Online → แท็บ Automate → New Script → วางโค้ดนี้ → Run
 *      (หรือให้ Power Automate เรียก script นี้อัตโนมัติ)
 */
function main(workbook: ExcelScript.Workbook) {
  const ROYAL = "#1D428A";
  const sheets = workbook.getWorksheets();

  // ---------- 1a) ลบ _xludf. ในทุกสูตร ----------
  for (const ws of sheets) {
    const used = ws.getUsedRange();
    if (!used) continue;
    const formulas = used.getFormulas();
    let changed = false;
    for (let r = 0; r < formulas.length; r++) {
      for (let c = 0; c < formulas[r].length; c++) {
        const f = formulas[r][c];
        if (typeof f === "string" && f.indexOf("_xludf.") >= 0) { formulas[r][c] = f.split("_xludf.").join(""); changed = true; }
      }
    }
    if (changed) used.setFormulas(formulas);
  }

  // ---------- 1b) MANPOWER!K : SUMPRODUCT+IF → SUM ----------
  const mp = workbook.getWorksheet("MANPOWER");
  if (mp) {
    for (let row = 4; row <= 21; row++) {
      const cell = mp.getRange("K" + row);
      const f = cell.getFormula();
      if (typeof f === "string" && f.indexOf("SUMPRODUCT") >= 0) {
        const rngs = f.match(/SUMPRODUCT\(\(([^<]+?)<>""\)/g) || [];
        const parts: string[] = [];
        for (const m of rngs) { const mm = m.match(/SUMPRODUCT\(\(([^<]+?)<>""\)/); if (mm) parts.push("SUM(" + mm[1].trim() + ")"); }
        if (parts.length) cell.setFormula("=" + parts.join("+"));
      }
    }
    workbook.getApplication().calculate(ExcelScript.CalculationType.full);
  }

  // ---------- 2) อ่าน MANPOWER → สร้าง Dashboard ----------
  if (!mp) return;
  const mv = mp.getUsedRange().getValues();
  // แถวทีม = คอลัมน์แรกขึ้นต้น "Team ("
  type T = { team: string; total: number; working: number; sick: number; annual: number; training: number; ot: number };
  const rows: T[] = [];
  const num = (v: (string | number | boolean)): number => (typeof v === "number" ? v : 0);
  for (const r of mv) {
    const a = String(r[0] || "");
    const m = a.match(/Team\s*\((.+?)\)/);
    if (!m) continue;
    const code = m[1].trim();
    rows.push({ team: code, total: num(r[1]), working: num(r[9]), sick: num(r[3]), annual: num(r[5]), training: num(r[8]), ot: teamOT(workbook, code) });
  }

  const sumWork = rows.reduce((s, x) => s + x.working, 0);
  const sumOT = Math.round(rows.reduce((s, x) => s + x.ot, 0) * 10) / 10;

  // สร้าง/ล้างชีต Dashboard
  const old = workbook.getWorksheet("Dashboard"); if (old) old.delete();
  const d = workbook.addWorksheet("Dashboard"); d.activate();

  d.getRange("A1").setValue("PAS · สรุปกำลังพลประจำวัน");
  d.getRange("A1").getFormat().getFont().setSize(18); d.getRange("A1").getFormat().getFont().setBold(true);
  d.getRange("A1").getFormat().getFont().setColor(ROYAL);

  // KPI
  const kpis: (string | number)[][] = [["คนทำงานรวม", sumWork], ["ทีม", rows.length], ["OT รวม (ชม.)", sumOT]];
  d.getRange("A3:B5").setValues(kpis);
  d.getRange("A3:A5").getFormat().getFont().setBold(true);
  d.getRange("B3:B5").getFormat().getFont().setColor(ROYAL); d.getRange("B3:B5").getFormat().getFont().setSize(14);

  // ตารางรายทีม
  const header = ["ทีม", "ทั้งหมด", "ทำงานจริง", "ลาป่วย", "พักร้อน", "อบรม", "OT (ชม.)"];
  const body = rows.map(x => [x.team, x.total, x.working, x.sick, x.annual, x.training, x.ot]);
  const startRow = 7;
  d.getRange("A" + startRow + ":G" + startRow).setValues([header]);
  d.getRange("A" + startRow + ":G" + startRow).getFormat().getFill().setColor(ROYAL);
  d.getRange("A" + startRow + ":G" + startRow).getFormat().getFont().setColor("#FFFFFF");
  d.getRange("A" + startRow + ":G" + startRow).getFormat().getFont().setBold(true);
  const dataRange = d.getRange("A" + (startRow + 1) + ":G" + (startRow + body.length));
  dataRange.setValues(body);

  // กราฟ คนทำงานรายทีม
  const chartData = d.getRange("A" + startRow + ":C" + (startRow + body.length));
  const chart = d.addChart(ExcelScript.ChartType.columnClustered, chartData);
  chart.setPosition(d.getRange("I3"), d.getRange("R20"));
  chart.getTitle().setText("กำลังคนรายทีม");

  d.getRange("A1:R" + (startRow + body.length + 2)).getFormat().autofitColumns();
}

// รวม OT ของทีม = ผลรวมคอลัมน์ M + P (ตัวเลข) ในชีตทีมนั้น (เลี่ยงสูตร K ที่เคยพัง)
function teamOT(workbook: ExcelScript.Workbook, code: string): number {
  const ws = workbook.getWorksheet(code);
  if (!ws) return 0;
  const used = ws.getUsedRange(); if (!used) return 0;
  const vals = used.getValues();
  let sum = 0;
  for (const r of vals) {
    const mm = r[12]; const pp = r[15];        // M (index12), P (index15)
    if (typeof mm === "number") sum += mm;
    if (typeof pp === "number") sum += pp;
  }
  return Math.round(sum * 10) / 10;
}
