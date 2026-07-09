import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getCategories, getCategoryTree, createCategory, updateCategory, deleteCategory, exportReportCsv } from "../../api"
import type { CategoryTreeNode } from "../../api"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Card, CardContent, CardHeader } from "../../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { Label } from "../../components/ui/label"
import { Select } from "../../components/ui/select"
import { Plus, Pencil, Trash2, Tags, Download, Search, ChevronRight, ChevronDown } from "lucide-react"
import { toast } from "../../hooks/use-toast"
import { z } from "zod"
import { LoadingState, ErrorState } from "../../components/ui/data-state"

const ICONS = ["Package", "Box", "Archive", "Layers", "Folder", "Tag", "Star", "Heart", "Shield", "Truck", "Cpu", "Smartphone", "Shirt", "Book", "Flask", "Beaker", "Coffee", "Music", "Camera", "Watch"]

const COLORS = ["#6b7280", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#84cc16", "#f43f5e", "#6366f1", "#a855f7", "#0ea5e9"]

const schema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Max 100 characters"),
  description: z.string().max(500, "Max 500 characters"),
})

export default function CategoriesPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [viewMode, setViewMode] = useState<"list" | "tree">("list")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: categories, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["categories", debouncedSearch],
    queryFn: () => getCategories(debouncedSearch || undefined),
  })
  const { data: treeData } = useQuery({
    queryKey: ["category_tree"],
    queryFn: getCategoryTree,
  })

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", description: "", parent_id: "" as string | null, icon: "Folder", color: "#6b7280" })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [exporting, setExporting] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setExpandedIds(next)
  }

  const validate = () => {
    const result = schema.safeParse(form)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        fieldErrors[issue.path[0] as string] = issue.message
      }
      setErrors(fieldErrors)
      return false
    }
    setErrors({})
    return true
  }

  const createMut = useMutation({
    mutationFn: () => createCategory(form.name, form.description, form.parent_id || null, form.icon, form.color),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["categories"] }); queryClient.invalidateQueries({ queryKey: ["category_tree"] }); setShowForm(false); resetForm() },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const updateMut = useMutation({
    mutationFn: () => updateCategory(editId!, form.name, form.description, form.parent_id || null, form.icon, form.color),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["categories"] }); queryClient.invalidateQueries({ queryKey: ["category_tree"] }); setShowForm(false); setErrors({}) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["categories"] }); queryClient.invalidateQueries({ queryKey: ["category_tree"] }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const resetForm = () => setForm({ name: "", description: "", parent_id: null, icon: "Folder", color: "#6b7280" })
  if (isLoading) return <LoadingState text="Loading categories..." />
  if (isError) return <ErrorState message={error?.message || "Failed to load categories"} onRetry={refetch} />

  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const csv = await exportReportCsv("categories")
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = "categories.csv"; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "Exported", description: "Categories exported as CSV" })
    } catch (e: unknown) {
      toast({ title: "Error", description: String(e), variant: "destructive" })
    } finally { setExporting(false) }
  }

  const renderTreeNode = (node: CategoryTreeNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0
    const isExpanded = expandedIds.has(node.id)
    return (
      <div key={node.id}>
        <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded-sm" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
          <button onClick={() => toggleExpand(node.id)} className="w-4 h-4 flex items-center justify-center">
            {hasChildren ? (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : <span className="w-3" />}
          </button>
          <span className="inline-flex items-center justify-center w-6 h-6 rounded" style={{ backgroundColor: node.color + "20" }}>
            <span className="text-xs" style={{ color: node.color }}>{node.icon === "Folder" ? "📁" : "📄"}</span>
          </span>
          <span className="text-sm font-medium">{node.name}</span>
          {node.description && <span className="text-xs text-muted-foreground truncate max-w-[200px]">— {node.description}</span>}
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditId(node.id); setForm({ name: node.name, description: node.description, parent_id: node.parent_id, icon: node.icon, color: node.color }); setErrors({}); setShowForm(true) }}><Pencil className="h-3 w-3" /></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { if (confirm("Delete this category?")) deleteMut.mutate(node.id) }}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </div>
        {isExpanded && hasChildren && node.children.map((child) => renderTreeNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2"><Tags className="h-8 w-8" /> Categories</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={exporting}><Download className="h-4 w-4" /> Export CSV</Button>
          <Button onClick={() => { setEditId(null); resetForm(); setErrors({}); setShowForm(true) }}><Plus className="h-4 w-4" /> Add Category</Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant={viewMode === "list" ? "default" : "outline"} size="sm" onClick={() => setViewMode("list")}>List</Button>
              <Button variant={viewMode === "tree" ? "default" : "outline"} size="sm" onClick={() => setViewMode("tree")}>Tree</Button>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search categories..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === "list" ? (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Parent</TableHead><TableHead className="w-[100px]">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {categories?.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No categories found</TableCell></TableRow>
                ) : categories?.map((c) => {
                  const parent = categories?.find((p) => p.id === c.parent_id)
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded" style={{ backgroundColor: c.color + "20" }}>
                          <span className="text-xs" style={{ color: c.color }}>{c.icon === "Folder" ? "📁" : "📄"}</span>
                        </span>
                        {c.name}
                      </TableCell>
                      <TableCell>{c.description || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{parent?.name || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditId(c.id); setForm({ name: c.name, description: c.description, parent_id: c.parent_id, icon: c.icon, color: c.color }); setErrors({}); setShowForm(true) }}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this category?")) deleteMut.mutate(c.id) }}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="border rounded-md p-2">
              {treeData?.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No categories found</p>
              ) : treeData?.map((node) => renderTreeNode(node))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) setErrors({}); setShowForm(v) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? "Edit Category" : "Add Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
            </div>
            <div className="space-y-2">
              <Label>Parent Category</Label>
              <Select value={form.parent_id || ""} onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })}>
                <option value="">None (Top Level)</option>
                {(categories || []).filter((c) => c.id !== editId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-2">
                {ICONS.map((ico) => (
                  <button key={ico} type="button" onClick={() => setForm({ ...form, icon: ico })}
                    className={`w-8 h-8 rounded border flex items-center justify-center text-sm ${form.icon === ico ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
                    {ico === "Folder" ? "📁" : ico === "Package" ? "📦" : ico === "Box" ? "📋" : ico === "Archive" ? "🗄️" : ico === "Layers" ? "📚" : ico === "Tag" ? "🏷️" : ico === "Star" ? "⭐" : ico === "Heart" ? "❤️" : ico === "Shield" ? "🛡️" : ico === "Truck" ? "🚚" : ico === "Cpu" ? "💻" : ico === "Smartphone" ? "📱" : ico === "Shirt" ? "👕" : ico === "Book" ? "📖" : ico === "Flask" ? "🧪" : ico === "Coffee" ? "☕" : ico === "Music" ? "🎵" : ico === "Camera" ? "📷" : ico === "Watch" ? "⌚" : "📄"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((col) => (
                  <button key={col} type="button" onClick={() => setForm({ ...form, color: col })}
                    className={`w-8 h-8 rounded-full border-2 ${form.color === col ? "border-foreground" : "border-transparent"}`}
                    style={{ backgroundColor: col }} />
                ))}
              </div>
            </div>
            <Button onClick={() => { if (validate()) { if (editId) { updateMut.mutate() } else { createMut.mutate() } } }} className="w-full" disabled={createMut.isPending || updateMut.isPending}>{editId ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
