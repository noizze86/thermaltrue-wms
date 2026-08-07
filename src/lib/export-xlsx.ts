export interface XlsxSheet {
  name: string
  header: (string | number)[]
  rows: (string | number)[][]
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

async function loadXlsx(): Promise<Record<string, unknown>> {
  const mod = (await import("xlsx")) as Record<string, unknown>
  if (mod.utils) return mod
  const def = mod["default"] as Record<string, unknown> | undefined
  if (def && def.utils) return def
  throw new Error("xlsx module shape not recognized")
}

export async function downloadXlsx(filename: string, sheets: XlsxSheet[]): Promise<void> {
  const XLSX = await loadXlsx()
  const utils = XLSX.utils as {
    book_new: () => unknown
    aoa_to_sheet: (data: (string | number)[][]) => unknown
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void
  }
  const wb = utils.book_new()
  for (const s of sheets) {
    const ws = utils.aoa_to_sheet([s.header, ...s.rows])
    utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  const write = XLSX.write as (wb: unknown, opts: unknown) => ArrayBuffer
  const out = write(wb, { bookType: "xlsx", type: "array" })
  const blob = new Blob([out], { type: XLSX_MIME })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}