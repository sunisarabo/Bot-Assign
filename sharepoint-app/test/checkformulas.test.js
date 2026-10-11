// check-formulas.ts — ตรวจ/ซ่อมสูตรไฟล์เวร (ข้อมูลจำลอง) · ตรวจกับไฟล์จริง 10 ต.ค. แล้ว: 99 รายการ แก้อัตโนมัติ 95 · ต้องตรวจเอง 4
const assert = require("assert");
const M = require(process.argv[2]);
// fake: setFormulaR1C1 → ค่า = calc(f, r) ถ้ากำหนด ไม่งั้น ""
function book(tabs, calc) {
  const sheets = {}, order = Object.keys(tabs);
  function mk(name, d) {
    const g = (a, r, c) => ((a[r] || [])[c] == null ? "" : a[r][c]);
    const put = (r, c, f1, f, t) => { (d.r1[r] = d.r1[r] || [])[c] = f1; (d.f[r] = d.f[r] || [])[c] = f; (d.t[r] = d.t[r] || [])[c] = t; };
    const rng = (r0, c0, nr, nc) => {
      const grid = a => { const o = []; for (let r = r0; r < r0 + nr; r++) { const row = []; for (let c = c0; c < c0 + nc; c++) row.push(g(a, r, c)); o.push(row); } return o; };
      return { getValues: () => grid(d.t), getTexts: () => grid(d.t), getFormulas: () => grid(d.f), getFormulasR1C1: () => grid(d.r1), getText: () => g(d.t, r0, c0),
        getRowIndex: () => r0, getColumnIndex: () => c0, getRowCount: () => nr, getColumnCount: () => nc,
        setFormulaR1C1: f => put(r0, c0, f, f, calc ? calc(name, r0, c0, f) : ""),
        setFormulas: rows => rows.forEach((row, i) => row.forEach((f, j) => put(r0 + i, c0 + j, f, f, ""))),
        setValue: v => put(r0, c0, String(v), String(v), String(v)),
        setValues: v => v.forEach((row, i) => row.forEach((x, j) => put(r0 + i, c0 + j, String(x), String(x), String(x)))),
        getFormat: () => ({ getFont: () => ({ setBold() {} }), getFill: () => ({ setColor() {} }), autofitColumns() {} }) };
    };
    return { getName: () => name, getUsedRange: () => rng(0, 0, d.t.length, Math.max(1, ...d.t.map(r => r.length))),
      getRangeByIndexes: (r, c, nr, nc) => rng(r, c, nr, nc), getRange: () => rng(0, 0, d.t.length, 6), delete: () => { delete sheets[name]; order.splice(order.indexOf(name), 1); } };
  }
  for (const n of order) sheets[n] = mk(n, tabs[n]);
  return { tabs, getWorksheet: n => sheets[n], getWorksheets: () => order.map(n => sheets[n]),
    addWorksheet: n => { tabs[n] = { f: [], t: [], r1: [] }; sheets[n] = mk(n, tabs[n]); order.push(n); return sheets[n]; } };
}
const IN = '=IF(RC4="","",IFERROR(VLOOKUP(RC4,SHIFTDB,2,0),""))', HRS = '=IF(OR(RC8="",RC9=""),"",IFERROR(MOD(RC9-RC8,1)*24,""))';
const SHIFT = { E9: "05:00", F9: "06:00" };
// แถว: [A ID, B pos, C NAME, D code, E IN(สูตร), …, H RS in, I RS out, J ชม.(สูตร)]
function tab() {
  const f = [], t = [], r1 = [];
  const row = (cells) => { const fr = [], tr = [], rr = []; cells.forEach(([v, txt]) => { fr.push(v); rr.push(v); tr.push(txt == null ? v : txt); }); f.push(fr); t.push(tr); r1.push(rr); };
  row([["TEAM X"]]); row([[""]]);
  row([["ID"], ["Position"], ["NAME"], ["SHIFT"], ["IN"], ["OUT"], ["HRS"], ["RS IN"], ["RS OUT"], ["RS HRS"]]);
  const P = (id, nm, code, e, j) => row([[id], ["PSA"], [nm], [code], e, ["="], ["="], ["06:00"], ["10:00"], j]);
  P("1000001", "ALPHA", "E9", [IN, "05:00"], [HRS, "4"]);
  P("1000002", "BRAVO", "F9", [IN, "06:00"], ["", ""]);                 // J สูตรหาย
  P("1000003", "CHARLIE", "E9", ["05:00"], [HRS, "4"]);                 // E พิมพ์ทับ (ค่าเท่าสูตร)
  P("1000004", "DELTA", "P10", ["16:00"], [HRS, "4"]);                   // E พิมพ์ทับ (รหัสไม่มีใน ShiftDB)
  P("1000005", "ECHO", "E9", [IN, "05:00"], [HRS, "4"]);
  row([["จำนวนคนที่ลงจ็อบ / บล็อก →"]]);
  row([["NO."], ["FLIGHT"]]);
  row([["1"], ['=IF(OR(T$3="",T$3="หมายเลขไฟลท์ 1"),"",T$3)']]);
  row([["2"], ['=IF(OR(#REF!="",#REF!="หมายเลขไฟลท์ 2"),"",#REF!)', "#REF!"]]);
  row([["3"], ['=IF(OR(X$3="",X$3="หมายเลขไฟลท์ 3"),"",X$3)']]);
  return { f, t, r1 };
}
const calc = (name, r, c, f) => {
  const d = W.tabs[name]; const code = d.t[r][3];
  if (f === IN) return SHIFT[code] || "";
  if (f === HRS) return "4";
  return "";
};
let W = book({ "TEAM X": tab(), MANPOWER: { f: [["MANPOWER"]], t: [["MANPOWER"]], r1: [["MANPOWER"]] } }, calc);
const c = M.main(W, "check");
assert.deepStrictEqual([c.mode, c.issues, c.fixed], ["check", 4, 0]);
assert.ok(W.tabs["ตรวจสูตร"].t.some(r => r[1] === "J5" && /สูตรหาย/.test(r[2])));
console.log("OK โหมด check: พบ สูตรหาย · พิมพ์ทับ 2 ช่อง · #REF! สรุปไฟลท์ — ไม่แก้ไฟล์");
assert.strictEqual(W.tabs["TEAM X"].f[4][9], "");
const r = M.main(W, "fix"), d = W.tabs["TEAM X"];
assert.deepStrictEqual([r.issues, r.fixed, r.review], [4, 3, 1]);
assert.strictEqual(d.r1[4][9], HRS);                                     // ใส่สูตรคืน
assert.strictEqual(d.r1[5][4], IN);                                      // พิมพ์ทับแต่ค่าเท่าสูตร → เก็บสูตร
assert.deepStrictEqual([d.r1[6][4], d.t[6][4]], ["16:00", "16:00"]);     // รหัสไม่มีใน ShiftDB → คงค่าที่พิมพ์
assert.ok(W.tabs["ตรวจสูตร"].t.some(r2 => r2[1] === "E7" && r2[5] === "ต้องตรวจเอง" && /P10/.test(r2[4])));
assert.strictEqual(d.f[11][1], '=IF(OR(X$3="",ISNUMBER(SEARCH("หมายเลขไฟลท์",X$3))),"",X$3)');   // แถว 2 → คอลัมน์ไฟลท์ที่ 2
assert.ok(/AB\$3/.test(d.f[12][1]) && /T\$4/.test(d.f[10][2]) && /V\$4/.test(d.f[10][3]));
console.log("OK โหมด fix: ใส่สูตรคืน · เก็บค่าที่พิมพ์เมื่อไม่ตรงสูตร (รายงานให้ตรวจ) · สร้างตารางสรุปไฟลท์ใหม่ตามตำแหน่ง");
console.log("ALL PASSED (check-formulas)");
