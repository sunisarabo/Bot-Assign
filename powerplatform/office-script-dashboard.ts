/*
 * office-script-dashboard.ts — Office Script (Excel Online) · ไฟล์เวร PAS
 *   1) แก้สูตรพังจาก Google→Excel:  _xludf. (→#NAME?) และ MANPOWER!K SUMPRODUCT→SUM (→#VALUE!)
 *   2) สร้างชีต "Dashboard": KPI + รายทีม(+Util%) + กราฟกำลังคนรายชั่วโมง (อยู่เวร/ติดงาน)
 *
 *   คอลัมน์แท็บทีม (0-based): 0=ID 2=NAME 3=SHIFT 4=IN(เริ่มกะ) 6=ชม. 16=STATUS 17=REMARK
 *     ไฟลท์เริ่มคอลัมน์ 19 (T) ทีละ 4 คอลัมน์ · หัวไฟลท์อยู่แถวที่คอลัมน์ 18(S)= "FLIGHT"/"STA / STD"/"OP / CL"
 *   Porter/Pre-WC อยู่คนละไฟล์ → ต่อภายหลังผ่าน Power Automate
 *
 * ใช้: Excel Online → Automate → New Script → วาง → Run
 */
const ROYAL = "#1D428A";
const DEP_LEAD = 60, ARR_TAIL = 45, DEF_JOB = 45, HN = 24;

