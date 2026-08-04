-- Migration 0033: Performance indexes for dashboard and analytics queries

-- Composite index for transaction aggregation queries (dashboard.rs:57-68, 244-251)
CREATE INDEX IF NOT EXISTS idx_transactions_material_type_created
    ON transactions(material_id, type, created_at);

-- Composite index for latest metrics query (dashboard.rs:355-363)
CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_wh_hour
    ON dashboard_metrics(warehouse_id, metric_hour DESC);

-- Composite index for forecast lookup (dashboard.rs:64)
CREATE INDEX IF NOT EXISTS idx_forecast_metrics_mat_period_model
    ON forecast_metrics(material_id, period, forecast_model);

-- Composite index for ABC classification lookup (dashboard.rs:66)
CREATE INDEX IF NOT EXISTS idx_abc_classification_mat_period
    ON abc_classification(material_id, period DESC);

-- Index for consumption_metrics material lookups
CREATE INDEX IF NOT EXISTS idx_consumption_metrics_material_id
    ON consumption_metrics(material_id);

-- Index for cost_metrics warehouse lookups
CREATE INDEX IF NOT EXISTS idx_cost_metrics_warehouse_id
    ON cost_metrics(warehouse_id);
