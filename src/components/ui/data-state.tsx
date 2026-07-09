import { Loader2, AlertCircle, PackageOpen, RefreshCw } from "lucide-react"

export function LoadingState({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-20 gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <AlertCircle className="h-12 w-12 text-destructive/60" />
      <h3 className="text-lg font-semibold">Something went wrong</h3>
      <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <RefreshCw className="h-3 w-3" /> Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  icon: Icon = PackageOpen,
  title = "No data",
  description,
  action,
}: {
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title?: string
  description?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <Icon className="h-16 w-16 text-muted-foreground/40" />
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action && (
        <button onClick={action.onClick} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          {action.label}
        </button>
      )}
    </div>
  )
}
