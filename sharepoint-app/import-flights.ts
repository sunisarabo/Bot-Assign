/*
 * import-flights.ts — Office Script: "Daily Flight Schedule Record 2026.xlsx" (1 แท็บ/วัน) → PAS_Flights
 *   กติกาอ่านเดียวกับ WeeklyFlight.gs: หาแถวหัวจาก Airlines / Flt no. / STA / STD / A/C TYPE / Remarks / Routing
 *   ชื่อแท็บวันที่: 08OCT · 8OCT · 08 OCT · 08OCT26 · 08OCT2026 · 08-OCT · OCT08 · OCT 8  (ปีจากชื่อไฟล์ เช่น "… 2026.xlsx")
 *   ใช้ทั้ง Flights & SLA · ไฟลท์สัปดาห์ · Auto Assign (A/C TYPE + STA/STD ต่อไฟลท์ต่อวัน)
 *
 * ไฟล์ทั้งปีมีหลายร้อยแท็บ → อ่านเฉพาะช่วงวันที่ต้องการ (กันเกินเวลา Office Script):
 *   fromDay / toDay = "YYYY-MM-DD" (ไม่ใส่ = ย้อน 3 วัน ถึง ล่วงหน้า 14 วัน จากวันนี้)
 * mode "info" → { days[], month_keys[] } (ใช้ดึงแถวเดิม) · mode "sync" + existing = JSON {"PAS_Flights":[{ID,Title,row_hash,day_key}]}
 *   → upsert ตาม Title "YYYY-MM-DD|EY410/411" : ใหม่ POST · เปลี่ยน PATCH · หายจากแท็บ DELETE · เหมือนเดิม ข้าม
 */
const SITE_F = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const BATCH_F = 100;
const MON_F = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// รหัสเครื่อง → ชื่อที่ตาราง SLA ใช้ (คัดจาก WF_AC_MAP)
const AC_MAP: { [k: string]: string } = {
  B789: "B787-9", B788: "B787-8", B78X: "B787-10", B78J: "B787-10", A21N: "A321Neo", A20N: "A320Neo", A21: "A321", A20: "A320",
  B38M: "B737-8", B737M: "B737-8", B7M8: "B737-8", B39M: "B737-9", B73H: "B737-800", B738: "B737-800", B737: "B737", B735: "B737-500",
  AT72: "ATR72", AT75: "ATR72", AT76: "ATR72", ATR: "ATR72", B773: "777-300", B77W: "777-300", B777: "777-300", B772: "777-200",
  B763: "767-300", B764: "767-400", A333: "A330", A332: "A330", A339: "A330", A330: "A330", A359: "A350", A35K: "A350", A350: "A350",
  A319: "A319", A320: "A320", A321: "A321", B788F: "B787-8"
};

type FRow = { [k: string]: string | number | boolean | null };
interface FBatch { list: string; boundary: string; body: string; n: number }
interface FOld { ID: number; Title: string; row_hash?: string; day_key?: string }

