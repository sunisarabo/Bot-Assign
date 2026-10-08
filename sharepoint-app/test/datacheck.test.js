// ตรวจข้อมูล (rbDataCheckHtml) — ตรวจตอนนำเข้า → PAS_DataIssue
const { main } = require(process.argv[2]);
const W = 44, blank = () => Array(W).fill("");
const sheet = (name, rows) => ({ getName: () => name, getRange: (a) => ({ getValues: () => rows, getTexts: () => rows.slice(0, a === "A1:T4" ? 4 : rows.length).map(r => r.map(x => String(x))) }), getUsedRange: () => ({ getValues: () => rows }) });
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };
const issues = r => r.batches.filter(b => b.list === "PAS_DataIssue").flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
const tab = (date, people, flights) => {
  const g = [blank(), blank(), blank(), blank()]; g[0][5] = date;
  g[1][18] = "FLIGHT"; g[2][18] = "STA / STD"; g[3][18] = "OP / CL";
  flights.forEach((f, i) => { const b = 19 + i * 4; g[1][b] = f.code; g[2][b] = f.sta || ""; g[2][b + 2] = f.std || ""; });
  people.forEach(p => { const r = blank(); r[0] = p.id; r[2] = p.name; r[4] = p.in == null ? "06:00" : p.in; r[6] = 9; r[16] = p.st || ""; (p.cells || []).forEach(c => r[19 + c * 4] = "CI"); g.push(r); });
  return g;
};
const mp = [["MANPOWER 08 OCT 2026"], ["Team (EY)"], ["Team (SQ)"], ["Team (QR)"], ["Team (TK)"]];
const ey = tab("08/OCT", [
  { id: 1001, name: "A", cells: [0] },
  { id: 1002, name: "B", st: "OFF", cells: [0] },          // OFF แต่มีไฟลท์
  { id: 1003, name: "C", in: "", cells: [0] },              // ทำงาน มีไฟลท์ ไม่มีเวลากะ
  { id: 1004, name: "A" },                                  // ชื่อซ้ำ
  { id: 1001, name: "A2" },                                 // รหัสซ้ำในแท็บ (บล็อกซ้อน)
  { id: 2600001, name: "X" }], [{ code: "EY410", std: "09:30" }, { code: "EY412" }]);   // EY412 ไม่มีเวลา
const sq = tab("08/OCT", [{ id: 2600001, name: "X" }], [{ code: "SQ726", sta: "10:00" }]);   // 2001 อยู่ 2 ทีม
const qr = tab("07/OCT", [{ id: 3001, name: "Q" }], [{ code: "QR840", std: "23:50" }]);   // วันที่แท็บค้าง
const tk = [blank(), ["ไม่มีรหัส"], ["x", "", "ชื่อ"]];                                   // อ่านไม่ได้ทั้งแท็บ
const tabs = { MANPOWER: sheet("MANPOWER", mp), EY: sheet("EY", ey), SQ: sheet("SQ", sq), QR: sheet("QR", qr), TK: sheet("TK", tk) };
const wb = { getWorksheet: n => tabs[n], getWorksheets: () => Object.values(tabs) };
const r = main(wb, "Shared Documents/2026/10.OCT26/09OCT.xlsx");
const I = issues(r), has = (cat, re) => I.some(x => x.category === cat && re.test(x.team + " " + x.who + " " + x.detail));
console.log(I.map(x => x.category + " · " + x.team + " · " + x.who).join("\n"));
ok(has("offflt", /EY B .*EY410/), "OFF แต่มีไฟลท์");
ok(has("noshift", /EY C/), "มาทำงานแต่อ่านเวลากะไม่ได้");
ok(has("dupname", /EY A/), "ชื่อซ้ำในทีม");
ok(has("dupblock", /EY A2 \(1001\)/), "รหัสซ้ำในแท็บ");
ok(has("dupteam", /EY \+ SQ X \(2600001\)/), "รหัสเดียวกันหลายทีม");
ok(has("flttime", /EY EY412/) && !has("flttime", /EY410/), "ไฟลท์ไม่มี STA/STD (เฉพาะ EY412)");
ok(has("staledate", /QR วันที่บนแท็บ = 7\/OCT/), "แท็บวันที่ไม่ตรง (QR 7/OCT vs 8/OCT)");
ok(has("droptab", /TK อ่านไม่ได้ทั้งแท็บ/), "แท็บอ่านไม่ได้");
ok(has("filedate", /2026-10-08.*2026-10-09/), "วันที่หัว MANPOWER ≠ ชื่อไฟล์");
ok(r.counts.issues === I.length && I.every(x => x.day_key === "2026-10-09" && x.month_key === "2026-10"), "นับ issues + day_key/month_key");
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
