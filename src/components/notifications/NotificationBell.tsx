import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "../../api"
import { Bell, CheckCheck } from "lucide-react"
import { Badge } from "../ui/badge"
import { formatDate } from "../../lib/utils"

export default function NotificationBell({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data: notifs } = useQuery({ queryKey: ["notifications"], queryFn: getNotifications, refetchInterval: 60000 })
  const unread = notifs?.filter((n) => !n.is_read).length || 0

  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  })
  const readAllMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  })

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="flex-1 text-left">Notifications</span>}
        {unread > 0 && <Badge variant="destructive" className="text-xs">{unread}</Badge>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-50 w-80 rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              {unread > 0 && (
                <button onClick={() => readAllMut.mutate()} className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <CheckCheck className="h-3 w-3" /> Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {!notifs || notifs.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">No notifications</p>
              ) : (
                notifs.map((n) => (
                  <div
                    key={n.id}
                    className={`px-3 py-2 border-b last:border-0 cursor-pointer hover:bg-accent/50 ${n.is_read ? "" : "bg-primary/5"}`}
                    onClick={() => { if (!n.is_read) readMut.mutate(n.id) }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{n.title}</span>
                      {n.type === "warning" && <Badge variant="destructive" className="text-[10px]">warning</Badge>}
                      {n.type === "info" && <Badge variant="secondary" className="text-[10px]">info</Badge>}
                    </div>
                    {n.message && <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{formatDate(n.created_at)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
