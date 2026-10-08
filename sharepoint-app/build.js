// node sharepoint-app/build.js — ฝัง lists.def.json ลง provision-lists.js (ไฟล์เดียว วางใน Console ได้)
const fs = require("fs"), path = require("path");
const dir = __dirname;
const def = JSON.parse(fs.readFileSync(path.join(dir, "lists.def.json"), "utf8"));
const src = fs.readFileSync(path.join(dir, "provision-lists.src.js"), "utf8");
const out = src.replace("/*__DEF__*/ null", JSON.stringify(def));
if (out === src) throw new Error("placeholder /*__DEF__*/ not found");
fs.writeFileSync(path.join(dir, "provision-lists.js"), out);
console.log("wrote provision-lists.js (" + def.lists.length + " lists)");

// import-advroster.ts = import-roster.ts (เครื่องคำนวณเดียวกัน) แต่ main = advMain (จัดล่วงหน้า) — Office Scripts import ข้ามไฟล์ไม่ได้
const ros = fs.readFileSync(path.join(dir, "import-roster.ts"), "utf8");
const head = "// ⚠️ ไฟล์นี้สร้างอัตโนมัติจาก import-roster.ts ด้วย `node build.js` — อย่าแก้ตรงนี้ (แก้ที่ import-roster.ts แล้ว build ใหม่)\n" +
  "// Office Script: จัดล่วงหน้า — อ่านไฟล์ ROSTER ล่วงหน้า + ไฟลท์ (PAS_Flights) + พนักงาน (PAS_Employees) → PAS_AdvPlan / PAS_AdvRoster (ดู FLOW-advance.md)\n";
const adv = head + ros.replace(/^function main\(/m, "function rosterMain(").replace(/^function advMain\(/m, "function main(");
if (adv.indexOf("function rosterMain(") < 0 || adv.indexOf("function main(workbook: ExcelScript.Workbook, fromDay") < 0) throw new Error("rename main failed");
fs.writeFileSync(path.join(dir, "import-advroster.ts"), adv);
console.log("wrote import-advroster.ts");
