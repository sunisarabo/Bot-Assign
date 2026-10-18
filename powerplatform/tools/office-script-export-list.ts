/**
 * office-script-export-list.ts
 * เขียนแถวข้อมูล (จาก Power Automate) ลงชีตเดียวรวดเดียว (setValues ก้อนเดียว = เร็วมากกับลิสต์ใหญ่)
 * ใช้คู่กับ flow: Get items (วนหน้า nextLink) → Select เป็น 2D array → Run script → เซฟไฟล์ = backup
 *
 * Power Automate: "Run script" ส่งพารามิเตอร์:
 *   sheetName : ชื่อชีต (เช่น "PAS_Porter")
 *   header    : string[]      หัวคอลัมน์
 *   rows      : string[][]    ข้อมูล (แต่ละแถว = ค่าตามลำดับ header)
 * คืน: จำนวนแถวที่เขียน
 *
 * หมายเหตุขนาด: พารามิเตอร์ Run script ใหญ่ได้จำกัด (~ไม่กี่ MB) → ลิสต์ใหญ่มาก
 * ให้ flow "ส่งเป็นก้อน" (chunk ~10,000 แถว/ครั้ง append=true) หรือ backup แยกตาม month_key
 */
function main(
  workbook: ExcelScript.Workbook,
  sheetName: string,
  header: string[],
  rows: string[][],
  append: boolean = false
): number {
  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    sheet = workbook.addWorksheet(sheetName);
  }

  let startRow = 0;
  if (!append) {
    sheet.getUsedRange()?.clear(ExcelScript.ClearApplyTo.all);
    // หัวคอลัมน์
    if (header && header.length > 0) {
      sheet.getRangeByIndexes(0, 0, 1, header.length).setValues([header]);
      startRow = 1;
    }
  } else {
    const used = sheet.getUsedRange();
    startRow = used ? used.getRowCount() : 0;
    if (startRow === 0 && header && header.length > 0) {
      sheet.getRangeByIndexes(0, 0, 1, header.length).setValues([header]);
      startRow = 1;
    }
  }

  if (rows && rows.length > 0) {
    const cols = header && header.length > 0 ? header.length : rows[0].length;
    // normalize ให้ทุกแถวยาวเท่ากัน (กัน setValues error)
    const norm = rows.map(r => {
      const a = r.slice(0, cols);
      while (a.length < cols) a.push("");
      return a;
    });
    // เขียนรวดเดียว
    sheet.getRangeByIndexes(startRow, 0, norm.length, cols).setValues(norm);
  }
  return rows ? rows.length : 0;
}
