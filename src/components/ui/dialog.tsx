import { forwardRef, useEffect, useCallback, createContext, useContext, type HTMLAttributes, type ReactNode } from "react"
import { cn } from "../../lib/utils"
import { X } from "lucide-react"

interface DialogContextValue {
  onOpenChange: (open: boolean) => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onOpenChange(false)
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, handleEscape])

  if (!open) return null
  return (
    <DialogContext.Provider value={{ onOpenChange }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
        <div className="relative z-50">{children}</div>
      </div>
    </DialogContext.Provider>
  )
}

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  hideClose?: boolean
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(({ className, children, hideClose, ...props }, ref) => {
  const ctx = useContext(DialogContext)

  return (
    <div
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && ctx && (
        <button
          onClick={() => ctx.onOpenChange(false)}
          className="absolute right-3 top-3 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
})
DialogContent.displayName = "DialogContent"

const DialogHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)

const DialogTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h2 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
))
DialogTitle.displayName = "DialogTitle"

export { Dialog, DialogContent, DialogHeader, DialogTitle }
