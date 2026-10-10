// เทียบ "ทีมยังลง assignment ไม่ครบ" ใหม่ (import-roster → PAS_DataIssue notfilled) กับของเดิม (AdvancePlan.gs apTeamsNotFilled_)
const vm = require("vm"), fs = require("fs"), path = require("path");
const { main } = require(process.argv[2]);
const ROOT = path.join(__dirname, "..", "..");
const ctx = { Logger: { log() {} }, console };
vm.createContext(ctx);
for (const f of ["RosterReader.gs", "AssignCheck.gs", "SLA.gs", "AutoPlan.gs", "AdvancePlan.gs"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
const W = 44, blank = () => Array(W).fill("");
// แท็บทีมแบบ PAS: A=ID C=NAME D=SHIFT Q=STATUS S=FLIGHT · ไฟลท์เริ่มคอลัมน์ T
const tab = (people) => {
  const h = blank(); h[0] = "ID"; h[2] = "NAME"; h[3] = "SHIFT"; h[16] = "STATUS"; h[18] = "FLIGHT"; h[19] = "EY410";
  const g = [blank(), h, blank(), blank()];
  people.forEach(p => { const r = blank(); r[0] = p.id; r[2] = p.name; r[3] = p.sh || ""; r[4] = p.sh ? "06:00" : ""; r[6] = p.sh ? 9 : ""; r[16] = p.st || ""; if (p.job) r[19 + 4 * (p.job - 1)] = "CI"; g.push(r); });
  return g;
};
const T = {
  EY: tab([{ id: 2600001, name: "a", sh: "F9", job: 1 }, { id: 2600002, name: "b", st: "OFF" }]),                              // ครบ
  SQ: tab([{ id: 2600011, name: "c", sh: "F9", st: "Onduty" }, { id: 2600012, name: "d", sh: "F9" }, { id: 2600013, name: "e" }]),  // ค้าง 2
  CHARTER: tab([{ id: 2600021, name: "f", sh: "F9" }, { id: 2600022, name: "g" }]),                                              // สแตนด์บาย: มีกะ = ลง · ค้าง 1
  QR: tab([{ id: 2600031, name: "h", job: 3 }, { id: 2600032, name: "i", sh: "G9" }]),                                         // งานคอลัมน์ไกล · ค้าง 1
  PORTER: tab([{ id: 2600041, name: "j" }]),                                                                                    // ข้าม
  KE: tab([]),                                                                                                                  // ไม่มีคน → ไม่เตือน
};
const mp = [["MANPOWER 10 OCT 2026"]].concat(Object.keys(T).map(t => ["Team (" + t + ")"]));
const X = require("./fakexl.js");
const tabs = { MANPOWER: mp, ShiftDB: X.SHIFTDB }; for (const t of Object.keys(T)) tabs[t] = T[t];
const r = main(X.book(tabs), "Shared Documents/2026/10.OCT26/10OCT.xlsx");
const neu = r.batches.filter(b => b.list === "PAS_DataIssue").flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0]))).filter(x => x.category === "notfilled")
  .map(x => { const m = x.who.match(/(\d+)\/(\d+)/); return x.team + " " + m[1] + "/" + m[2]; }).sort();
const gs = (name, rows) => ({ getName: () => name, getLastRow: () => rows.length, getLastColumn: () => W, getRange: (r0, c0, nr, nc) => ({ getValues: () => rows.slice(0, nr).map(x => x.slice(0, nc)) }) });
const old = ctx.apTeamsNotFilled_({ getSheets: () => Object.keys(T).map(t => gs(t, T[t])) }).map(x => x.team + " " + x.filled + "/" + x.people).sort();
let bad = 0;
console.log("เดิม: " + old.join(" · ") + "\nใหม่: " + neu.join(" · "));
if (JSON.stringify(old) !== JSON.stringify(neu)) bad++;
console.log(bad ? bad + " FAILED" : "ALL PASSED (ทีมที่ยังลงไม่ครบ ตรงกับ apTeamsNotFilled_)"); process.exit(bad ? 1 : 0);
