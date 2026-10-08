/*
 * import-porter.ts — Office Script: ไฟล์รายเดือน Porter / Pre-Wheelchair → SharePoint Lists
 *   "<MON YYYY> PORTER SUMMARY"   (โฟลเดอร์ 2026 PORTER SUMMARY)  → PAS_Porter (งาน/เคส) + PAS_PorterStaff (เคสต่อพอตเตอร์)
 *   "<MON YYYY> PRE-WHEELCHAIR"   (โฟลเดอร์ Pre case wheelchair)   → PAS_PreWC (ยอดจอง ไฟลท์ × ขา × ชนิด)
 *   1 ไฟล์ = 1 เดือน · 1 แท็บ = 1 วัน (ชื่อ "19SEP26") — กติกาอ่านเดียวกับ Porter.gs / PreWheelchair.gs
 *
 * เรียก 2 ครั้งใน flow:
 *   1) mode = "info"  → { kind, month_key, lists[] }   (อ่านชื่อไฟล์/แท็บอย่างเดียว — ใช้ดึงแถวเดิมของเดือนนั้น)
 *   2) mode = "sync"  + existing = JSON {"PAS_Porter":[{ID,Title,row_hash,day_key}],…}
 *      → upsert ตาม Title (key) เฉพาะวันที่มีแท็บในไฟล์: ใหม่ POST · เปลี่ยน PATCH · หายไป DELETE · เหมือนเดิม ข้าม
 *      → { status, kind, month_key, days[], counts, batches[] } — ส่งด้วย "Send an HTTP request to SharePoint" (_api/$batch)
 *
 * พารามิเตอร์: filePath (ชื่อ/ path ไฟล์ — ใช้แยกชนิด + ปี) · mode · existing · kind ("PORTER"/"PREWC" บังคับได้) · siteUrl
 */
const SITE_P = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const BATCH_P = 100;
const MON_P = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SVC_P = ["WCHR", "WCHS", "WCHC", "MAAS", "AVIH", "ETC"];
const WC_TYPES = ["WCHR", "WCHS", "WCHC", "AVIH", "MAAS"];        // ลำดับคอลัมน์ในไฟล์ Pre-WC (9..13 ขาเข้า · 15..19 ขาออก)

type Row = { [k: string]: string | number | boolean | null };
interface PBatch { list: string; boundary: string; body: string; n: number }
interface Old { ID: number; Title: string; row_hash?: string; day_key?: string }

function main(workbook: ExcelScript.Workbook, filePath?: string, mode?: string, existing?: string, kind?: string, siteUrl?: string) {
  const path = filePath || "";
  const k = (kind || detectKind(workbook, path)).toUpperCase();
  const lists = k === "PORTER" ? ["PAS_Porter", "PAS_PorterStaff"] : k === "PREWC" ? ["PAS_PreWC"] : [];
  const tabs = dayTabs(workbook, path);
  const month_key = tabs.length ? tabs[0].iso.slice(0, 7) : "";
  const zero = { days: 0, rows: 0, created: 0, updated: 0, unchanged: 0, deleted: 0 };
  if (!lists.length) return { status: "skipped", reason: "ไม่ใช่ไฟล์ Porter Summary / Pre-Wheelchair", kind: k, month_key, lists, days: [] as string[], counts: zero, batches: [] as PBatch[] };
  if (!tabs.length) return { status: "skipped", reason: "ไม่พบแท็บรายวัน (ชื่อแบบ 19SEP26)", kind: k, month_key, lists, days: [] as string[], counts: zero, batches: [] as PBatch[] };
  if ((mode || "sync") === "info") return { status: "ok", reason: "", kind: k, month_key, lists, days: tabs.map(t => t.iso), counts: zero, batches: [] as PBatch[] };

  // ---- อ่านทุกแท็บรายวัน ----
  const rowsBy: { [list: string]: Row[] } = {};
  for (const l of lists) rowsBy[l] = [];
  for (const t of tabs) {
    const V = t.ws.getUsedRange().getTexts();
    if (k === "PORTER") readPorter(V, t.iso, rowsBy);
    else readPreWC(V, t.iso, rowsBy);
  }
  const old: { [list: string]: Old[] } = existing ? JSON.parse(existing) : {};
  const days: { [d: string]: boolean } = {};
  for (const t of tabs) days[t.iso] = true;

  const site = (siteUrl || SITE_P).replace(/\/$/, "");
  const counts = { days: tabs.length, rows: 0, created: 0, updated: 0, unchanged: 0, deleted: 0 };
  const batches: PBatch[] = [];
  for (const l of lists) {
    const rows = rowsBy[l];
    counts.rows += rows.length;
    const byTitle: { [t: string]: Old } = {};
    for (const o of (old[l] || [])) if (o && o.Title) byTitle[o.Title] = o;
    const seen: { [t: string]: boolean } = {};
    const ops: { method: string; id: number; row: Row | null }[] = [];
    for (const r of rows) {
      r.month_key = month_key;
      r.row_hash = hashP(JSON.stringify(r));
      const key = String(r.Title);
      seen[key] = true;
      const o = byTitle[key];
      if (!o) { ops.push({ method: "POST", id: 0, row: r }); counts.created++; }
      else if (o.row_hash !== r.row_hash) { ops.push({ method: "PATCH", id: o.ID, row: r }); counts.updated++; }
      else counts.unchanged++;
    }
    for (const o of (old[l] || [])) {                               // ลบเฉพาะวันที่มีแท็บในไฟล์นี้ (วันอื่นไม่แตะ)
      const d = o.day_key || String(o.Title).slice(0, 10);
      if (o && !seen[o.Title] && days[d]) { ops.push({ method: "DELETE", id: o.ID, row: null }); counts.deleted++; }
    }
    pushBatches(batches, site, l, ops);
  }
  return { status: "ok", reason: "", kind: k, month_key, lists, days: tabs.map(t => t.iso), counts, batches };
}

