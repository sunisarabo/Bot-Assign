/*
 * check-formulas.ts — Office Script: ตรวจ + ซ่อมสูตรในไฟล์ daily assignment (ไฟล์เวรรายวัน) ทีละแท็บทีม
 *
 * ตรวจ 3 อย่าง
 *  1) ตารางพนักงาน (แถวที่มีชื่อ): คอลัมน์ที่ควรเป็นสูตร (เวลาเข้า/ออก/ชม.จาก ShiftDB · ชม. RE-SKED/OT ก่อน/หลังกะ · "ไปซัพ") —
 *     สูตรที่ถูก = สูตรที่แถวส่วนใหญ่ของแท็บนั้นใช้ (ถ้าแท็บพังทั้งคอลัมน์ ใช้สูตรที่แท็บอื่นส่วนใหญ่ใช้ เฉพาะสูตรที่ไม่ผูกชื่อทีม)
 *       · สูตรหาย (ช่องว่าง) / ค่า error (#REF! #VALUE! #N/A …)  → ใส่สูตรคืน
 *       · พิมพ์ค่าทับสูตร → ลองใส่สูตร: ได้ค่าเดิม = เก็บสูตร · ได้ค่าต่าง = คืนค่าที่พิมพ์ (ไม่ทำข้อมูลหาย) แล้วรายงานให้ตรวจ
 *       · สูตรถูกแก้ไม่เหมือนแถวอื่น → รายงาน (โหมด fix: แก้ให้เหมือนแถวอื่นเฉพาะเมื่อผลลัพธ์เท่าเดิม)
 *  2) ตารางสรุปไฟลท์ (หมายเลขไฟลท์ 1–40 ใต้ตาราง): มี #REF! (มักเกิดจากลบคอลัมน์ไฟลท์) → สร้างสูตรทั้งบล็อกใหม่ตามตำแหน่งคอลัมน์
 *  3) ค่า error ที่อื่นในแท็บ → รายงานตำแหน่ง
 *
 * พารามิเตอร์: mode = "check" (ตรวจอย่างเดียว · ค่าเริ่มต้น) หรือ "fix" (ตรวจ + ซ่อม)
 * ผล: แท็บ "ตรวจสูตร" ในไฟล์ (สร้างใหม่ทุกครั้ง) + คืน { mode, issues, fixed, review, tabs }
 * ตัวนำเข้า PAS ข้ามแท็บ "ตรวจสูตร" อยู่แล้ว
 */
const CF_SKIP = ["MANPOWER", "ROSTER", "SUMMARY", "SHIFTDB", "CODE", "SUPPORT REQUEST", "URGENT", "แม่แบบ", "MASTER", "สรุป", "ตรวจสูตร", "SHEET"];
const CF_REPORT = "ตรวจสูตร";
type CCell = string | number | boolean;
interface CfIssue { tab: string; cell: string; kind: string; before: string; after: string; status: string }
interface CfTab { name: string; ws: ExcelScript.Worksheet; hr: number; nameCol: number; rows: number[]; nCols: number;
  f: string[][]; t: string[][]; r0: number }

function main(workbook: ExcelScript.Workbook, mode?: string) {
  const fix = String(mode || "").trim().toLowerCase() === "fix";
  const issues: CfIssue[] = [];
  const tabs: CfTab[] = [];
  for (const ws of workbook.getWorksheets()) {
    const nm = ws.getName(), nU = nm.trim().toUpperCase();
    if (CF_SKIP.some(k => nU.indexOf(k) >= 0)) continue;
    const t = cfReadTab(ws); if (t) tabs.push(t);
  }
  // สูตรมาตรฐานของคอลัมน์ (ทุกแท็บ) — ใช้เมื่อแท็บพังทั้งคอลัมน์ และสูตรไม่ผูกชื่อทีม
  const glob = cfGlobalFormulas(tabs);
  for (const t of tabs) {
    cfCheckPeople(t, glob, fix, issues);
    cfCheckSummary(t, fix, issues);
    cfCheckErrors(t, issues);
  }
  cfWriteReport(workbook, issues, fix);
  return { mode: fix ? "fix" : "check", issues: issues.length, fixed: issues.filter(x => x.status === "แก้แล้ว").length,
    review: issues.filter(x => x.status === "ต้องตรวจเอง").length, tabs: tabs.length };
}

