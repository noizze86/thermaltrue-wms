import { useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { getMaterials, getWarehouses } from "../api"
import type { Material, Warehouse } from "../api"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Select } from "./ui/select"
import { Card, CardContent } from "./ui/card"
import { Search, X } from "lucide-react"

interface TransactionFormData {
  type: string
  warehouse_id: string
  material_id: string
  material_name: string
  quantity: number
  notes: string
}

interface TransactionFormProps {
  initialData?: Partial<TransactionFormData>
  onSubmit: (data: TransactionFormData) => void
  onCancel: () => void
}

export type { TransactionFormData }

export default function TransactionForm({ initialData, onSubmit, onCancel }: TransactionFormProps) {
  const [form, setForm] = useState<TransactionFormData>({
    type: initialData?.type || "in",
    warehouse_id: initialData?.warehouse_id || "",
    material_id: initialData?.material_id || "",
    material_name: initialData?.material_name || "",
    quantity: initialData?.quantity || 0,
    notes: initialData?.notes || "",
  })
  const [materialSearch, setMaterialSearch] = useState(initialData?.material_name || "")
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof TransactionFormData, string>>>({})
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: materials } = useQuery({
    queryKey: ["materials", materialSearch],
    queryFn: () => getMaterials(materialSearch || undefined),
  })
  const { data: warehouses } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => getWarehouses(),
  })

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowMaterialDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const validate = (): boolean => {
    const errs: Partial<Record<keyof TransactionFormData, string>> = {}
    if (!form.type) errs.type = "Type is required"
    if (!form.warehouse_id) errs.warehouse_id = "Warehouse is required"
    if (!form.material_id) errs.material_id = "Material is required"
    if (!form.quantity || form.quantity <= 0) errs.quantity = "Quantity must be positive"
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = () => {
    if (validate()) onSubmit(form)
  }

  const selectMaterial = (m: Material) => {
    setForm({ ...form, material_id: m.id, material_name: m.name })
    setMaterialSearch(m.name)
    setShowMaterialDropdown(false)
  }

  const clearMaterial = () => {
    setForm({ ...form, material_id: "", material_name: "" })
    setMaterialSearch("")
  }

  const filteredMaterials = (materials || []).filter((m) =>
    !form.material_id || m.id !== form.material_id
  )

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Transaction Type</Label>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="in">Goods In</option>
              <option value="out">Goods Out</option>
              <option value="transfer">Transfer</option>
              <option value="adjustment">Adjustment</option>
            </Select>
            {errors.type && <p className="text-sm text-destructive">{errors.type}</p>}
          </div>

          <div className="space-y-2">
            <Label>Warehouse</Label>
            <Select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">Select warehouse</option>
              {warehouses?.map((w: Warehouse) => (
                <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
              ))}
            </Select>
            {errors.warehouse_id && <p className="text-sm text-destructive">{errors.warehouse_id}</p>}
          </div>

          <div className="space-y-2" ref={dropdownRef}>
            <Label>Material</Label>
            <div className="relative">
              {form.material_id ? (
                <div className="flex items-center gap-2 h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <span className="flex-1">{form.material_name}</span>
                  <button type="button" onClick={clearMaterial} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search material..."
                    value={materialSearch}
                    onChange={(e) => { setMaterialSearch(e.target.value); setShowMaterialDropdown(true) }}
                    onFocus={() => setShowMaterialDropdown(true)}
                    className="pl-8"
                  />
                </div>
              )}
              {showMaterialDropdown && !form.material_id && filteredMaterials.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-60 overflow-y-auto">
                  {filteredMaterials.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent text-left"
                      onClick={() => selectMaterial(m)}
                    >
                      <span className="font-mono text-xs text-muted-foreground mr-2">{m.sku}</span>
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {errors.material_id && <p className="text-sm text-destructive">{errors.material_id}</p>}
          </div>

          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={1}
              value={form.quantity || ""}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
              placeholder="Enter quantity"
            />
            {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={handleSubmit}>Submit</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
