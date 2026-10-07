// node sharepoint-app/build.js — ฝัง lists.def.json ลง provision-lists.js (ไฟล์เดียว วางใน Console ได้)
const fs = require("fs"), path = require("path");
const dir = __dirname;
const def = JSON.parse(fs.readFileSync(path.join(dir, "lists.def.json"), "utf8"));
const src = fs.readFileSync(path.join(dir, "provision-lists.src.js"), "utf8");
const out = src.replace("/*__DEF__*/ null", JSON.stringify(def));
if (out === src) throw new Error("placeholder /*__DEF__*/ not found");
fs.writeFileSync(path.join(dir, "provision-lists.js"), out);
console.log("wrote provision-lists.js (" + def.lists.length + " lists)");
