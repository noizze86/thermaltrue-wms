use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Type-safe enums (replacing String-based enum fields)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxType {
    In,
    Out,
    Transfer,
    Opname,
}

impl TxType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TxType::In => "in",
            TxType::Out => "out",
            TxType::Transfer => "transfer",
            TxType::Opname => "opname",
        }
    }
}

impl std::fmt::Display for TxType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for TxType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "in" => Ok(TxType::In),
            "out" => Ok(TxType::Out),
            "transfer" => Ok(TxType::Transfer),
            "opname" => Ok(TxType::Opname),
            _ => Err(format!("Invalid TxType: {}", s)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxStatus {
    Pending,
    Approved,
    Rejected,
    Reversed,
    Draft,
    Completed,
}

impl TxStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TxStatus::Pending => "pending",
            TxStatus::Approved => "approved",
            TxStatus::Rejected => "rejected",
            TxStatus::Reversed => "reversed",
            TxStatus::Draft => "draft",
            TxStatus::Completed => "completed",
        }
    }
}

impl std::fmt::Display for TxStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for TxStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(TxStatus::Pending),
            "approved" => Ok(TxStatus::Approved),
            "rejected" => Ok(TxStatus::Rejected),
            "reversed" => Ok(TxStatus::Reversed),
            "draft" => Ok(TxStatus::Draft),
            "completed" => Ok(TxStatus::Completed),
            _ => Err(format!("Invalid TxStatus: {}", s)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    Operator,
    Viewer,
}

