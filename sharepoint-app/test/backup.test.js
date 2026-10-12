// backup-day.ts — แท็บรายวันในไฟล์รายเดือน + INDEX (ข้อมูลจำลอง)
// fake: เก็บค่าตามที่เขียน (มี ' นำหน้า) · getValues คืนแบบ Excel (ไม่มี ')
const assert = require("assert");
const M = require(process.argv[2]);
function book() {
  const order = [], data = {};
  const fmt = () => ({ getFont: () => ({ setBold() {}, setColor() {} }), getFill: () => ({ setColor() {} }), autofitColumns() {} });
  function mk(name) {
    const d = data[name];
    const rows = () => d.length, cols = () => Math.max(0, ...d.map((r) => (r ? r.length : 0)));
    const rng = (r0, c0, nr, nc) => ({
      getValues: () => { const o = []; for (let r = r0; r < r0 + nr; r++) { const row = []; for (let c = c0; c < c0 + nc; c++) { const v = ((d[r] || [])[c]) ?? ""; row.push(typeof v === "string" && v[0] === "'" ? v.slice(1) : v); } o.push(row); } return o; },
      getRowIndex: () => r0, getRowCount: () => nr, getColumnCount: () => nc,
      setValue: (v) => { (d[r0] = d[r0] || [])[c0] = v; },
      setValues: (v) => v.forEach((row, i) => { assert.strictEqual(row.length, nc); row.forEach((x, j) => { (d[r0 + i] = d[r0 + i] || [])[c0 + j] = x; }); }),
      clear: () => { d.length = 0; }, getFormat: fmt,
    });
    return { getName: () => name, getRangeByIndexes: rng,
      getUsedRange: () => (rows() && cols() ? rng(0, 0, rows(), cols()) : undefined),
      delete: () => { order.splice(order.indexOf(name), 1); delete data[name]; },
      setPosition: (p) => { order.splice(order.indexOf(name), 1); order.splice(p, 0, name); } };
  }
  const add = (n) => { data[n] = []; order.push(n); return mk(n); };
  add("Sheet1");
  return { data, order, addWorksheet: add, getWorksheet: (n) => (data[n] ? mk(n) : undefined), getWorksheets: () => order.map(mk) };
}
const wb = book();
const duty = { value: [
  { "odata.type": "x", Id: 5, ID: 5, Title: "2026-10-10|EY|1000001", day_key: "2026-10-10", emp_code: "0012345", shift_start: "05:00", util_pct: 62, is_support: false, ot_hours: null, gantt_json: '{"b":[]}', bucket: { Value: "WORKING" } },
  { ID: 6, Title: "2026-10-10|EY|1000002", day_key: "2026-10-10", emp_code: "1000002", shift_start: "06:00", util_pct: 0, is_support: true, ac_issue: "=SUM(A1)", gantt_json: "x".repeat(40000) },
] };
let r = M.main(wb, "2026-10-10", "PAS_Manpower", JSON.stringify([{ ID: 1, team: "EY", total: 30 }]), true);
assert.deepStrictEqual(r, { status: "ok", sheet: "10OCT", list: "PAS_Manpower", rows: 1, cols: 3 });
r = M.main(wb, "2026-10-10", "PAS_Duty", JSON.stringify(duty), false);
assert.strictEqual(r.rows, 2);
const t = wb.data["10OCT"];
assert.ok(String(t[0][0]).includes("PAS_Manpower · 1 แถว"));
assert.deepStrictEqual(t[1], ["'ID", "'team", "'total"]);
assert.deepStrictEqual(t[2], [1, "'EY", 30]);
assert.strictEqual(t[3], undefined);                       // เว้น 1 แถว
assert.ok(String(t[4][0]).includes("PAS_Duty · 2 แถว"));
const H = t[5].map((x) => x.slice(1));
assert.ok(!H.includes("odata.type") && !H.includes("Id") && H.includes("ID") && H.includes("ac_issue"));
const row = (i, k) => t[6 + i][H.indexOf(k)];
assert.strictEqual(row(0, "emp_code"), "'0012345");          // เลข 0 นำหน้าไม่หาย
assert.strictEqual(row(0, "shift_start"), "'05:00");         // ไม่แปลงเป็นเวลา
assert.strictEqual(row(0, "is_support"), false);
assert.strictEqual(row(0, "ot_hours"), "");
assert.strictEqual(row(0, "bucket"), "'WORKING");            // Choice แบบมี metadata
assert.strictEqual(row(1, "ac_issue"), "'=SUM(A1)");         // ไม่กลายเป็นสูตร
assert.ok(row(1, "gantt_json").length <= 32002);             // เพดานเซลล์ Excel
assert.deepStrictEqual(wb.order, ["INDEX", "10OCT"]);       // Sheet1 ว่างถูกลบ
// วันที่ 2 ก่อนหน้า → แท็บเรียงตามวัน · INDEX เรียงตามวัน + ลำดับ List
M.main(wb, "2026-10-09", "PAS_Duty", "[]", true);
M.main(wb, "2026-10-09", "PAS_Manpower", "[]", false);
assert.deepStrictEqual(wb.order, ["INDEX", "09OCT", "10OCT"]);
assert.ok(String(wb.data["09OCT"][1][0]).includes("ไม่มีข้อมูล"));
// นำเข้าวันเดิมซ้ำ → แท็บถูกเขียนใหม่ ไม่ซ้อน
M.main(wb, "2026-10-10", "PAS_Manpower", JSON.stringify([{ ID: 1, team: "EY", total: 31 }]), true);
assert.strictEqual(wb.data["10OCT"].length, 3);
const ix = wb.data.INDEX.map((r) => r.slice(0, 4));
assert.deepStrictEqual(ix, [["วันที่", "แท็บ", "List", "แถว"],
  ["'2026-10-09", "09OCT", "PAS_Manpower", 0], ["'2026-10-09", "09OCT", "PAS_Duty", 0], ["'2026-10-10", "10OCT", "PAS_Manpower", 1]]);
assert.strictEqual(M.main(wb, "10/10/2026", "PAS_Duty", "[]", true).status, "error");
console.log("backup-day: tab/day · INDEX · text-safe cells · rewrite OK");
