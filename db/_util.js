'use strict';
// helper ร่วมของ importer ทั้งหมด (พ่น SQL, ไม่พึ่ง driver)
const fs = require('fs');
const esc = v => (v === null || v === undefined || v === '') ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
const num = v => { const n = Number(v); return Number.isFinite(n) ? String(n) : 'NULL'; };
const intOrNull = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? String(n) : 'NULL'; };
const int0 = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? String(n) : '0'; };
const bool = v => v ? 'TRUE' : 'FALSE';
function timeLit(v) {                       // "7:45"/"07:45"/"0745" → TIME literal ไม่งั้น NULL
  if (v === null || v === undefined) return 'NULL';
  const m = String(v).match(/(\d{1,2})[:.]?(\d{2})/); if (!m) return 'NULL';
  const h = +m[1], mi = +m[2]; if (h > 29 || mi > 59) return 'NULL';
  return "'" + String(h % 24).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ":00'";
}
function waitLit(v) {                        // "0:24" → INTERVAL
  const m = String(v || '').match(/(\d{1,2})[:.](\d{2})/); if (!m) return 'NULL';
  if (+m[1] === 0 && +m[2] === 0) return 'NULL';
  return "INTERVAL '" + (+m[1]) + " hours " + (+m[2]) + " minutes'";
}
const q = s => process.stdout.write(s + '\n');
const readInput = () => { const a = process.argv[2]; return (a && a !== '-') ? fs.readFileSync(a, 'utf8') : fs.readFileSync(0, 'utf8'); };
module.exports = { esc, num, intOrNull, int0, bool, timeLit, waitLit, q, readInput };
