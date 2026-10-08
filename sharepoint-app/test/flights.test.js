// import-flights: ตารางบินรายวัน (1 แท็บ/วัน) → PAS_Flights
const { main } = require(process.argv[2]);
const sheet = (name, rows) => ({ getName: () => name, getRange: () => ({ getTexts: () => rows }), getUsedRange: () => ({ getTexts: () => rows }) });
const wb = (tabs) => ({ getWorksheet: n => tabs.find(t => t.getName() === n), getWorksheets: () => tabs });
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };
const rows = r => r.batches.flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
const day = () => [["DAILY FLIGHT SCHEDULE"], ["No", "Airlines", "Flt no.", "Routing", "STA", "STD", "A/C TYPE", "Remarks"],
  ["1", "EY", "410/411", "AUH-HKT-AUH", "0805", "0930", "A21N", ""],
  ["2", "6E", "1077", "DEL-HKT", "13:15", "", "a20n", ""],
  ["3", "QR", "840", "DOH-HKT", "", "2350", "B77W", "Cancelled"],
  ["4", "TG", "201", "", "0600", "0600", "XXXX", "RON"],
  ["", "Total", "", "", "", "", "", ""]];
const W = wb([sheet("07OCT", day()), sheet("8 OCT", day()), sheet("OCT09", day()), sheet("Summary", [["x"]]), sheet("30SEP", day())]);
const P = "personal/hktopsocc_aotga_com1/Documents/0. Workspace/2026/Daily Flight Schedule Record 2026.xlsx";
const i = main(W, P, "info", "", "2026-10-07", "2026-10-08");
ok(i.days.join() === "2026-10-07,2026-10-08" && i.month_keys.join() === "2026-10", "เลือกเฉพาะแท็บในช่วง (07OCT, 8 OCT) · ข้าม OCT09/30SEP/Summary");
const r = main(W, P, "sync", "{}", "2026-10-07", "2026-10-09"), R = rows(r);
ok(r.counts.days === 3 && R.length === 12 && r.counts.cancelled === 3, "3 วัน × 4 ไฟลท์ · ยกเลิก 3");
const ey = R.find(x => x.Title === "2026-10-07|EY410/411");
ok(ey && ey.flight_key === "EY410" && ey.direction === "TURN" && ey.sta === "08:05" && ey.std === "09:30" && ey.aircraft_type === "A321Neo", "EY410/411: key/ขา/เวลา/เครื่อง");
const e6 = R.find(x => x.Title === "2026-10-07|6E1077");
ok(e6.flight_key === "6E1077" && e6.direction === "ARR" && e6.aircraft_type === "A320Neo", "สายขึ้นต้นด้วยเลข 6E → key 6E1077 (ไม่ใช่ 6E6)");
const tg = R.find(x => x.Title === "2026-10-07|TG201");
ok(tg.direction === "DEP" && tg.aircraft_type === "", "STA=STD → DEP (RON) · XXXX → ว่าง");
// รันซ้ำ + ไฟลท์หายจากแท็บ 7 ต.ค. + แถวนอกช่วงไม่แตะ
const ex = R.map((x, k) => ({ ID: k + 1, Title: x.Title, row_hash: x.row_hash, day_key: x.day_key }))
  .concat([{ ID: 90, Title: "2026-10-07|SQ726", row_hash: "x", day_key: "2026-10-07" }, { ID: 91, Title: "2026-10-20|SQ726", row_hash: "x", day_key: "2026-10-20" }]);
const r2 = main(W, P, "sync", JSON.stringify({ PAS_Flights: ex }), "2026-10-07", "2026-10-09");
ok(r2.counts.unchanged === 12 && r2.counts.deleted === 1 && /items\(90\)/.test(r2.batches[0].body) && !/items\(91\)/.test(r2.batches[0].body), "รันซ้ำไม่เขียน · ลบ SQ726 วันที่ 7 · ไม่แตะวันที่ 20 (นอกช่วง)");
ok(main(W, P, "info", "", "2026-11-01", "2026-11-05").status === "skipped", "ไม่มีแท็บในช่วง → skipped");
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
