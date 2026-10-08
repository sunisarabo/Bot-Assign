declare namespace ExcelScript {
  interface Range { getValues(): (string|number|boolean)[][]; getTexts(): string[][]; }
  interface Worksheet { getRange(a:string): Range; getUsedRange(): Range; getName(): string; }
  interface Workbook { getWorksheet(n:string): Worksheet|undefined; getWorksheets(): Worksheet[]; }
}
