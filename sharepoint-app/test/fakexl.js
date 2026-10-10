// Fake ExcelScript workbook for offline tests: values as given, texts = String(value)
function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function parse(a) { const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/); return { c0: colNum(m[1]), r0: +m[2] - 1, c1: m[3] ? colNum(m[3]) : colNum(m[1]), r1: m[4] ? +m[4] - 1 : +m[2] - 1 }; }
function sheet(name, rows) {
  const R = rows.length, C = Math.max(1, ...rows.map(r => r.length));
  const cell = (r, c) => { const v = (rows[r] || [])[c]; return v === undefined || v === null ? "" : v; };
  const rng = (r0, c0, nr, nc) => {
    const g = f => { const out = []; for (let r = r0; r < r0 + nr; r++) { const row = []; for (let c = c0; c < c0 + nc; c++) row.push(f(cell(r, c))); out.push(row); } return out; };
    return { getValues: () => g(v => v), getTexts: () => g(v => String(v)), getRowIndex: () => r0, getColumnIndex: () => c0, getRowCount: () => nr, getColumnCount: () => nc };
  };
  return { getName: () => name, getRange: a => { const p = parse(a); return rng(p.r0, p.c0, p.r1 - p.r0 + 1, p.c1 - p.c0 + 1); },
    getUsedRange: () => (R ? rng(0, 0, R, C) : undefined), getRangeByIndexes: (r, c, nr, nc) => rng(r, c, nr, nc) };
}
function book(tabs) { const s = {}; for (const k of Object.keys(tabs)) s[k] = sheet(k, tabs[k]); return { getWorksheet: n => s[n], getWorksheets: () => Object.values(s) }; }
// ShiftDB มาตรฐานสำหรับ fixture: รหัสกะ → เวลา
const SHIFTDB = [["CODE", "IN", "OUT", "HRS"], ["E9", "05:00", "14:00", 9], ["F9", "06:00", "15:00", 9], ["G9", "07:00", "16:00", 9], ["J9", "10:00", "19:00", 9], ["F12", "06:00", "18:00", 12]];
// หัวตารางแท็บทีมแบบไฟล์จริง (แถว 3) — A=ID B=Position C=NAME D=SHIFT … K–M OT ก่อนกะ · N–P OT หลังกะ · Q STATUS · R REMARK · S FLIGHT · T… ไฟลท์
const W = 44;
function header(flights) {
  const h = Array(W).fill(""); ["ID", "Position", "NAME", "SHIFT", "ON DUTY", "", "", "RE-SKED", "", "", "OT ก่อนกะ (หน้า)", "", "", "OT หลังกะ (หลัง)", "", "", "STATUS", "REMARK", "FLIGHT"].forEach((x, i) => h[i] = x);
  const st = Array(W).fill(""), op = Array(W).fill(""); st[18] = "STA / STD"; op[18] = "OP / CL";
  (flights || []).forEach((f, i) => { const b = 19 + i * 4; h[b] = f.code; if (f.sta) st[b] = "A : " + f.sta; if (f.std) st[b + 2] = "D : " + f.std; });
  return [h, st, op];
}
module.exports = { sheet, book, SHIFTDB, header, W };