function main(workbook: ExcelScript.Workbook, filePath?: string, mode?: string, existing?: string, fromDay?: string, toDay?: string, siteUrl?: string) {
  const path = filePath || "";
  const yFile = (path.match(/(?:^|\D)((?:20|25)\d{2})(?!\d)/) || [])[1];
  const year = yFile ? (+yFile > 2400 ? +yFile - 543 : +yFile) : new Date().getFullYear();
  const today = new Date();
  const from = isoOk(fromDay) || isoAdd(today, -3), to = isoOk(toDay) || isoAdd(today, 14);

  const tabs: { ws: ExcelScript.Worksheet; iso: string }[] = [];
  const used: { [d: string]: boolean } = {};
  for (const ws of workbook.getWorksheets()) {
    const iso = tabDate(ws.getName(), year);
    if (!iso || iso < from || iso > to || used[iso]) continue;
    used[iso] = true;
    tabs.push({ ws, iso });
  }
  tabs.sort((a, b) => a.iso < b.iso ? -1 : 1);
  const days = tabs.map(t => t.iso);
  const month_keys = days.map(d => d.slice(0, 7)).filter((m, i, a) => a.indexOf(m) === i);
  const zero = { days: 0, rows: 0, created: 0, updated: 0, unchanged: 0, deleted: 0, cancelled: 0 };
  if (!tabs.length) return { status: "skipped", reason: "ไม่พบแท็บวันที่ในช่วง " + from + " ถึง " + to, from, to, days, month_keys, counts: zero, batches: [] as FBatch[] };
  if ((mode || "sync") === "info") return { status: "ok", reason: "", from, to, days, month_keys, counts: zero, batches: [] as FBatch[] };

  const rows: FRow[] = [];
  const warnings: string[] = [];
  for (const t of tabs) {
    const n0 = rows.length;
    parseDay(t.ws.getUsedRange().getTexts(), t.iso, rows);
    if (rows.length === n0) warnings.push(t.ws.getName() + ": ไม่พบหัวตาราง Airlines/Flt no./A/C TYPE หรือไม่มีไฟลท์");
  }

  const old: FOld[] = existing ? (JSON.parse(existing).PAS_Flights || []) : [];
  const byTitle: { [t: string]: FOld } = {};
  for (const o of old) if (o && o.Title) byTitle[o.Title] = o;
  const inRange: { [d: string]: boolean } = {};
  for (const d of days) inRange[d] = true;
  const counts = { days: days.length, rows: rows.length, created: 0, updated: 0, unchanged: 0, deleted: 0, cancelled: 0 };
  const ops: { method: string; id: number; row: FRow | null }[] = [];
  const seen: { [t: string]: boolean } = {};
  for (const r of rows) {
    if (r.cancelled) counts.cancelled++;
    r.row_hash = hashF(JSON.stringify(r));
    seen[String(r.Title)] = true;
    const o = byTitle[String(r.Title)];
    if (!o) { ops.push({ method: "POST", id: 0, row: r }); counts.created++; }
    else if (o.row_hash !== r.row_hash) { ops.push({ method: "PATCH", id: o.ID, row: r }); counts.updated++; }
    else counts.unchanged++;
  }
  for (const o of old) {
    const d = o.day_key || String(o.Title).slice(0, 10);
    if (!seen[o.Title] && inRange[d]) { ops.push({ method: "DELETE", id: o.ID, row: null }); counts.deleted++; }
  }
  return { status: "ok", reason: "", warnings, from, to, days, month_keys, counts, batches: toBatchesF((siteUrl || SITE_F).replace(/\/$/, ""), ops) };
}

