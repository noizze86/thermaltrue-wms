export interface XlsxSheet {
  name: string
  header: (string | number)[]
  rows: (string | number)[][]
}

export async function downloadXlsx(filename: string, sheets: XlsxSheet[]): Promise<void> {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows])
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}