import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Clock, Package } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Badge } from "./ui/badge"
import { getMaterialsLowStock, getExpiringMaterials } from "../api"

export default function DashboardAlertCard() {
  const navigate = useNavigate()
  const { data: lowStock } = useQuery({
    queryKey: ["materials_low_stock"],
    queryFn: getMaterialsLowStock,
    refetchInterval: 30_000,
  })
  const { data: expiring } = useQuery({
    queryKey: ["materials_expiring"],
    queryFn: () => getExpiringMaterials(30),
    refetchInterval: 30_000,
  })

  const totalAlerts = (lowStock?.length || 0) + (expiring?.length || 0)
  if (totalAlerts === 0) return null

  return (
    <Card className="border-yellow-200 dark:border-yellow-800">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          Alerts ({totalAlerts})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {lowStock && lowStock.length > 0 && (
          <button
            onClick={() => navigate("/materials/stock")}
            className="flex w-full items-center gap-3 rounded-md bg-red-50 p-3 text-left text-sm transition-colors hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50"
          >
            <Package className="h-4 w-4 shrink-0 text-red-500" />
            <span className="flex-1">{lowStock.length} material{lowStock.length > 1 ? "s" : ""} below minimum stock</span>
            <Badge variant="destructive" className="shrink-0">{lowStock.length}</Badge>
          </button>
        )}
        {expiring && expiring.length > 0 && (
          <button
            onClick={() => navigate("/materials/stock")}
            className="flex w-full items-center gap-3 rounded-md bg-yellow-50 p-3 text-left text-sm transition-colors hover:bg-yellow-100 dark:bg-yellow-950/30 dark:hover:bg-yellow-950/50"
          >
            <Clock className="h-4 w-4 shrink-0 text-yellow-500" />
            <span className="flex-1">{expiring.length} material{expiring.length > 1 ? "s" : ""} expiring within 30 days</span>
            <Badge variant="outline" className="shrink-0 border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-300">{expiring.length}</Badge>
          </button>
        )}
      </CardContent>
    </Card>
  )
}
