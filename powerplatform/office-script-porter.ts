/*
 * office-script-porter.ts — Office Script (Excel Online) · ไฟล์ Porter Summary
 *   อ่านแท็บรายวัน (01OCT26…) → สร้างชีต "Porter Dashboard":
 *     - KPI: เคสรวมเดือน / COMPLETED / เฉลี่ยเวลาดำเนินการ / เคสเกินเกณฑ์ SLA
 *     - ตารางรายวัน: เคส/COMPLETED/แยกชนิด(WCHR/WCHS/WCHC/MAAS/AVIH/ETC)/เฉลี่ยเวลา/เกินเกณฑ์
 *     - แยกสายการบิน + กราฟเคสรายวัน
 *
 *   คอลัมน์แท็บรายวัน (0-based): 1=seq 2=airline 3=flight 4=staff 6=STATUS
 *     14=ได้รับแจ้ง 15=รับเคส 16=เสร็จเคส 17=service 21=เวลาดำเนินการ(SLA, นาที)
 *   เคสจริง = แถวที่ airline(2) ไม่ว่าง
 *
 *   parameter: slaMin = เกณฑ์ SLA (นาที) · เคสที่ col21 > slaMin นับว่า "เกิน"
 * ใช้: Excel Online (ไฟล์ Porter) → Automate → New Script → วาง → Run
 */
function main(workbook: ExcelScript.Workbook, slaMin: number = 15): number {
  const ROYAL = "#1D428A";
  const SVC = ["WCHR", "WCHS", "WCHC", "MAAS", "AVIH", "ETC"];
  const isDay = (s: string) => /^\d{2}[A-Z]{3}\d{2}$/.test(s);

  type Day = { date: string; cases: number; done: number; svc: { [k: string]: number }; durSum: number; durN: number; over: number; };
  const days: Day[] = [];
  const byAir: { [k: string]: number } = {};
  let totCases = 0, totDone = 0, durSum = 0, durN = 0, totOver = 0;

  for (const ws of workbook.getWorksheets()) {
    const nm = ws.getName();
    if (!isDay(nm)) continue;
    const g = ws.getRange("A1:AD250").getValues();
    const d: Day = { date: nm, cases: 0, done: 0, svc: {}, durSum: 0, durN: 0, over: 0 };
    for (const r of g) {
      const air = String(r[2] || "").trim();
      if (!air || !r[3]) continue;                       // เคสจริง = มีสายการบิน + ไฟลท์
      d.cases++; totCases++;
      byAir[air] = (byAir[air] || 0) + 1;
      if (String(r[6] || "").toUpperCase().indexOf("COMPLET") >= 0) { d.done++; totDone++; }
      let s = String(r[17] || "").toUpperCase().trim(); if (SVC.indexOf(s) < 0) s = "ETC";
      d.svc[s] = (d.svc[s] || 0) + 1;
      const dur = t2m(r[21]);                             // เวลาดำเนินการ (นาที)
      if (dur != null && dur > 0) { d.durSum += dur; d.durN++; durSum += dur; durN++; if (dur > slaMin) { d.over++; totOver++; } }
    }
    if (d.cases > 0) days.push(d);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  // ---- สร้าง Porter Dashboard ----
  const old = workbook.getWorksheet("Porter Dashboard"); if (old) old.delete();
  const dsh = workbook.addWorksheet("Porter Dashboard"); dsh.activate();
  bold(dsh.getRange("A1"), "PAS · Porter Dashboard", 18, ROYAL);

  const avgDur = durN ? Math.round(durSum / durN) : 0;
  dsh.getRange("A3:E3").setValues([["เคสรวม", "COMPLETED", "เฉลี่ยเวลา (นาที)", "เกินเกณฑ์ (>" + slaMin + "น.)", "วันมีข้อมูล"]]);
  dsh.getRange("A4:E4").setValues([[totCases, totDone, avgDur, totOver, days.length]]);
  dsh.getRange("A3:E3").getFormat().getFont().setBold(true);
  dsh.getRange("A4:E4").getFormat().getFont().setColor(ROYAL); dsh.getRange("A4:E4").getFormat().getFont().setSize(14);

  // ตารางรายวัน
  const hr = 6;
  const head = ["วันที่", "เคส", "COMPLETED"].concat(SVC).concat(["เฉลี่ยเวลา", "เกิน SLA"]);
  dsh.getRange(1, 1).getCell(0, 0); // noop
  const hRange = dsh.getRangeByIndexes(hr - 1, 0, 1, head.length);
  hRange.setValues([head]); headerFmt(hRange, ROYAL);
  const body = days.map(d => ([d.date, d.cases, d.done] as (string | number)[])
    .concat(SVC.map(s => d.svc[s] || 0))
    .concat([d.durN ? Math.round(d.durSum / d.durN) : 0, d.over]));
  if (body.length) dsh.getRangeByIndexes(hr, 0, body.length, head.length).setValues(body);

  // แยกสายการบิน
  const airRows = Object.keys(byAir).map(a => [a, byAir[a]] as (string | number)[]).sort((a, b) => (b[1] as number) - (a[1] as number));
  const ac = head.length + 2;
  dsh.getRangeByIndexes(hr - 1, ac, 1, 2).setValues([["สายการบิน", "เคส"]]);
  headerFmt(dsh.getRangeByIndexes(hr - 1, ac, 1, 2), ROYAL);
  if (airRows.length) dsh.getRangeByIndexes(hr, ac, airRows.length, 2).setValues(airRows);

  // กราฟเคสรายวัน
  const chart = dsh.addChart(ExcelScript.ChartType.columnClustered, dsh.getRangeByIndexes(hr - 1, 0, body.length + 1, 2));
  chart.setPosition(dsh.getRangeByIndexes(hr + body.length + 1, 0), dsh.getRangeByIndexes(hr + body.length + 16, 8));
  chart.getTitle().setText("เคส Porter รายวัน");

  dsh.getUsedRange().getFormat().autofitColumns();
  console.log("Porter: " + totCases + " เคส · " + days.length + " วัน · เฉลี่ย " + avgDur + " นาที · เกินเกณฑ์ " + totOver);
  return totCases;
}

function t2m(v: (string | number | boolean)): number | null {
  if (typeof v === "number") return Math.round((v - Math.floor(v)) * 1440);
  const m = String(v || "").match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function bold(rg: ExcelScript.Range, text: string, size: number, color: string) { rg.setValue(text); rg.getFormat().getFont().setSize(size); rg.getFormat().getFont().setBold(true); rg.getFormat().getFont().setColor(color); }
function headerFmt(rg: ExcelScript.Range, color: string) { rg.getFormat().getFill().setColor(color); rg.getFormat().getFont().setColor("#FFFFFF"); rg.getFormat().getFont().setBold(true); }
