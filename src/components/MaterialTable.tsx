import { useState, useMemo, useEffect, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Checkbox } from "./ui/checkbox"
import { Select } from "./ui/select"
import { getCategories, getWarehouses } from "../api"
import type { Material } from "../api"

export interface MaterialTableFilters {
  search: string
  category_id: string
  warehouse_id: string
}

interface MaterialTableProps {
  data: Material[]
  onSelectionChange?: (selected: string[]) => void
  onEdit?: (material: Material) => void
  onDelete?: (id: string) => void
  onFilterChange?: (filters: MaterialTableFilters) => void
  loading?: boolean
}

export default function MaterialTable({
  data,
  onSelectionChange,
  onEdit,
  onDelete,
  onFilterChange,
  loading,
}: MaterialTableProps) {
  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const pageSize = 20

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  })
  const { data: warehouses } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => getWarehouses(),
  })

  useEffect(() => {
    const t = setTimeout(() => {
      onFilterChange?.({ search, category_id: categoryId, warehouse_id: warehouseId })
    }, 300)
    return () => clearTimeout(t)
  }, [search, categoryId, warehouseId, onFilterChange])

  const sorted = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortKey]
      const bVal = (b as unknown as Record<string, unknown>)[sortKey]
      if (aVal == null) return 1
      if (bVal == null) return -1
      const cmp = typeof aVal === "string"
        ? (aVal as string).localeCompare(bVal as string)
        : (aVal as number) - (bVal as number)
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageData = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onSelectionChange?.(Array.from(next))
      return next
    })
  }, [onSelectionChange])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === pageData.length) {
        onSelectionChange?.([])
        return new Set()
      }
      const all = new Set(pageData.map((m) => m.id))
      onSelectionChange?.(Array.from(all))
      return all
    })
  }, [pageData, onSelectionChange])

  const columns = [
    { key: "sku", label: "SKU", sortable: true },
    { key: "name", label: "Name", sortable: true },
    { key: "category_name", label: "Category" },
    { key: "quantity", label: "Qty", sortable: true },
    { key: "price", label: "Price", sortable: true },
    { key: "min_stock", label: "Min Stock" },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search materials..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            className="pl-8"
          />
        </div>
        <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(0) }} className="w-44">
          <option value="">All Categories</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(0) }} className="w-44">
          <option value="">All Warehouses</option>
          {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
      ) : data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No materials found</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === pageData.length && pageData.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  {columns.map((col) => (
                    <TableHead key={col.key}>
                      {col.sortable ? (
                        <button
                          onClick={() => handleSort(col.key)}
                          className="flex items-center gap-1 font-medium hover:text-foreground"
                        >
                          {col.label}
                          {sortKey === col.key ? (
                            sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </button>
                      ) : (
                        col.label
                      )}
                    </TableHead>
                  ))}
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageData.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleSelect(item.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.category_name || item.category_id || "-"}
                    </TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{item.price.toLocaleString()}</TableCell>
                    <TableCell>{item.min_stock}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {onEdit && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)}>
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </Button>
                        )}
                        {onDelete && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(item.id)}>
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} of {sorted.length}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
