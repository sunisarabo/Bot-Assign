/*
 * office-script-replace-code.ts — เปลี่ยน "รหัสพนักงาน" ในไฟล์เวร (หลายวันได้)
 *   แก้เฉพาะช่องที่ค่าตรงรหัสเก่าเป๊ะ → ใส่รหัสใหม่ (ไม่ทับสูตร/ชื่อ)
 *   รับ parameter: oldCode, newCode  → เรียกจาก Power Automate วนทุกไฟล์ได้
 *
 * ใช้เดี่ยว (ทดสอบ 1 ไฟล์): แก้ค่า DEFAULT ด้านล่าง แล้ว Run
 * ใช้หลายวัน: Power Automate → Run script → ใส่ oldCode/newCode เป็น input → วนโฟลเดอร์เดือน
 *
 * คืนค่า = จำนวนช่องที่แก้ (ไว้เช็กว่าเจอ/ไม่เจอในไฟล์นั้น)
 */
function main(
  workbook: ExcelScript.Workbook,
  oldCode: string = "2520045",     // รหัสเก่า (ค่า default เผื่อรันเดี่ยว)
  newCode: string = "2607280"      // รหัสใหม่
): number {
  const oldStr = String(oldCode).trim();
  const oldNum = Number(oldStr);
  const newNum = Number(String(newCode).trim());
  const newVal: (string | number) = isNaN(newNum) ? String(newCode).trim() : newNum;

  let count = 0;
  for (const ws of workbook.getWorksheets()) {
    const used = ws.getUsedRange();
    if (!used) continue;
    const vals = used.getValues();
    for (let r = 0; r < vals.length; r++) {
      for (let c = 0; c < vals[r].length; c++) {
        const v = vals[r][c];
        const match =
          (typeof v === "number" && !isNaN(oldNum) && v === oldNum) ||
          (typeof v === "string" && v.trim() === oldStr);
        if (match) {
          used.getCell(r, c).setValue(newVal);   // แก้เฉพาะช่องนี้ ไม่แตะช่องอื่น/สูตร
          count++;
        }
      }
    }
  }
  console.log("เปลี่ยน " + oldStr + " → " + String(newCode) + " : " + count + " ช่อง");
  return count;
}
