declare namespace ExcelScript {
  interface Range { getValues(): (string|number|boolean)[][]; getTexts(): string[][]; getRowIndex(): number; getColumnIndex(): number; getRowCount(): number; getColumnCount(): number; }
  interface Worksheet { getRange(a:string): Range; getUsedRange(valuesOnly?: boolean): Range; getRangeByIndexes(r: number, c: number, nr: number, nc: number): Range; getName(): string; }
  interface Workbook { getWorksheet(n:string): Worksheet|undefined; getWorksheets(): Worksheet[]; }
}