function main(workbook: ExcelScript.Workbook) {
  fixFormulas(workbook);
  const mp = workbook.getWorksheet("MANPOWER");
  if (!mp) return;

  // ---- อ่าน MANPOWER (สรุปรายทีม) ----
  const mv = mp.getUsedRange().getValues();
  const teams: { team: string; total: number; working: number; sick: number; annual: number; training: number; ot: number }[] = [];
  for (const r of mv) {
    const m = String(r[0] || "").match(/Team\s*\((.+?)\)/);
    if (!m) continue;
    const code = m[1].trim();
    teams.push({ team: code, total: n(r[1]), working: n(r[9]), sick: n(r[3]), annual: n(r[5]), training: n(r[8]), ot: teamOT(workbook, code) });
  }

  // ---- parse แท็บทีม → Util + รายชั่วโมง ----
  const hOnDuty = new Array<number>(HN).fill(0), hOnFlight = new Array<number>(HN).fill(0);
  let sumUtil = 0, nUtil = 0, working = 0;
  const teamUtil: { [k: string]: { s: number; n: number } } = {};
  const people: { name: string; team: string; util: number }[] = [];

  for (const t of teams) {
    const ws = workbook.getWorksheet(t.team);
    if (!ws) continue;
    const g = ws.getRange("A1:AQ200").getValues();
    // หาแถวหัวไฟลท์
    const fRow = findByS(g, "FLIGHT"), sRow = findByS(g, "STA"), oRow = findByS(g, "OP");
    const flights: { base: number; STA: string; STD: string; OP: string; CL: string; code: string }[] = [];
    if (fRow >= 0) for (let b = 19; b < 43; b += 4) {
      const code = String(g[fRow][b] || "").trim();
      if (!code || !/\d|BRE?IF|GOM/.test(code)) continue;
      flights.push({ base: b, code, STA: pick(sRow >= 0 ? g[sRow][b] : ""), STD: pick(sRow >= 0 ? g[sRow][b + 2] : ""), OP: pick(oRow >= 0 ? g[oRow][b] : ""), CL: pick(oRow >= 0 ? g[oRow][b + 2] : "") });
    }
    for (const row of g) {
      const id = row[0]; const name = String(row[2] || "").trim();
      if (typeof id !== "number" || !name || name.indexOf("Ex.") === 0) continue;
      const bucket = bucketOf(String(row[16] || ""), String(row[17] || ""));
      if (bucket !== "working") continue;
      working++;
      let ds = t2m(row[4]); const hrs = n(row[6]);
      let de = (ds != null && hrs) ? ds + Math.round(hrs * 60) : null;
      if (ds != null && de != null && de <= ds) de += 1440;
      const dutyMin = (ds != null && de != null) ? de - ds : 0;
      const iv: number[][] = [];
      for (const f of flights) {
        let has = false;
        for (let k = 0; k < 4; k++) { if (String(row[f.base + k] || "").trim() !== "") { has = true; break; } }
        if (!has) continue;
        const w = winOf(f); if (w) iv.push(w);
      }
      const clamped = dutyMin > 0 ? clampIv(iv, ds as number, de as number) : iv;
      const busy = mergeMin(clamped);
      const util = dutyMin > 0 ? Math.min(100, Math.round(busy / dutyMin * 100)) : 0;
      if (dutyMin > 0) { sumUtil += util; nUtil++; (teamUtil[t.team] = teamUtil[t.team] || { s: 0, n: 0 }); teamUtil[t.team].s += util; teamUtil[t.team].n++; }
      people.push({ name, team: t.team, util });
      if (dutyMin > 0) for (let h = 0; h < HN; h++) { const a = h * 60; if (ovD(ds as number, de as number, a, a + 60)) hOnDuty[h]++; }
      for (const seg of clamped) for (let h = 0; h < HN; h++) { const a = h * 60; if (ov(seg[0], seg[1], a, a + 60) || ov(seg[0], seg[1], a + 1440, a + 1500)) { hOnFlight[h]++; break; } }
    }
  }

  const avgUtil = nUtil ? Math.round(sumUtil / nUtil) : 0;
  const sumWork = teams.reduce((s, x) => s + x.working, 0);
  const sumOT = Math.round(teams.reduce((s, x) => s + x.ot, 0) * 10) / 10;
  const peakDuty = Math.max(0, ...hOnDuty), peakFlt = Math.max(0, ...hOnFlight);

  // ---- สร้าง Dashboard ----
  const old = workbook.getWorksheet("Dashboard"); if (old) old.delete();
  const d = workbook.addWorksheet("Dashboard"); d.activate();
  title(d, "A1", "PAS · สรุปกำลังพลประจำวัน", 18);

  d.getRange("A3:F3").setValues([["คนทำงานรวม", "ทีม", "OT รวม (ชม.)", "Util เฉลี่ย", "พีคอยู่เวร", "พีคติดงาน"]]);
  d.getRange("A4:F4").setValues([[sumWork, teams.length, sumOT, avgUtil + "%", peakDuty, peakFlt]]);
  d.getRange("A3:F3").getFormat().getFont().setBold(true);
  d.getRange("A4:F4").getFormat().getFont().setColor(ROYAL); d.getRange("A4:F4").getFormat().getFont().setSize(14);

  // ตารางรายทีม (+Util)
  const hr = 6;
  d.getRange("A" + hr + ":H" + hr).setValues([["ทีม", "ทั้งหมด", "ทำงานจริง", "ลาป่วย", "พักร้อน", "อบรม", "OT (ชม.)", "Util %"]]);
  headerFmt(d.getRange("A" + hr + ":H" + hr));
  const body = teams.map(x => [x.team, x.total, x.working, x.sick, x.annual, x.training, x.ot, (teamUtil[x.team] && teamUtil[x.team].n ? Math.round(teamUtil[x.team].s / teamUtil[x.team].n) : 0)]);
  d.getRange("A" + (hr + 1) + ":H" + (hr + body.length)).setValues(body);

  // ตารางรายชั่วโมง + กราฟ
  const hb = hr + body.length + 2;
  d.getRange("A" + hb).setValue("รายชั่วโมง"); d.getRange("A" + hb).getFormat().getFont().setBold(true);
  const hh = hb + 1;
  d.getRange("A" + hh + ":C" + hh).setValues([["ชม.", "อยู่เวร", "ติดงาน"]]);
  headerFmt(d.getRange("A" + hh + ":C" + hh));
  const hrows: (string | number)[][] = [];
  for (let h = 0; h < HN; h++) hrows.push([h, hOnDuty[h], hOnFlight[h]]);
  d.getRange("A" + (hh + 1) + ":C" + (hh + HN)).setValues(hrows);
  const chart = d.addChart(ExcelScript.ChartType.columnClustered, d.getRange("A" + hh + ":C" + (hh + HN)));
  chart.setPosition(d.getRange("E" + hh), d.getRange("N" + (hh + HN)));
  chart.getTitle().setText("กำลังคนรายชั่วโมง (อยู่เวร vs ติดงาน)");

  d.getRange("A1:H" + (hh + HN)).getFormat().autofitColumns();
}

