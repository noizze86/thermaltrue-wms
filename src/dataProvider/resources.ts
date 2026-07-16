export interface ResourceColumn {
  key: string
  label: string
  type: "text" | "number" | "date" | "select"
  options?: string[]
}

export interface ResourceEndpoints {
  list: string
  get: string
  create: string
  update: string
  delete: string
}

export interface Resource {
  key: string
  label: string
  icon: string
  columns: ResourceColumn[]
  permission: string
  endpoints: ResourceEndpoints
}

export const resources: Resource[] = [
  {
    key: "materials",
    label: "Materials",
    icon: "Package",
    columns: [
      { key: "sku", label: "SKU", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "category_id", label: "Category", type: "text" },
      { key: "unit_id", label: "Unit", type: "text" },
      { key: "quantity", label: "Qty", type: "number" },
      { key: "price", label: "Price", type: "number" },
      { key: "min_stock", label: "Min Stock", type: "number" },
      { key: "max_stock", label: "Max Stock", type: "number" },
      { key: "is_active", label: "Active", type: "select", options: ["true", "false"] },
    ],
    permission: "manage_materials",
    endpoints: { list: "get_materials", get: "get_material", create: "create_material", update: "update_material", delete: "delete_material" },
  },
  {
    key: "categories",
    label: "Categories",
    icon: "Tags",
    columns: [
      { key: "name", label: "Name", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "parent_id", label: "Parent", type: "text" },
      { key: "icon", label: "Icon", type: "text" },
      { key: "color", label: "Color", type: "text" },
    ],
    permission: "manage_settings",
    endpoints: { list: "get_categories", get: "get_categories", create: "create_category", update: "update_category", delete: "delete_category" },
  },
  {
    key: "units",
    label: "Units",
    icon: "Ruler",
    columns: [
      { key: "name", label: "Name", type: "text" },
      { key: "symbol", label: "Symbol", type: "text" },
      { key: "category", label: "Category", type: "text" },
    ],
    permission: "manage_settings",
    endpoints: { list: "get_units", get: "get_units", create: "create_unit", update: "update_unit", delete: "delete_unit" },
  },
  {
    key: "suppliers",
    label: "Suppliers",
    icon: "Truck",
    columns: [
      { key: "name", label: "Name", type: "text" },
      { key: "contact", label: "Contact", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "contact_person", label: "Contact Person", type: "text" },
    ],
    permission: "manage_settings",
    endpoints: { list: "get_suppliers", get: "get_suppliers", create: "create_supplier", update: "update_supplier", delete: "delete_supplier" },
  },
  {
    key: "warehouses",
    label: "Warehouses",
    icon: "Warehouse",
    columns: [
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "capacity", label: "Capacity", type: "number" },
      { key: "is_active", label: "Active", type: "select", options: ["true", "false"] },
    ],
    permission: "manage_warehouse",
    endpoints: { list: "get_warehouses", get: "get_warehouses", create: "create_warehouse", update: "update_warehouse", delete: "delete_warehouse" },
  },
  {
    key: "zones",
    label: "Zones",
    icon: "Layers",
    columns: [
      { key: "warehouse_id", label: "Warehouse", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "capacity", label: "Capacity", type: "number" },
    ],
    permission: "manage_warehouse",
    endpoints: { list: "get_zones", get: "get_zones", create: "create_zone", update: "update_zone", delete: "delete_zone" },
  },
  {
    key: "racks",
    label: "Racks",
    icon: "LayoutGrid",
    columns: [
      { key: "warehouse_id", label: "Warehouse", type: "text" },
      { key: "area", label: "Area", type: "text" },
      { key: "rack_name", label: "Rack Name", type: "text" },
      { key: "bin_location", label: "Bin Location", type: "text" },
      { key: "max_capacity", label: "Max Capacity", type: "number" },
    ],
    permission: "manage_warehouse",
    endpoints: { list: "get_racks", get: "get_racks", create: "create_rack", update: "update_rack", delete: "delete_rack" },
  },
  {
    key: "transactions",
    label: "Transactions",
    icon: "ArrowRightLeft",
    columns: [
      { key: "transaction_number", label: "Number", type: "text" },
      { key: "type", label: "Type", type: "select", options: ["in", "out", "transfer", "adjustment"] },
      { key: "material_id", label: "Material", type: "text" },
      { key: "warehouse_id", label: "Warehouse", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "created_at", label: "Date", type: "date" },
    ],
    permission: "manage_transactions",
    endpoints: { list: "get_transactions", get: "get_transactions", create: "create_transaction", update: "update_transaction", delete: "delete_transaction" },
  },
  {
    key: "users",
    label: "Users",
    icon: "Users",
    columns: [
      { key: "username", label: "Username", type: "text" },
      { key: "full_name", label: "Full Name", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "role", label: "Role", type: "text" },
      { key: "is_active", label: "Active", type: "select", options: ["true", "false"] },
    ],
    permission: "manage_users",
    endpoints: { list: "get_users", get: "get_users", create: "create_user", update: "update_user", delete: "delete_user" },
  },
  {
    key: "roles",
    label: "Roles",
    icon: "Shield",
    columns: [
      { key: "name", label: "Name", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "is_system", label: "System", type: "select", options: ["true", "false"] },
    ],
    permission: "manage_users",
    endpoints: { list: "get_roles", get: "get_roles", create: "get_roles", update: "update_role", delete: "get_roles" },
  },
  {
    key: "audit_log",
    label: "Audit Log",
    icon: "ClipboardList",
    columns: [
      { key: "created_at", label: "Date", type: "date" },
      { key: "user_id", label: "User", type: "text" },
      { key: "action", label: "Action", type: "text" },
      { key: "entity", label: "Entity", type: "text" },
      { key: "details", label: "Details", type: "text" },
    ],
    permission: "manage_settings",
    endpoints: { list: "get_audit_logs", get: "get_audit_logs", create: "add_audit_log", update: "add_audit_log", delete: "purge_old_audit_logs" },
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: "PackageSearch",
    columns: [
      { key: "sku", label: "SKU", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "warehouse_id", label: "Warehouse", type: "text" },
      { key: "min_stock", label: "Min Stock", type: "number" },
    ],
    permission: "manage_materials",
    endpoints: { list: "get_materials", get: "get_material", create: "create_material", update: "update_material", delete: "delete_material" },
  },
  {
    key: "reports",
    label: "Reports",
    icon: "FileText",
    columns: [
      { key: "report_type", label: "Report Type", type: "select", options: ["stock", "transaction", "audit_log", "supplier", "category"] },
      { key: "generated_at", label: "Generated At", type: "date" },
    ],
    permission: "view_reports",
    endpoints: { list: "export_report_csv", get: "export_report_csv", create: "export_report_csv", update: "export_report_csv", delete: "export_report_csv" },
  },
]
