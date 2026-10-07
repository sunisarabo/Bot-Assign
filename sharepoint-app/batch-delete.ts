/*
 * batch-delete.ts — Office Script ตัวช่วย: รายการ ID → เนื้อ SharePoint $batch สำหรับลบ (≤100 แถว/ก้อน — ขนาดเดียวกับที่ PnP ใช้)
 *   ใช้ใน flow ก่อนนำเข้าวันเดิมซ้ำ (ลบแถวของ day_key นั้นใน PAS_Duty / PAS_Assignment / PAS_Manpower)
 *   รันกับไฟล์ Excel ใดก็ได้ (ไม่แตะ workbook) — ใน flow ใช้ไฟล์เวรตัวเดียวกับ import-roster
 *
 * พารามิเตอร์: list = ชื่อ List · ids = ข้อความ JSON ของ array ID เช่น "[12,13,14]"
 *              (ใน flow: string(body('Select_IDs'))) · siteUrl (ไม่บังคับ)
 * คืนค่า: { n, batches: [{ list, boundary, body, n }] }
 */
const SITE_DEL = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const DEL_SIZE = 100;

interface DelBatch { list: string; boundary: string; body: string; n: number }

function main(workbook: ExcelScript.Workbook, list: string, ids: string, siteUrl?: string): { n: number; batches: DelBatch[] } {
  const CRLF = "\r\n";
  const site = (siteUrl || SITE_DEL).replace(/\/$/, "");
  let arr: number[] = [];
  const parsed: (number | string | { ID?: number; Id?: number })[] = JSON.parse(ids || "[]");
  for (const x of parsed) {
    const v = typeof x === "object" ? (x.ID || x.Id || 0) : +x;
    if (v > 0) arr.push(v);
  }
  const batches: DelBatch[] = [];
  for (let i = 0; i < arr.length; i += DEL_SIZE) {
    const id = "del_" + list + "_" + (i / DEL_SIZE) + "_" + Math.floor(Math.random() * 1e9);
    const b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = arr.slice(i, i + DEL_SIZE);
    for (const itemId of chunk) {
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF +
        "DELETE " + site + "/_api/web/lists/getbytitle('" + list + "')/items(" + itemId + ") HTTP/1.1" + CRLF +
        "IF-MATCH: *" + CRLF + CRLF;
    }
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    batches.push({ list, boundary: b, body, n: chunk.length });
  }
  return { n: arr.length, batches };
}
