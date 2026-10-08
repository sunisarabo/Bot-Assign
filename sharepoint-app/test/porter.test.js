// import-porter: Porter Summary + Pre-Wheelchair (1 ไฟล์/เดือน · 1 แท็บ/วัน)
const { main } = require(process.argv[2]);
const sheet = (name, rows) => ({ getName: () => name, getRange: () => ({ getTexts: () => rows, getValues: () => rows }), getUsedRange: () => ({ getTexts: () => rows, getValues: () => rows }) });
const wb = (tabs) => ({ getWorksheet: n => tabs.find(t => t.getName() === n), getWorksheets: () => tabs });
const W = 30, blank = () => Array(W).fill("");
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };
const rows = (r, list) => r.batches.filter(b => b.list === list).flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));

// ---------- Porter ----------
const pTab = () => {
  const g = [blank(), blank(), blank()];
  g[0][0] = "01OCT26"; g[1][1] = "ที่"; g[1][2] = "IATA CODE"; g[1][25] = "NO"; g[1][27] = "NAME";
  const j1 = blank(); Object.assign(j1, { 1: "1", 2: "tg", 3: "TG201", 4: "SOMCHAI\nWICHAI", 5: "Completed", 6: "6:20", 8: "", 12: "-", 15: "6:25", 16: "6:50", 17: "WCHR", 18: "TRUE", 19: "FALSE", 21: "0:05", 23: "12A", 25: "1", 26: "D1", 27: "SOMCHAI", 28: "3" });
  const j2 = blank(); Object.assign(j2, { 1: "2", 2: "EK", 3: "EK379", 4: "MANA", 5: "STANDBY", 8: "13:05", 17: "Stretcher", 18: "FALSE", 19: "TRUE", 25: "2", 27: "MANA", 28: "1" });
  g.push(j1, j2); return g;
};
const porterWb = wb([sheet("01OCT26", pTab()), sheet("02 OCT 26", pTab()), sheet("SUMMARY", [blank()]), sheet("30SEP26", pTab())]);
const pPath = "personal/hktlp_aotga_com/Documents/2026 PORTER SUMMARY/OCT 2026 PORTER SUMMARY.xlsx";
const info = main(porterWb, pPath, "info");
ok(info.kind === "PORTER" && info.month_key === "2026-10" && info.days.join() === "2026-10-01,2026-10-02", "info: PORTER · 2026-10 · 2 แท็บ (ข้ามแท็บ SEP ค้าง + SUMMARY)");
const r1 = main(porterWb, pPath, "sync", "{}");
const P = rows(r1, "PAS_Porter"), S = rows(r1, "PAS_PorterStaff");
ok(r1.counts.created === 8 && P.length === 4 && S.length === 4, "สร้าง งาน 4 + พอตเตอร์ 4 (2 วัน)");
ok(P[0].Title === "2026-10-01|1" && P[0].airline_iata === "TG" && P[0].porter_names === "SOMCHAI, WICHAI" && P[0].eta === "06:20" && P[0].is_arrival === true && P[0].gate === "", "แถวงาน: key/สาย/ชื่อหลายคน/เวลา/ขาเข้า/ขีด");
ok(P[1].service === "ETC" && P[1].service_raw === "STRETCHER" && P[1].is_departure === true, "ประเภทนอกรายการ → ETC (เก็บค่าเดิมไว้)");
ok(S[0].staff_name === "SOMCHAI" && S[0].cases === 3, "STAFF RECORD → เคสต่อคน");
// รอบสอง: ไม่เปลี่ยน → 0 คำสั่ง · แก้ 1 เคส + แถวที่หายจากแท็บถูกลบ + วันอื่นไม่แตะ
const ex = (list, arr) => arr.map((x, i) => ({ ID: i + 1, Title: x.Title, row_hash: x.row_hash, day_key: x.day_key }));
const E = { PAS_Porter: ex("P", P).concat([{ ID: 99, Title: "2026-10-01|7", row_hash: "x", day_key: "2026-10-01" }, { ID: 98, Title: "2026-10-15|1", row_hash: "x", day_key: "2026-10-15" }]), PAS_PorterStaff: ex("S", S) };
const r2 = main(porterWb, pPath, "sync", JSON.stringify(E));
ok(r2.counts.unchanged === 8 && r2.counts.deleted === 1 && r2.counts.created === 0, "รันซ้ำ: เหมือนเดิม 8 · ลบเคสที่หายจากแท็บวันที่ 1 · ไม่แตะวันที่ 15 (ไม่มีแท็บ)");
ok(/DELETE .*items\(99\)/.test(r2.batches[0].body) && !/items\(98\)/.test(r2.batches[0].body), "DELETE เฉพาะ ID 99");

// ---------- Pre-WC ----------
const wTab = () => {
  const h = blank(); Object.assign(h, { 0: "AIRLINES", 1: "Flt no.", 9: "WCHR" });
  const f1 = blank(); Object.assign(f1, { 0: "TG", 1: "201/202", 2: "BKK-HKT-BKK", 3: "0805", 4: "0930", 5: "8:05", 6: "31/12/1899, 00:00:00", 7: "7:00", 8: "8:45", 9: "2", 11: "1", 15: "1" });
  const f2 = blank(); Object.assign(f2, { 0: "EK", 1: "378", 2: "DXB-HKT", 3: "1210", 9: "0" });    // ไม่มีจอง → ไม่มีแถว
  return [h, f1, f2, blank(), (() => { const x = blank(); x[0] = "หมายเหตุ"; x[1] = "xx"; return x; })()];
};
const wWb = wb([sheet("08OCT26", wTab())]);
const w = main(wWb, "Pre case wheelchair/OCT 2026/OCT 2026 PRE-WHEELCHAIR.xlsx", "sync", "{}");
const R = rows(w, "PAS_PreWC");
ok(w.kind === "PREWC" && R.length === 3, "Pre-WC: TG201 ARR WCHR 2 + ARR WCHC 1 + DEP WCHR 1 = 3 แถว");
ok(R[0].Title === "2026-10-08|TG201/202|ARR|WCHR" && R[0].qty === 2 && R[0].sta === "08:05" && R[0].std === "09:30" && R[0].ct_open === "07:00", "เวลา: STA จากช่องเวลา · STD ว่าง(1899) → ใช้ HHMM 0930");
ok(main(wb([sheet("Sheet1", [blank()])]), "x/Book1.xlsx", "info").status === "skipped", "ไฟล์อื่น → skipped");
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