// ---------- helpers ----------
function n(v: (string | number | boolean)): number { return typeof v === "number" ? v : 0; }
function pick(v: (string | number | boolean)): string { const m = String(v || "").match(/(\d{1,2})[:.](\d{2})/); return m ? m[1] + ":" + m[2] : ""; }
function t2m(v: (string | number | boolean)): number | null {
  if (typeof v === "number") return Math.round((v - Math.floor(v)) * 1440);   // Excel serial (เศษวัน)
  const m = String(v || "").match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function bucketOf(status: string, remark: string): string {
  const s = status.toUpperCase(), r = remark.toUpperCase(), txt = r || s;
  if (txt.indexOf("SICK") >= 0 || txt === "SL" || txt === "MC") return "off";
  if (txt.indexOf("VAC") >= 0 || ["AL", "BL", "VL", "ML", "PL"].indexOf(txt) >= 0) return "off";
  if (txt.indexOf("OFF") === 0 || txt === "X") return "off";
  return "working";
}
function findByS(g: (string | number | boolean)[][], label: string): number {
  for (let i = 0; i < g.length; i++) { const s = String(g[i][18] || "").toUpperCase(); if (s.indexOf(label) === 0) return i; }
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
function mergeMin(iv: number[][]): number { if (!iv.length) return 0; iv = iv.slice().sort((a, b) => a[0] - b[0]); let tot = 0, lo = iv[0][0], hi = iv[0][1]; for (let i = 1; i < iv.length; i++) { if (iv[i][0] <= hi) hi = Math.max(hi, iv[i][1]); else { tot += hi - lo; lo = iv[i][0]; hi = iv[i][1]; } } return tot + (hi - lo); }
function clampIv(iv: number[][], lo: number, hi: number): number[][] { const o: number[][] = []; for (const s of iv) { const a = Math.max(s[0], lo), b = Math.min(s[1], hi); if (b > a) o.push([a, b]); } return o; }
function ov(lo: number, hi: number, a: number, b: number): boolean { return Math.min(hi, b) > Math.max(lo, a); }
function ovD(ds: number, de: number, a: number, b: number): boolean { return ov(ds, de, a, b) || ov(ds, de, a + 1440, b + 1440); }
function teamOT(workbook: ExcelScript.Workbook, code: string): number {
  const ws = workbook.getWorksheet(code); if (!ws) return 0;
  const g = ws.getRange("A1:P200").getValues(); let sum = 0;
  for (const r of g) { if (typeof r[12] === "number") sum += r[12]; if (typeof r[15] === "number") sum += r[15]; }
  return Math.round(sum * 10) / 10;
}
function title(d: ExcelScript.Worksheet, cell: string, text: string, size: number) {
  const rg = d.getRange(cell); rg.setValue(text); rg.getFormat().getFont().setSize(size); rg.getFormat().getFont().setBold(true); rg.getFormat().getFont().setColor(ROYAL);
}
function headerFmt(rg: ExcelScript.Range) { rg.getFormat().getFill().setColor(ROYAL); rg.getFormat().getFont().setColor("#FFFFFF"); rg.getFormat().getFont().setBold(true); }
function fixFormulas(workbook: ExcelScript.Workbook) {
  for (const ws of workbook.getWorksheets()) {
    const used = ws.getUsedRange(); if (!used) continue;
    const f = used.getFormulas(); let ch = false;
    for (let r = 0; r < f.length; r++) for (let c = 0; c < f[r].length; c++) { const x = f[r][c]; if (typeof x === "string" && x.indexOf("_xludf.") >= 0) { f[r][c] = x.split("_xludf.").join(""); ch = true; } }
    if (ch) used.setFormulas(f);
  }
  const mp = workbook.getWorksheet("MANPOWER"); if (!mp) return;
  for (let row = 4; row <= 21; row++) {
    const cell = mp.getRange("K" + row); const f = cell.getFormula();
    if (typeof f === "string" && f.indexOf("SUMPRODUCT") >= 0) {
      const rngs = f.match(/SUMPRODUCT\(\(([^<]+?)<>""\)/g) || []; const parts: string[] = [];
      for (const m of rngs) { const mm = m.match(/SUMPRODUCT\(\(([^<]+?)<>""\)/); if (mm) parts.push("SUM(" + mm[1].trim() + ")"); }
      if (parts.length) cell.setFormula("=" + parts.join("+"));
    }
  }
  workbook.getApplication().calculate(ExcelScript.CalculationType.full);
}
