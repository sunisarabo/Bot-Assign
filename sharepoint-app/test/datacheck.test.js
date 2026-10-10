// ตรวจข้อมูล (rbDataCheckHtml) — ตรวจตอนนำเข้า → PAS_DataIssue · fixture ใช้หัวตารางแบบไฟล์จริง (ID/NAME/…/STATUS/FLIGHT)
const { main } = require(process.argv[2]);
const X = require("./fakexl.js");
const blank = () => Array(X.W).fill("");
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };
const issues = r => r.batches.filter(b => b.list === "PAS_DataIssue").flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
const tab = (date, people, flights) => {
  const top = blank(); top[0] = "TEAM : X"; top[5] = date;
  const g = [top].concat(X.header(flights));
  people.forEach(p => { const r = blank(); r[0] = p.id; r[2] = p.name; r[3] = p.code == null ? "F9" : p.code; r[16] = p.st || ""; (p.cells || []).forEach(c => r[19 + c * 4] = "CI"); g.push(r); });
  return g;
};
const mp = [["MANPOWER 08 OCT 2026"], ["Team (EY)"], ["Team (SQ)"], ["Team (QR)"], ["Team (TK)"]];
const ey = tab("08/OCT", [
  { id: 2601001, name: "A", cells: [0] },
  { id: 2601002, name: "B", st: "OFF", cells: [0] },        // OFF แต่มีไฟลท์
  { id: 2601003, name: "C", code: "Z9", cells: [0] },       // ทำงาน มีไฟลท์ แต่รหัสกะไม่อยู่ใน ShiftDB (อ่านเวลาไม่ได้)
  { id: 2601004, name: "A" },                               // ชื่อซ้ำ
  { id: 2601005, name: "P1", cells: [0] }, { id: 2601005, name: "P1", cells: [0] },   // รหัสซ้ำ 3 แถว (มีข้อมูลทั้งคู่) = บล็อกซ้อนซ้ำ
  { id: 2601006, name: "P2", cells: [0] }, { id: 2601006, name: "P2", cells: [0] },
  { id: 2601007, name: "P3", cells: [0] }, { id: 2601007, name: "P3", cells: [0] },
  { id: 2600001, name: "X" }], [{ code: "EY410", std: "09:30" }, { code: "EY412" }]);   // EY412 ไม่มีเวลา
const sq = tab("08/OCT", [{ id: 2600001, name: "X" }], [{ code: "SQ726", sta: "10:00" }]);   // 2600001 อยู่ 2 ทีม
const qr = tab("07/OCT", [{ id: 2603001, name: "Q" }], [{ code: "QR840", std: "23:50" }]);   // วันที่แท็บค้าง
const tk = [blank(), ["ไม่มีรหัส"], ["x", "", "ชื่อ"]];                                     // อ่านไม่ได้ทั้งแท็บ
const wb = X.book({ MANPOWER: mp, EY: ey, SQ: sq, QR: qr, TK: tk, ShiftDB: X.SHIFTDB });
const r = main(wb, "Shared Documents/2026/10.OCT26/09OCT.xlsx");
const I = issues(r), has = (cat, re) => I.some(x => x.category === cat && re.test(x.team + " " + x.who + " " + x.detail));
console.log(I.map(x => x.category + " · " + x.team + " · " + x.who).join("\n"));
ok(has("offflt", /EY B .*EY410/), "OFF แต่มีไฟลท์");
ok(has("noshift", /EY C/), "มาทำงานแต่อ่านเวลากะไม่ได้");
ok(has("dupname", /EY A/), "ชื่อซ้ำในทีม");
ok(has("dupblock", /EY 3 แถว/), "รหัสซ้ำในแท็บ ≥ 3 แถว (เกณฑ์เดียวกับของเดิม)");
ok(has("dupteam", /EY \+ SQ X \(2600001\)/), "รหัสเดียวกันหลายทีม");
ok(has("flttime", /EY EY412/) && !has("flttime", /EY410/), "ไฟลท์ไม่มี STA/STD (เฉพาะ EY412)");
ok(has("staledate", /QR วันที่บนแท็บ = 7\/OCT/), "แท็บวันที่ไม่ตรง (QR 7/OCT vs 8/OCT)");
ok(has("droptab", /TK อ่านไม่ได้ทั้งแท็บ/), "แท็บอ่านไม่ได้");
ok(has("filedate", /2026-10-08.*2026-10-09/), "วันที่หัว MANPOWER ≠ ชื่อไฟล์");
ok(r.counts.issues === I.length && I.every(x => x.day_key === "2026-10-09" && x.month_key === "2026-10"), "นับ issues + day_key/month_key");
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
