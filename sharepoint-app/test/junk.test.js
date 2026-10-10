// แถวที่ไม่ใช่พนักงาน (ตารางเวลาไฟลท์ / #REF! / "-") ต้องไม่ถูกนำเข้า PAS_Duty
const { main } = require(process.argv[2]);
const { sheet, book, header } = require("./fakexl.js");
const W = 44, blank = () => Array(W).fill("");
const mp = [["MANPOWER"], ["Team (SQ)", 3, 0, 0, 0, 0, 0, 0, 0, 3]];
const sq = [blank(), blank()].concat(header([{ code: "SQ726", sta: "08:35", std: "10:50" }]));
const row = (id, name) => { const p = blank(); p[0] = id; p[2] = name; p[4] = "06:00"; p[6] = 9; return p; };
sq.push(row(2303180, "CHIDAPHA"));       // พนักงานจริง
sq.push(row(2600001, "สมหญิง"));          // ชื่อไทย
sq.push(row(1, "08:35"));                 // ตารางเวลาไฟลท์
sq.push(row(2, "10:50"));
sq.push(row(4, "#REF!"));
sq.push(row(5, "-"));
sq.push(row(2405245, "#REF!"));           // รหัสจริงแต่ชื่อเสีย → ข้าม
const wb = book({"MANPOWER": mp, "SQ": sq});
const rows = (r, list) => r.batches.filter(b => b.list === list).flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };
const d = rows(main(wb, "Shared Documents/2026/10.OCT26/08OCT.xlsx"), "PAS_Duty");
ok(d.length === 2, "เหลือเฉพาะพนักงานจริง 2 แถว → " + d.length);
ok(d.every(x => /^\d{4,}$/.test(x.emp_code)), "ไม่มีรหัส 1–3 หลัก");
ok(!d.some(x => /^[#\-\d]/.test(x.emp_name)), "ไม่มีชื่อ #REF! / - / เวลา");
if (bad) { console.log(bad + " failed"); process.exit(1); }