// ---------- อ่านแท็บ ----------
function cfReadTab(ws: ExcelScript.Worksheet): CfTab | null {
  const u = ws.getUsedRange(true); if (!u) return null;
  const nR = u.getRowIndex() + u.getRowCount(), nC = Math.min(26, u.getColumnIndex() + u.getColumnCount());   // A–Z พอสำหรับคอลัมน์สูตรของตารางพนักงาน
  if (nR < 4) return null;
  const R = Math.min(nR, 400);
  const rng = ws.getRangeByIndexes(0, 0, R, nC);
  const f = rng.getFormulasR1C1().map(r => r.map(x => String(x == null ? "" : x)));
  const t = rng.getTexts();
  let hr = -1, nameCol = -1;
  for (let r = 0; r < Math.min(12, R) && hr < 0; r++) {
    const up = t[r].map(x => String(x).trim().toUpperCase());
    const ni = up.indexOf("NAME");
    if (ni >= 0 && (up.indexOf("ID") >= 0 || up.indexOf("NO") >= 0 || up.indexOf("NO.") >= 0)) { hr = r; nameCol = ni; }
  }
  if (hr < 0) return null;
  const rows: number[] = [];
  for (let r = hr + 1; r < R; r++) {
    const a = String(t[r][0] || "").trim();
    if (/จำนวนคนที่ลงจ็อบ|^SUPPORT\b|^NO\.?$/i.test(a)) break;          // จบตารางพนักงาน
    const name = String(t[r][nameCol] || "").trim();
    if (!name || /^NAME$/i.test(name) || /^[ADOC]\s*:/i.test(name)) continue;
    if (!/^[A-Za-zก-๛(]/.test(name)) continue;                   // ไม่ใช่ชื่อคน (#REF! / เวลา / ตัวเลข)
    rows.push(r);
  }
  return { name: ws.getName(), ws, hr, nameCol, rows, nCols: nC, f, t, r0: 0 };
}
function cfIsFormula(s: string): boolean { return s.charAt(0) === "="; }
function cfIsErr(s: string): boolean { return /^#(REF!|VALUE!|N\/A|NAME\?|DIV\/0!|NUM!|NULL!|SPILL!|CALC!)/.test(String(s || "").trim()); }
function cfA1(r: number, c: number): string {
  let s = "", x = c + 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s + (r + 1);
}
function cfMajor(t: CfTab, c: number): { f: string; n: number } {
  const cnt: { [f: string]: number } = {};
  for (const r of t.rows) { const x = t.f[r][c]; if (cfIsFormula(x) && x.indexOf("#REF!") < 0) cnt[x] = (cnt[x] || 0) + 1; }
  let best = "", bn = 0; for (const k of Object.keys(cnt)) if (cnt[k] > bn) { bn = cnt[k]; best = k; }
  return { f: best, n: bn };
}
function cfGlobalFormulas(tabs: CfTab[]): { [c: number]: string } {
  const out: { [c: number]: string } = {};
  for (let c = 0; c < 26; c++) {
    const per: { [f: string]: number } = {}; let nt = 0;
    for (const t of tabs) { if (c >= t.nCols) continue; const m = cfMajor(t, c); if (m.n >= 3) { per[m.f] = (per[m.f] || 0) + 1; nt++; } }
    let best = "", bn = 0; for (const k of Object.keys(per)) if (per[k] > bn) { bn = per[k]; best = k; }
    const B = best.toUpperCase();
    if (best && bn >= Math.max(3, Math.ceil(nt * 0.6)) && !tabs.some(t => B.indexOf("\"" + t.name.trim().toUpperCase()) >= 0)) out[c] = best;   // สูตรกลาง ไม่ผูกชื่อทีม
  }
  return out;
}

// ---------- 1) ตารางพนักงาน ----------
function cfCheckPeople(t: CfTab, glob: { [c: number]: string }, fix: boolean, issues: CfIssue[]) {
  if (!t.rows.length) return;
  for (let c = 0; c < t.nCols; c++) {
    if (c === t.nameCol) continue;
    const m = cfMajor(t, c);
    let gold = "";
    if (m.n >= Math.max(3, Math.ceil(t.rows.length * 0.5))) gold = m.f;          // แท็บนี้ส่วนใหญ่ใช้สูตรนี้
    else if (glob[c] && m.n <= 1) gold = glob[c];                            // แท็บพังทั้งคอลัมน์ → สูตรกลาง
    if (!gold) continue;
    for (const r of t.rows) {
      const cur = t.f[r][c], txt = String(t.t[r][c] || "");
      if (cur === gold) continue;
      const cell = cfA1(r, c);
      if (cfIsErr(txt) || cur.indexOf("#REF!") >= 0 || cur === "") {
        const kind = cur === "" ? "สูตรหาย (ช่องว่าง)" : "ค่า error " + txt;
        if (fix) { t.ws.getRangeByIndexes(r, c, 1, 1).setFormulaR1C1(gold); issues.push({ tab: t.name, cell, kind, before: cur || "(ว่าง)", after: "ใส่สูตรคืน → " + cfShow(t.ws, r, c), status: "แก้แล้ว" }); }
        else issues.push({ tab: t.name, cell, kind, before: cur || "(ว่าง)", after: "ควรเป็นสูตรเดียวกับแถวอื่น", status: "แก้ได้ (โหมด fix)" });
      } else if (!cfIsFormula(cur)) {
        if (fix) {
          const rg = t.ws.getRangeByIndexes(r, c, 1, 1);
          rg.setFormulaR1C1(gold);
          const got = cfShow(t.ws, r, c);
          if (cfSame(got, txt)) issues.push({ tab: t.name, cell, kind: "พิมพ์ค่าทับสูตร", before: txt, after: "ใส่สูตรคืน (ได้ค่าเดิม " + got + ")", status: "แก้แล้ว" });
          else { rg.setValue(cur); issues.push({ tab: t.name, cell, kind: "พิมพ์ค่าทับสูตร (ค่าไม่ตรงกับสูตร)", before: txt, after: "สูตรให้ \"" + got + "\" — คงค่าที่พิมพ์ไว้ · " + cfHint(t, r, c), status: "ต้องตรวจเอง" }); }
        } else issues.push({ tab: t.name, cell, kind: "พิมพ์ค่าทับสูตร", before: txt, after: "โหมด fix จะลองใส่สูตรคืน (ถ้าค่าไม่ตรงจะคงค่าเดิม)", status: "แก้ได้ (โหมด fix)" });
      } else {
        if (fix) {
          const rg = t.ws.getRangeByIndexes(r, c, 1, 1);
          rg.setFormulaR1C1(gold);
          const got = cfShow(t.ws, r, c);
          if (cfSame(got, txt)) issues.push({ tab: t.name, cell, kind: "สูตรต่างจากแถวอื่น", before: cur, after: "ปรับเป็นสูตรมาตรฐาน (ผลเท่าเดิม)", status: "แก้แล้ว" });
          else { rg.setFormulaR1C1(cur); issues.push({ tab: t.name, cell, kind: "สูตรต่างจากแถวอื่น (ผลต่างกัน)", before: cur, after: "สูตรมาตรฐานให้ \"" + got + "\" แต่สูตรเดิมให้ \"" + txt + "\" — คงสูตรเดิม", status: "ต้องตรวจเอง" }); }
        } else issues.push({ tab: t.name, cell, kind: "สูตรต่างจากแถวอื่น", before: cur, after: "แถวอื่นใช้ " + gold, status: "ต้องตรวจเอง" });
      }
    }
  }
}
function cfShow(ws: ExcelScript.Worksheet, r: number, c: number): string { return String(ws.getRangeByIndexes(r, c, 1, 1).getText() || ""); }
function cfSame(a: string, b: string): boolean { return String(a).trim() === String(b).trim(); }
function cfHint(t: CfTab, r: number, c: number): string {
  const code = String(t.t[r][3] || "").trim();
  if (c >= 4 && c <= 6 && code) return "ตรวจว่ารหัสกะ \"" + code + "\" มีในแท็บ ShiftDB หรือไม่";
  return "ตรวจค่าที่กรอก";
}

// ---------- 2) ตารางสรุปไฟลท์ (หมายเลขไฟลท์ 1–40) ----------
function cfCheckSummary(t: CfTab, fix: boolean, issues: CfIssue[]) {
  const u = t.ws.getUsedRange(true); if (!u) return;
  const nR = u.getRowIndex() + u.getRowCount(); if (nR <= t.hr + 1) return;
  const rng = t.ws.getRangeByIndexes(0, 0, nR, 7), fa = rng.getFormulas(), tx = rng.getTexts();
  const block: { r: number; k: number }[] = []; let bad = false;
  for (let r = t.hr + 1; r < nR; r++) {
    const b = String(fa[r][1] || ""), k = parseInt(String(tx[r][0] || "").trim(), 10);
    if (!(k >= 1 && k <= 80)) continue;
    if (!/หมายเลขไฟลท์|#REF!/.test(b)) continue;
    block.push({ r, k });
    for (let c = 1; c <= 6; c++) if (String(fa[r][c] || "").indexOf("#REF!") >= 0 || cfIsErr(String(tx[r][c] || ""))) bad = true;
  }
  if (!block.length || !bad) return;
  // คอลัมน์ไฟลท์ที่ 1 = คอลัมน์ที่แถว k ที่ยังดีอยู่อ้างถึง − 4×(k−1) · แถวหัว = แถวที่อ้าง ($3)
  let base = -1, hdrRow = t.hr + 1;
  for (const x of block) {
    const m = String(fa[x.r][1] || "").match(/\(\s*\$?([A-Z]{1,3})\$(\d+)\s*=/);
    if (m) { base = cfColIdx(m[1]) - 4 * (x.k - 1); hdrRow = +m[2]; break; }
  }
  if (base < 0) base = 19;                                                     // ค่ามาตรฐานเทมเพลต = คอลัมน์ T
  const refs = block.filter(x => /#REF!/.test(String(fa[x.r][1]) + String(fa[x.r][2]))).map(x => cfA1(x.r, 1));
  if (!fix) { issues.push({ tab: t.name, cell: refs.join(", "), kind: "#REF! ในตารางสรุปไฟลท์", before: "อ้างคอลัมน์ไฟลท์ที่ถูกลบ", after: "โหมด fix จะสร้างสูตรทั้งบล็อกใหม่ตามตำแหน่งคอลัมน์", status: "แก้ได้ (โหมด fix)" }); return; }
  const H = hdrRow;
  const out: string[][] = block.map(x => {
    const c1 = cfColName(base + 4 * (x.k - 1)), c2 = cfColName(base + 4 * (x.k - 1) + 2), rr = x.r + 1;
    const pick = (col: string, row: number, a: string, b: string) => "=IF($B" + rr + "=\"\",\"\",TRIM(SUBSTITUTE(SUBSTITUTE(" + col + "$" + row + ",\"" + a + "\",\"\"),\"" + b + "\",\"\")))";
    return ["=IF(OR(" + c1 + "$" + H + "=\"\",ISNUMBER(SEARCH(\"หมายเลขไฟลท์\"," + c1 + "$" + H + "))),\"\"," + c1 + "$" + H + ")",
      pick(c1, H + 1, "A :", "A:"), pick(c2, H + 1, "D :", "D:"), pick(c1, H + 2, "O :", "O:"), pick(c2, H + 2, "C :", "C:"), pick(c1, H + 3, "A/C :", "A/C:")];
  });
  for (let i = 0; i < block.length; i++) t.ws.getRangeByIndexes(block[i].r, 1, 1, 6).setFormulas([out[i]]);
  issues.push({ tab: t.name, cell: refs.join(", "), kind: "#REF! ในตารางสรุปไฟลท์", before: "อ้างคอลัมน์ไฟลท์ที่ถูกลบ (" + refs.length + " แถว)",
    after: "สร้างสูตรใหม่ทั้งบล็อก " + block.length + " แถว (ลำดับ k = คอลัมน์ไฟลท์ลำดับ k นับจากซ้าย)", status: "แก้แล้ว" });
}
function cfColIdx(s: string): number { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function cfColName(c: number): string { let s = "", x = c + 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; }

// ---------- 3) error อื่น ๆ ในแท็บ ----------
function cfCheckErrors(t: CfTab, issues: CfIssue[]) {
  const seen: { [c: string]: boolean } = {}; for (const x of issues) if (x.tab === t.name) for (const c of x.cell.split(/,\s*/)) seen[c] = true;
  const u = t.ws.getUsedRange(true); if (!u) return;
  const nR = Math.min(400, u.getRowIndex() + u.getRowCount()), nC = Math.min(210, u.getColumnIndex() + u.getColumnCount());
  const tx = t.ws.getRangeByIndexes(0, 0, nR, nC).getTexts();
  const found: string[] = [];
  for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
    if (!cfIsErr(tx[r][c])) continue;
    const a = cfA1(r, c); if (seen[a] || (c >= 1 && c <= 6 && seen[cfA1(r, 1)])) continue;
    found.push(a + " " + String(tx[r][c]).trim());
  }
  if (found.length) issues.push({ tab: t.name, cell: found.slice(0, 20).join(", ") + (found.length > 20 ? " …" : ""), kind: "ค่า error อื่นในแท็บ", before: found.length + " ช่อง", after: "เปิดดูสูตรของช่องนั้น", status: "ต้องตรวจเอง" });
}

// ---------- รายงาน ----------
function cfWriteReport(workbook: ExcelScript.Workbook, issues: CfIssue[], fix: boolean) {
  const old = workbook.getWorksheet(CF_REPORT); if (old) old.delete();
  const ws = workbook.addWorksheet(CF_REPORT);
  const head = [["ตรวจสูตรไฟล์เวร — " + (fix ? "โหมดซ่อม (fix)" : "โหมดตรวจอย่างเดียว (check)") + " · พบ " + issues.length + " รายการ · แก้แล้ว " +
    issues.filter(x => x.status === "แก้แล้ว").length + " · ต้องตรวจเอง " + issues.filter(x => x.status === "ต้องตรวจเอง").length, "", "", "", "", ""],
    ["แท็บ", "เซลล์", "ปัญหา", "ก่อน", "หลัง / คำแนะนำ", "สถานะ"]];
  const body = issues.length ? issues.map(x => [x.tab, x.cell, x.kind, x.before.slice(0, 250), x.after.slice(0, 250), x.status]) : [["—", "", "ไม่พบปัญหา ✅", "", "", ""]];
  const all = head.concat(body);
  const rg = ws.getRangeByIndexes(0, 0, all.length, 6);
  rg.setValues(all);
  ws.getRange("A1:F2").getFormat().getFont().setBold(true);
  ws.getRange("A2:F2").getFormat().getFill().setColor("#DCEAFE");
  ws.getRange("A:F").getFormat().autofitColumns();
}
