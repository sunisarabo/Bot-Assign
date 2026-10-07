// import-master: Total + BKK Batch → upsert PAS_Employees
const { main } = require(process.argv[2]);
const sheet = (name, rows) => ({ getName: () => name, getRange: () => ({ getValues: () => rows }), getUsedRange: () => ({ getValues: () => rows }) });
const H = ["#", "รหัส", "ทีม", "คำนำหน้า", "ชื่อ", "สกุล", "แผนก", "ตำแหน่ง", "เริ่มงาน", "", "Name", "Surname", "พ้นสภาพ", "สถานะ"];
const row = (code, team, th, dept, pos, st, resign) => [1, code, team, "นาย", th, "ใจดี", dept, pos, 45000, "", th.toUpperCase(), "JAIDEE", resign || "", st];
const total = [H,
  row("2607384", "EY", "สมชาย", "การโดยสาร ภูเก็ต", "Passenger Services Agent", "Active"),
  row("2607385", "SQ", "วิชัย", "การโดยสาร ภูเก็ต", "Act. PSS", "Resigned", 46000),
  row("2607386", "LL", "สมหญิง", "ติดตามสัมภาระ", "Senior Agent", "Active"),
  row("2607387", "GLOBEX", "มานะ", "การโดยสาร ภูเก็ต", "Agent", "Active"),
  row("2607388", "EK", "ปิติ", "การโดยสาร ภูเก็ต", "Agent", "", 45100),         // ไม่มีสถานะ + พ้นสภาพแล้ว → RESIGNED
  ["", "หัวข้อย่อย", "", "", "", "", "", "", "", "", "", "", "", ""]];
const bkk = [["รายชื่อ BKK"], ["ลำดับ", "รหัส", "ทีม", "คำนำหน้า", "ชื่อ", "สกุล", "แผนก", "ตำแหน่ง"],
  [1, "B2520045", "SQ", "", "SOFROP", "", "การโดยสาร", "Passenger Services Agent"],
  [2, "2607384", "EY", "", "สมชาย", "", "", ""]];
const wb = (tabs) => ({ getWorksheet: n => tabs[n], getWorksheets: () => Object.values(tabs) });
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };

const r1 = main(wb({ Total: sheet("Total", total), "BKK Batch 1": sheet("BKK Batch 1", bkk) }), "Shared Documents/2026/00.Master.xlsx", "[]");
console.log(JSON.stringify(r1.counts));
ok(r1.status === "ok" && r1.counts.total === 6, "6 คน (5 Total + 1 BKK ใหม่)");
ok(r1.counts.created === 6 && r1.counts.resigned === 2, "สร้างใหม่ 6 · ลาออก 2");
ok(r1.counts.bkk === 2 && r1.counts.globex === 1 && r1.counts.ll === 1, "BKK 2 · Globex 1 · LL 1");
const body = r1.batches[0].body;
ok(/"Title":"2520045".*"source":"BKK"/.test(body) && /"Title":"2607384".*"source":"BKK"/.test(body), "B-prefix ตัด B · คนใน Total ที่อยู่ BKK Batch → source BKK");
ok(/"Title":"2607385"[^\n]*"status":"RESIGNED"[^\n]*"resign_date":"2025-12-09"/.test(body), "Resigned + วันที่ serial → ISO");
ok(/"Title":"2607386"[^\n]*"dept":"LL"[^\n]*"pos_group":"SNR"/.test(body), "LL + pos_group");

// รอบสอง: ไม่มีอะไรเปลี่ยน → ไม่มีคำสั่ง
const rows = [...body.matchAll(/\{"Title":"(\d+)"[^\n]*"row_hash":"([0-9a-f]+)"\}/g)].map((m, i) => ({ ID: i + 1, Title: m[1], row_hash: m[2] }));
const r2 = main(wb({ Total: sheet("Total", total), "BKK Batch 1": sheet("BKK Batch 1", bkk) }), "x", JSON.stringify(rows));
ok(r2.counts.unchanged === 6 && r2.batches.length === 0, "รันซ้ำไม่เปลี่ยน → 0 คำสั่ง");
// เปลี่ยนทีม 1 คน + คนหายจากไฟล์ 1 คน
const t3 = total.map(r => r.slice()); t3[1][2] = "QR"; t3.splice(4, 1);
const r3 = main(wb({ Total: sheet("Total", t3), "BKK Batch 1": sheet("BKK Batch 1", bkk) }), "x", JSON.stringify(rows));
ok(r3.counts.updated === 1 && r3.counts.deleted === 1, "แก้ 1 (PATCH) · ลบ 1 (DELETE)");
ok(/PATCH .*items\(\d+\) HTTP\/1.1/.test(r3.batches[0].body) && /DELETE .*items\(\d+\)/.test(r3.batches[0].body), "batch มี PATCH + DELETE");
// กันล้างรายชื่อ: ไฟล์เหลือ 1 คนแต่ List เดิม 30 คน
const many = Array.from({ length: 30 }, (_, i) => ({ ID: i + 1, Title: String(2700000 + i), row_hash: "x" }));
const r4 = main(wb({ Total: sheet("Total", total.slice(0, 2)) }), "x", JSON.stringify(many));
ok(r4.status === "skipped" && r4.batches.length === 0, "ลบเกิน 50% → หยุด: " + r4.reason);
ok(main(wb({ Sheet1: sheet("Sheet1", [[1]]) }), "x", "[]").status === "skipped", "ไม่มีชีต Total → skipped");
// ไฟล์ Manpower รูปแบบอื่น: ไม่มีชีต Total · หัวอยู่แถว 3 · ชื่อ-สกุลรวมคอลัมน์เดียว · ลำดับคอลัมน์ต่าง
const alt = [["PAX MANPOWER 2026"], [""], ["ลำดับ", "ชื่อ-สกุล", "รหัสพนักงาน", "ตำแหน่ง", "ทีม", "แผนก", "สถานะ"],
  [1, "นายสมชาย ใจดี", "2607384", "Passenger Services Agent", "EY", "การโดยสาร ภูเก็ต", "Active"],
  [2, "นางสาวสมศรี ดีมาก", 2607399, "PSS", "TR", "การโดยสาร ภูเก็ต", "ลาออก"]];
const r5 = main(wb({ "รายชื่อ": sheet("รายชื่อ", alt) }), "PS-Manpower/Manpower.xlsx", "[]");
ok(r5.status === "ok" && r5.counts.total === 2 && r5.counts.resigned === 1, "หัวตาราง/ชีตต่างรูปแบบ → อ่านได้ 2 คน (ลาออก 1)");
ok(/"Title":"2607384","name_th":"นายสมชาย ใจดี","name_en":"","team":"EY","dept":"PSA","position":"Passenger Services Agent","pos_group":"PSA"/.test(r5.batches[0].body), "แมปคอลัมน์ตามหัว");
ok(/"Title":"2607399"[^\n]*"pos_group":"PSS"/.test(r5.batches[0].body), "รหัสเป็นตัวเลข + pos_group PSS");
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