// ======================= Porter =======================
// 1=ที่ 2=สายการบิน 3=เที่ยวบิน 4=ชื่อพอตเตอร์ 5=สถานะ 6=ETA 8=ETD 12=ประตู 13=ได้รับแจ้ง 15=รับเคส 16=ส่งเคส
// 17=ประเภท 18=ขาเข้า 19=ขาออก 21=ระยะเวลารอ 22=REMARK 23=SEAT · STAFF: 25=NO 26=SKED 27=NAME 28=CASE SUMMARY
function readPorter(V: string[][], iso: string, out: { [l: string]: Row[] }) {
  const seen: { [k: string]: number } = {};
  for (const row of V) {
    const num = int(row[1]), airline = s(row[2]).toUpperCase();
    if (num != null && airline && airline !== "IATA CODE") {
      let key = iso + "|" + num;
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key += "#" + seen[key];
      const svcRaw = s(row[17]).toUpperCase();
      out.PAS_Porter.push({
        Title: key, day_key: iso, work_date: iso, job_no: num, airline_iata: airline,
        flight_no: dash(row[3]), porter_names: names(row[4]), status: s(row[5]).toUpperCase(),
        eta: tm(row[6]), etd: tm(row[8]), gate: dash(row[12]), notified_at: tm(row[13]),
        pickup_at: tm(row[15]), delivered_at: tm(row[16]),
        service: svcRaw ? (SVC_P.indexOf(svcRaw) >= 0 ? svcRaw : "ETC") : null,
        service_raw: svcRaw, is_arrival: bool(row[18]), is_departure: bool(row[19]),
        wait_time: s(row[21]), remark: s(row[22]).slice(0, 255), seat: dash(row[23])
      });
    }
    if (row.length > 28) {
      const sn = int(row[25]), nm = s(row[27]);
      if (sn != null && nm && nm.toUpperCase() !== "NAME")
        out.PAS_PorterStaff.push({ Title: iso + "|" + sn, day_key: iso, staff_no: sn, staff_name: nm, sked: s(row[26]), cases: int(row[28]) || 0 });
    }
  }
}

// ======================= Pre-Wheelchair =======================
// 0=Airlines 1=Flt no. 2=Routing 3/4=STA/STD(HHMM) 5/6=STA/STD(เวลา) 7/8=C/T OPEN/CLOSE · ARR 9..13 · DEP 15..19
function readPreWC(V: string[][], iso: string, out: { [l: string]: Row[] }) {
  let seen = false;
  for (const row of V) {
    const a = s(row[0]).toUpperCase();
    if (!a) { if (seen) break; else continue; }
    if (a === "AIRLINES" || a === "AIRLINE" || a === "DATE") continue;
    const flt = s(row[1]);
    if (!flt || flt.toUpperCase() === "FLT NO.") { if (seen) break; else continue; }
    seen = true;
    const base = {
      day_key: iso, work_date: iso, airline_iata: a, flight_no: a + flt, routing: s(row[2]),
      sta: tm(row[5]) || hhmm4(row[3]), std: tm(row[6]) || hhmm4(row[4]), ct_open: tm(row[7]), ct_close: tm(row[8])
    };
    for (const dir of ["ARR", "DEP"]) {
      const c0 = dir === "ARR" ? 9 : 15;
      for (let i = 0; i < 5; i++) {
        const q = int(row[c0 + i]) || 0;
        if (q > 0) {
          const r: Row = { Title: iso + "|" + a + flt + "|" + dir + "|" + WC_TYPES[i], direction: dir, service: WC_TYPES[i], qty: q };
          for (const kk of Object.keys(base)) r[kk] = (base as Row)[kk];
          out.PAS_PreWC.push(r);
        }
      }
    }
  }
}

