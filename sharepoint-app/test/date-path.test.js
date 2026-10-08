// วันที่จาก path: เดือนใหม่ / ปีใหม่ / พ.ศ. / ไม่มีปี   (วันนี้สมมติ = 7 ต.ค. 2026)
const { main, dateFromPath } = require(process.argv[2]);
const today = new Date(2026, 9, 7);
const cases = [
  ["Shared Documents/2025/09.SEP26/19SEP.xlsx", "2026-09-19"],
  ["Shared Documents/2026/10.OCT26/07OCT.xlsx", "2026-10-07"],
  ["Shared Documents/2027/01.JAN27/01JAN.xlsx", "2027-01-01"],
  ["Shared Documents/2026/12.DEC26/31DEC.xlsx", "2026-12-31"],
  ["Shared Documents/2027/01.JAN27/1JAN27.xlsx", "2027-01-01"],
  ["Shared Documents/2569/ก.ย.69/19 ก.ย. 69.xlsx", "2026-09-19"],
  ["Shared Documents/2570/มกราคม 2570/5 มกราคม.xlsx", "2027-01-05"],
  ["Shared Documents/2026/09/19.xlsx", "2026-09-19"],
  ["Shared Documents/2026-11/03.xlsx", "2026-11-03"],
  ["Shared Documents/Roster/2026-09-19.xlsx", "2026-09-19"],
  ["Shared Documents/Roster/19.09.2569.xlsx", "2026-09-19"],
  ["Shared Documents/SEP/19SEP.xlsx", "2026-09-19"],
  ["Shared Documents/JAN/03JAN.xlsx", "2027-01-03"],
  ["Shared Documents/2026/02.FEB26/30FEB.xlsx", null],
  ["Shared Documents/LL/ติดตามสัมภาระ.xlsx", null],
  ["Shared Documents/2026/10.OCT26/19 SEPT 2026 rev2.xlsx", "2026-09-19"],
  // โครงจริงของไซต์ HKT PSA Daily
  ["Shared Documents/2026/05.MAY26/01MAY.xlsx", "2026-05-01"],
  ["Shared Documents/2026/10.OCT26/31OCT.xlsx", "2026-10-31"],
  // ชื่อไฟล์จริงในโฟลเดอร์ 10.OCT26
  ["Shared Documents/2026/10.OCT26/01OCT.xlsx", "2026-10-01"],
  ["Shared Documents/2026/10.OCT26/02OCT.xlsx", "2026-10-02"],
  ["Shared Documents/2026/10.OCT26/03OCT.xlsx", "2026-10-03"],
  ["Shared Documents/2026/10.OCT26/04OCT.xlsx", "2026-10-04"],
  ["Shared Documents/2026/10.OCT26/05OCT.xlsx", "2026-10-05"],
  ["Shared Documents/2026/10.OCT26/06OCT.xlsx", "2026-10-06"],
  ["Shared Documents/2026/10.OCT26/07OCT.xlsx", "2026-10-07"],
  ["Shared Documents/2026/00.Master.xlsx", null],
  ["Shared Documents/PAS-Data.xlsx", null],
  ["Shared Documents/PAS-Import/07OCT.xlsx", "2026-10-07"],
];
let bad = 0;
for (const [p, exp] of cases) {
  const r = dateFromPath(p, today), got = r && r.iso;
  if (got !== exp) bad++;
  console.log(got === exp ? "OK " : "XX ", p, "→", got, r ? "(" + r.source + ")" : "");
}
// ไฟล์ที่ไม่ใช่เวร PSA → skipped
const sheet = (name, rows) => ({ getName: () => name, getRange: () => ({ getValues: () => rows, getTexts: () => rows.map(r => r.map(x => String(x))) }), getUsedRange: () => ({ getValues: () => rows }) });
const ll = main({ getWorksheet: () => undefined, getWorksheets: () => [sheet("SOD", [Array(44).fill("")])] }, "Shared Documents/LL/5OCT.xlsx");
if (ll.status !== "skipped") { bad++; console.log("XX LL file not skipped"); } else console.log("OK  non-roster file skipped");
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