impl std::fmt::Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserRole::Admin => write!(f, "admin"),
            UserRole::Operator => write!(f, "operator"),
            UserRole::Viewer => write!(f, "viewer"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Draft,
    Completed,
    Received,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityStatus {
    Passed,
    Failed,
    Pending,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginStatus {
    Success,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AbcClass {
    A,
    B,
    C,
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub full_name: String,
    pub email: String,
    pub role: String,
    pub is_active: bool,
    pub photo: String,
    pub last_login_at: Option<String>,
    pub last_login_ip: String,
    pub password_changed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub description: String,
    pub parent_id: Option<String>,
    pub icon: String,
    pub color: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryTreeNode {
    pub id: String,
    pub name: String,
    pub description: String,
    pub parent_id: Option<String>,
    pub icon: String,
    pub color: String,
    pub created_at: String,
    pub children: Vec<CategoryTreeNode>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Unit {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub category: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnitConversion {
    pub id: String,
    pub from_unit_id: String,
    pub to_unit_id: String,
    pub factor: f64,
    pub from_unit_name: String,
    pub from_unit_symbol: String,
    pub to_unit_name: String,
    pub to_unit_symbol: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Supplier {
    pub id: String,
    pub name: String,
    pub contact: String,
    pub phone: String,
    pub email: String,
    pub address: String,
    pub contact_person: String,
    pub pic_phone: String,
    pub pic_email: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SupplierRating {
    pub id: String,
    pub supplier_id: String,
    pub metric: String,
    pub score: f64,
    pub period: String,
    pub notes: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SupplierPrice {
    pub id: String,
    pub supplier_id: String,
    pub material_id: String,
    pub material_name: String,
    pub price: f64,
    pub date: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Warehouse {
    pub id: String,
    pub name: String,
    pub code: String,
    pub location: String,
    pub is_active: bool,
    pub capacity: f64,
    pub layout_image: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WarehouseStats {
    pub id: String,
    pub name: String,
    pub code: String,
    pub location: String,
    pub is_active: bool,
    pub capacity: f64,
    pub layout_image: String,
    pub rack_count: i64,
    pub material_count: i64,
    pub used_capacity: f64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Zone {
    pub id: String,
    pub warehouse_id: String,
    pub name: String,
    pub code: String,
    pub capacity: f64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Location {
    pub id: String,
    pub parent_id: Option<String>,
    pub warehouse_id: String,
    pub type_: String,
    pub code: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Rack {
    pub id: String,
    pub warehouse_id: String,
    pub area: String,
    pub rack_name: String,
    pub bin_location: String,
    pub max_capacity: f64,
    pub location_id: Option<String>,
    pub created_at: String,
}

/// Client-controlled fields for creating a material (no id, quantity, or timestamps)
#[derive(Debug, Deserialize, Clone)]
pub struct CreateMaterialInput {
    pub sku: String,
    pub name: String,
    pub description: String,
    pub category_id: Option<String>,
    pub unit_id: Option<String>,
    pub supplier_id: Option<String>,
    pub warehouse_id: Option<String>,
    pub rack_id: Option<String>,
    pub min_stock: f64,
    pub max_stock: f64,
    pub price: f64,
    pub image: String,
    pub expiry_date: Option<String>,
    pub is_active: bool,
}

/// Client-controlled fields for updating a material (no quantity or timestamps)
#[derive(Debug, Deserialize, Clone)]
pub struct UpdateMaterialInput {
    pub id: String,
    pub sku: String,
    pub name: String,
    pub description: String,
    pub category_id: Option<String>,
    pub unit_id: Option<String>,
    pub supplier_id: Option<String>,
    pub warehouse_id: Option<String>,
    pub rack_id: Option<String>,
    pub min_stock: f64,
    pub max_stock: f64,
    pub price: f64,
    pub image: String,
    pub expiry_date: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Material {
    pub id: String,
    pub sku: String,
    pub name: String,
    pub description: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub unit_id: Option<String>,
    pub unit_name: Option<String>,
    pub supplier_id: Option<String>,
    pub warehouse_id: Option<String>,
    pub rack_id: Option<String>,
    pub quantity: f64,
    pub min_stock: f64,
    pub max_stock: f64,
    pub price: f64,
    pub image: String,
    pub expiry_date: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Transaction {
    pub id: String,
    pub transaction_number: String,
    #[serde(rename = "type")]
    pub tx_type: String,
    pub material_id: String,
    pub warehouse_id: Option<String>,
    pub rack_id: Option<String>,
    pub quantity: f64,
    pub price: f64,
    pub reference: String,
    pub notes: String,
    pub user_id: Option<String>,
    pub status: String,
    pub approved_by: Option<String>,
    pub po_number: String,
    pub invoice_no: String,
    pub destination: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockOpname {
    pub id: String,
    pub opname_number: String,
    pub warehouse_id: Option<String>,
    pub status: String,
    pub notes: String,
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockOpnameItem {
    pub id: String,
    pub opname_id: String,
    pub material_id: String,
    pub system_qty: f64,
    pub physical_qty: f64,
    pub difference: f64,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditLog {
    pub id: String,
    pub user_id: Option<String>,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub details: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub user: User,
    pub token: String,
    #[serde(default)]
    pub password_expired: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DashboardKpi {
    pub total_materials: i64,
    pub total_transactions: i64,
    pub low_stock_items: i64,
    pub total_warehouses: i64,
    pub recent_transactions: Vec<Transaction>,
    pub stock_value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalysisItem {
    pub material_id: String,
    pub material_name: String,
    pub sku: String,
    pub quantity: f64,
    pub turnover: f64,
    pub last_transaction: Option<String>,
    pub days_since_last: i64,
    pub consumption_3mo: f64,
    pub consumption_6mo: f64,
    pub consumption_12mo: f64,
    pub lead_time_days: f64,
    pub abc_class: Option<String>,
    pub forecast_qty: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AbcAnalysis {
    pub class_a: Vec<AnalysisItem>,
    pub class_b: Vec<AnalysisItem>,
    pub class_c: Vec<AnalysisItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompanyProfile {
    pub id: String,
    pub company_name: String,
    pub address: String,
    pub phone: String,
    pub email: String,
    pub logo: String,
    pub npwp: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationConfig {
    pub id: String,
    pub config_key: String,
    pub config_value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReportSchedule {
    pub id: String,
    pub report_type: String,
    pub email_to: String,
    pub frequency: String,
    pub day_of_week: i64,
    pub hour: i64,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MomKpi {
    pub current_value: f64,
    pub prev_value: f64,
    pub change_pct: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgingItem {
    pub bucket: String,
    pub count: i64,
    pub total_value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockMovement {
    pub material_name: String,
    pub opening: f64,
    pub qty_in: f64,
    pub qty_out: f64,
    pub closing: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserTxSummary {
    pub user_id: String,
    pub user_name: String,
    pub total_count: i64,
    pub total_value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyTrend {
    pub date: String,
    pub count: i64,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpnameVariance {
    pub category: String,
    pub total_diff: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryValue {
    pub name: String,
    pub count: i64,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransactionItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub tx_id: String,
    pub material_id: String,
    pub batch_id: Option<String>,
    pub quantity: f64,
    pub price: f64,
    #[serde(default)]
    pub material_name: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PurchaseOrder {
    pub id: String,
    pub po_number: String,
    pub supplier_id: Option<String>,
    pub supplier_name: String,
    pub status: String,
    pub notes: String,
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PoItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub po_id: String,
    pub material_id: String,
    pub quantity: f64,
    pub price: f64,
    #[serde(default)]
    pub received_qty: f64,
    #[serde(default)]
    pub material_name: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SalesOrder {
    pub id: String,
    pub so_number: String,
    pub customer_name: String,
    pub customer_address: String,
    pub status: String,
    pub notes: String,
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SoItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub so_id: String,
    pub material_id: String,
    pub quantity: f64,
    pub price: f64,
    #[serde(default)]
    pub fulfilled_qty: f64,
    #[serde(default)]
    pub material_name: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransactionAttachment {
    pub id: String,
    pub tx_id: String,
    pub filename: String,
    pub data_base64: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QualityInspection {
    pub id: String,
    pub tx_id: String,
    pub material_id: String,
    pub status: String,
    pub notes: String,
    pub inspected_by: Option<String>,
    #[serde(default)]
    pub material_name: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransferOrder {
    pub id: String,
    pub transfer_number: String,
    pub from_warehouse_id: String,
    pub to_warehouse_id: String,
    pub status: String,
    pub notes: String,
    pub created_by: Option<String>,
    pub approved_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransferItem {
    pub id: String,
    pub transfer_id: String,
    pub material_id: String,
    pub batch_id: Option<String>,
    pub quantity: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CycleSchedule {
    pub id: String,
    pub warehouse_id: Option<String>,
    pub class: String,
    pub frequency_days: i64,
    pub next_date: String,
    pub last_date: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThroughputMetric {
    pub warehouse_id: String,
    pub warehouse_name: String,
    pub in_qty: f64,
    pub out_qty: f64,
    pub tx_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PickerActivity {
    pub user_id: String,
    pub user_name: String,
    pub pick_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SlottingSuggestion {
    pub material_id: String,
    pub sku: String,
    pub name: String,
    pub current_rack: String,
    pub suggested_rack: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MaterialBatch {
    pub id: String,
    pub material_id: String,
    pub batch_no: String,
    pub qty: f64,
    pub expiry_date: Option<String>,
    pub received_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MaterialImage {
    pub id: String,
    pub material_id: String,
    pub url: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockValuation {
    pub category: String,
    pub value: f64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Budget {
    pub id: String,
    pub category_id: Option<String>,
    pub period: String,
    pub amount: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AbcWeight {
    pub key: String,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ForecastCache {
    pub id: String,
    pub material_id: String,
    pub model: String,
    pub params: String,
    pub result: String,
    pub horizon: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoginHistoryEntry {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub ip_address: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Role {
    pub id: String,
    pub name: String,
    pub description: String,
    pub permissions: String,
    pub is_system: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PermissionCheck {
    pub user_id: String,
    pub permission: String,
    pub granted: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LabelTemplate {
    pub id: String,
    pub name: String,
    pub layout_style: String,
    pub show_sku: bool,
    pub show_name: bool,
    pub show_company: bool,
    pub show_qty: bool,
    pub show_price: bool,
    pub show_barcode: bool,
    pub show_qr: bool,
    pub show_category: bool,
    pub show_supplier: bool,
    pub show_location: bool,
    pub show_expiry: bool,
    pub show_batch: bool,
    pub show_min_stock: bool,
    pub show_logo: bool,
    pub show_border: bool,
    pub qr_size: String,
    pub border_style: String,
    pub font_scale: f32,
    pub template_type: String,
    pub label_width_mm: f32,
    pub label_height_mm: f32,
    pub created_at: String,
    pub updated_at: String,
}