// ======================= แท็บ / ชนิดไฟล์ =======================
function dayTabs(workbook: ExcelScript.Workbook, path: string): { ws: ExcelScript.Worksheet; iso: string }[] {
  const fy = path.toUpperCase().match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[-_.]?\s*((?:20|25)\d{2})/);
  const fileMon = fy ? MON_P.indexOf(fy[1]) + 1 : 0, fileYear = fy ? toCEp(+fy[2]) : 0;
  const out: { ws: ExcelScript.Worksheet; iso: string }[] = [];
  const used: { [d: string]: boolean } = {};
  for (const ws of workbook.getWorksheets()) {
    const m = ws.getName().toUpperCase().replace(/[\s.\-\/]/g, "").match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(\d{2}|\d{4})?$/);
    if (!m) continue;
    const mon = MON_P.indexOf(m[2]) + 1;
    if (fileMon && mon !== fileMon) continue;                        // แท็บต่างเดือน (สำเนาค้าง) → ข้าม
    let y = m[3] ? +m[3] : fileYear || new Date().getFullYear();
    if (y < 100) y = y >= 60 ? 2500 + y - 543 : 2000 + y;
    y = toCEp(y);
    const d = +m[1];
    if (d < 1 || d > new Date(Date.UTC(y, mon, 0)).getUTCDate()) continue;
    const iso = y + "-" + p2(mon) + "-" + p2(d);
    if (used[iso]) continue;                                         // ชื่อซ้ำ → ใช้แท็บแรก (เหมือน porterFindSheet_)
    used[iso] = true;
    out.push({ ws, iso });
  }
  return out.sort((a, b) => a.iso < b.iso ? -1 : 1);
}
function detectKind(workbook: ExcelScript.Workbook, path: string): string {
  const u = path.toUpperCase();
  if (u.indexOf("WHEEL") >= 0 || u.indexOf("PRE-CASE") >= 0 || u.indexOf("PRE CASE") >= 0) return "PREWC";
  if (u.indexOf("PORTER") >= 0) return "PORTER";
  for (const ws of workbook.getWorksheets().slice(0, 3)) {           // ไม่มีชื่อบอก → ดูหัวตาราง
    const t = ws.getRange("A1:AC8").getTexts().map(r => r.join("|").toUpperCase()).join("|");
    if (t.indexOf("IATA CODE") >= 0 || t.indexOf("STAFF RECORD") >= 0) return "PORTER";
    if (t.indexOf("FLT NO") >= 0 && t.indexOf("WCHR") >= 0) return "PREWC";
  }
  return "";
}

// ======================= $batch =======================
function pushBatches(out: PBatch[], site: string, list: string, ops: { method: string; id: number; row: Row | null }[]) {
  const CRLF = "\r\n", base = site + "/_api/web/lists/getbytitle('" + list + "')/items";
  for (let i = 0; i < ops.length; i += BATCH_P) {
    const id = list + "_" + (i / BATCH_P) + "_" + Math.floor(Math.random() * 1e9), b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = ops.slice(i, i + BATCH_P);
    for (const op of chunk) {
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF;
      if (op.method === "POST")
        body += "POST " + base + " HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF + "Accept: application/json;odata=nometadata" + CRLF + CRLF + JSON.stringify(op.row) + CRLF + CRLF;
      else if (op.method === "PATCH")
        body += "PATCH " + base + "(" + op.id + ") HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF + "IF-MATCH: *" + CRLF + CRLF + JSON.stringify(op.row) + CRLF + CRLF;
      else
        body += "DELETE " + base + "(" + op.id + ") HTTP/1.1" + CRLF + "IF-MATCH: *" + CRLF + CRLF;
    }
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    out.push({ list, boundary: b, body, n: chunk.length });
  }
}

// ======================= helpers =======================
function s(v: string): string { return String(v == null ? "" : v).replace(/ /g, " ").trim(); }
function int(v: string): number | null { const n = parseInt(s(v).replace(/[^\d\-]/g, ""), 10); return isNaN(n) ? null : n; }
function bool(v: string): boolean { const x = s(v).toUpperCase(); return x === "TRUE" || x === "✓" || x === "YES"; }
function dash(v: string): string { return s(v).replace(/^-$/, ""); }
function names(v: string): string { return s(v).split(/[\n,\/]+/).map(x => x.trim()).filter(x => x).join(", "); }
function tm(v: string): string { const x = s(v); if (!x || /1899/.test(x)) return ""; const m = x.match(/(\d{1,2})[:.](\d{2})/); return m ? p2(+m[1]) + ":" + m[2] : ""; }
function hhmm4(v: string): string { const m = s(v).match(/^(\d{1,2})(\d{2})$/); return m && +m[1] < 24 ? p2(+m[1]) + ":" + m[2] : ""; }
function p2(x: number): string { return (x < 10 ? "0" : "") + x; }
function toCEp(y: number): number { return y > 2400 ? y - 543 : y; }
function hashP(t: string): string { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
