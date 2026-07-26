import { useState, useRef, useCallback, useEffect } from "react"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { Scan } from "lucide-react"
import type { Material } from "../api"

interface Props {
  materials: Material[]
  onSelect: (materialId: string) => void
  placeholder?: string
  className?: string
  onLookup?: (query: string) => void
  value?: string
  onChange?: (val: string) => void
}

export default function SkuAutocomplete({ materials, onSelect, placeholder, className, onLookup, value: externalValue, onChange: externalOnChange }: Props) {
  const [internalValue, setInternalValue] = useState("")
  const [open, setOpen] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimer = useRef<number | null>(null)

  const isControlled = externalValue !== undefined
  const value = isControlled ? externalValue! : internalValue
  const setValue = isControlled && externalOnChange ? externalOnChange : setInternalValue

  const results = !value.trim()
    ? []
    : materials.filter((m) =>
        m.sku.toLowerCase().includes(value.toLowerCase()) ||
        m.name.toLowerCase().includes(value.toLowerCase())
      )

  const select = useCallback((m: Material) => {
    onSelect(m.id)
    setValue("")
    setOpen(false)
    setHoverIdx(-1)
  }, [onSelect, setValue])

  useEffect(() => {
    setHoverIdx(-1)
    setOpen(results.length > 0)
  }, [value, results.length])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault()
        setOpen(true)
        setHoverIdx(0)
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHoverIdx((p) => Math.min(p + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHoverIdx((p) => Math.max(p - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (hoverIdx >= 0) {
        select(results[hoverIdx])
      } else {
        onLookup?.(value.trim())
      }
    } else if (e.key === "Escape") {
      setOpen(false)
      setHoverIdx(-1)
    }
  }

  const resolveSku = (raw: string): string => {
    try { const j = JSON.parse(raw); return j.sku || j.id || raw } catch { return raw }
  }

  return (
    <div className={`flex gap-2 ${className || ""}`}>
      <div className="relative flex-1">
        <Input
          ref={inputRef}
          placeholder={placeholder || "Search SKU or material name..."}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => {
              setOpen(false)
              setHoverIdx(-1)
            }, 180)
          }}
        />
        {open && (
          <ul
            className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-lg text-sm"
            onMouseDown={() => { if (blurTimer.current) clearTimeout(blurTimer.current) }}
          >
            {results.map((m, i) => (
              <li
                key={m.id}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer ${
                  i === hoverIdx ? "bg-accent text-accent-foreground" : ""
                }`}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseDown={() => select(m)}
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{m.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{m.sku}</span>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                  Stock: {m.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button
        variant="outline"
        onMouseDown={() => onLookup?.(resolveSku(value.trim()))}
        title="Scan / Search"
      >
        <Scan className="h-4 w-4" />
      </Button>
    </div>
  )
}