// ---------- 1 แท็บ = 1 วัน ----------
function parseDay(V: string[][], iso: string, out: FRow[]) {
  const cm = colMap(V);
  if (!cm) return;
  const seen: { [k: string]: number } = {};
  for (let i = cm.head + 1; i < V.length; i++) {
    const row = V[i];
    const air = cell(row, cm.air).toUpperCase(), flt = cell(row, cm.flt).replace(/\s+/g, "");
    if (!/^[A-Z0-9]{2}$/.test(air) || !/\d/.test(flt)) continue;          // ไม่ใช่แถวไฟลท์
    const sta = t(cell(row, cm.sta)), std = t(cell(row, cm.std));
    const remark = cell(row, cm.rem);
    let key = iso + "|" + air + flt;
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) key += "#" + seen[key];
    const acRaw = cell(row, cm.ac);
    out.push({
      Title: key, day_key: iso, month_key: iso.slice(0, 7), flight_date: iso,
      airline_iata: air, flight_no: air + flt, flight_key: flightKey(air, flt),
      direction: sta && std ? (sta === std ? "DEP" : "TURN") : (sta ? "ARR" : (std ? "DEP" : null)),   // STA=STD = RON (ขาออก)
      sta, std, aircraft_type: normAc(acRaw), ac_raw: acRaw.toUpperCase(),
      routing: cell(row, cm.rte), remark: remark.slice(0, 255), cancelled: /CANCEL/i.test(remark)
    });
  }
}
function colMap(V: string[][]): { head: number; air: number; flt: number; sta: number; std: number; ac: number; rem: number; rte: number } | null {
  for (let r = 0; r < Math.min(V.length, 8); r++) {
    const c = { head: r, air: -1, flt: -1, sta: -1, std: -1, ac: -1, rem: -1, rte: -1 };
    V[r].forEach((x, i) => {
      const h = String(x || "").trim().toUpperCase();
      if (/^AIRLINE/.test(h)) c.air = i;
      else if (/^FL(T|IGHT)?\s*NO|^FLT$/.test(h)) c.flt = i;
      else if (h === "STA") c.sta = i;
      else if (h === "STD") c.std = i;
      else if (/A\/?C\s*TYPE|AIRCRAFT/.test(h)) c.ac = i;
      else if (/^REMARK/.test(h)) c.rem = i;
      else if (/^ROUTING|^ROUTE/.test(h)) c.rte = i;
    });
    if (c.air >= 0 && c.flt >= 0 && c.ac >= 0) return c;
  }
  return null;
}
// ชื่อแท็บ → ISO (DDMON[YY[YY]] · DD MON · DD-MON · MONDD · MON DD)
function tabDate(name: string, year: number): string {
  const u = name.toUpperCase().replace(/[\s.\-_\/]/g, "");
  let d = 0, m = 0, y = year;
  let r = u.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(\d{2}|\d{4})?$/);
  if (r) { d = +r[1]; m = MON_F.indexOf(r[2]) + 1; if (r[3]) y = +r[3] < 100 ? (+r[3] >= 60 ? 2500 + +r[3] - 543 : 2000 + +r[3]) : +r[3]; }
  else {
    r = u.match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(\d{1,2})$/);
    if (!r) return "";
    m = MON_F.indexOf(r[1]) + 1; d = +r[2];
  }
  if (y > 2400) y -= 543;
  if (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return "";
  return y + "-" + p2f(m) + "-" + p2f(d);
}
// เหมือน slaFlightKey_: สาย + เลขไฟลท์ชุดแรก (ตัดเลข 0 นำหน้า) → "EY410"
function flightKey(air: string, flt: string): string { const m = flt.match(/\d+/); return m ? air + String(parseInt(m[0], 10)) : air + flt; }
function normAc(code: string): string {
  const c = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!c || /^X+$/.test(c) || c === "TBA" || c === "TBN") return "";
  if (AC_MAP[c]) return AC_MAP[c];
  const base = c.replace(/[^A-Z0-9].*$/, "");
  return AC_MAP[base] || c;
}
function cell(row: string[], i: number): string { return i >= 0 && i < row.length ? String(row[i] == null ? "" : row[i]).replace(/ /g, " ").trim() : ""; }
function t(s: string): string { const m = s.match(/^(\d{1,2})[:.]?(\d{2})$/); return m && +m[1] < 48 ? p2f(+m[1]) + ":" + m[2] : ""; }
function p2f(x: number): string { return (x < 10 ? "0" : "") + x; }
function isoOk(s?: string): string { return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
function isoAdd(d: Date, n: number): string { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + n)); return x.getUTCFullYear() + "-" + p2f(x.getUTCMonth() + 1) + "-" + p2f(x.getUTCDate()); }
function hashF(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
function toBatchesF(site: string, ops: { method: string; id: number; row: FRow | null }[]): FBatch[] {
  const CRLF = "\r\n", base = site + "/_api/web/lists/getbytitle('PAS_Flights')/items", out: FBatch[] = [];
  for (let i = 0; i < ops.length; i += BATCH_F) {
    const id = "flt_" + (i / BATCH_F) + "_" + Math.floor(Math.random() * 1e9), b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = ops.slice(i, i + BATCH_F);
    for (const op of chunk) {
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF;
      if (op.method === "POST") body += "POST " + base + " HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF + "Accept: application/json;odata=nometadata" + CRLF + CRLF + JSON.stringify(op.row) + CRLF + CRLF;
      else if (op.method === "PATCH") body += "PATCH " + base + "(" + op.id + ") HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF + "IF-MATCH: *" + CRLF + CRLF + JSON.stringify(op.row) + CRLF + CRLF;
      else body += "DELETE " + base + "(" + op.id + ") HTTP/1.1" + CRLF + "IF-MATCH: *" + CRLF + CRLF;
    }
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    out.push({ list: "PAS_Flights", boundary: b, body, n: chunk.length });
  }
  return out;
}
