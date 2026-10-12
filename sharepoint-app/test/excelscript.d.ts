declare namespace ExcelScript {
  interface RangeFont { setBold(b: boolean): void; setColor(c: string): void; }
  interface RangeFill { setColor(c: string): void; }
  interface RangeFormat { getFont(): RangeFont; getFill(): RangeFill; autofitColumns(): void; }
  interface Range { getValues(): (string|number|boolean)[][]; getTexts(): string[][]; getRowIndex(): number; getColumnIndex(): number; getRowCount(): number; getColumnCount(): number;
    getFormulas(): string[][]; getFormulasR1C1(): string[][]; getText(): string; setFormulaR1C1(f: string): void; setFormulas(f: string[][]): void;
    setValue(v: string | number | boolean): void; setValues(v: (string | number | boolean)[][]): void; getFormat(): RangeFormat; clear(): void; }
  interface Worksheet { getRange(a:string): Range; getUsedRange(valuesOnly?: boolean): Range; getRangeByIndexes(r: number, c: number, nr: number, nc: number): Range; getName(): string; delete(): void; setPosition(p: number): void; }
  interface Workbook { getWorksheet(n:string): Worksheet|undefined; getWorksheets(): Worksheet[]; addWorksheet(n?: string): Worksheet; }
}
