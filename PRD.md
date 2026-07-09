# Thermaltrue WMS — Product Requirements Document

## 1. Product Overview

**Product Name:** Thermaltrue Warehouse Management System (WMS)  
**Version:** 0.1.0  
**Platform:** Windows Desktop (Tauri v2)  
**Tech Stack:** Rust (backend) + React 19 / TypeScript 6 (frontend)  
**Database:** SQLite (via rusqlite)

Thermaltrue WMS is a full-stack desktop warehouse management application designed for small-to-medium warehouses to track inventory, manage transactions, generate reports, and perform stock analysis.

---

## 2. Architecture

### 2.1 Project Structure
```
thermaltrue/
├── Cargo.toml                # Workspace manifest (backend + src-tauri)
├── backend/                  # Rust library crate
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── db.rs             # SQLite schema, migrations, seed data
│       ├── models.rs         # 15 data structs (User, Material, Transaction, etc.)
│       ├── error.rs          # AppError enum (6 variants)
│       └── commands/
│           ├── mod.rs
│           ├── auth.rs       # login, logout, get_current_user
│           ├── materials.rs  # CRUD + low stock + QR
│           ├── transactions.rs # CRUD with stock updates
│           ├── warehouse.rs  # Warehouses, Racks, Opname, Transfer
│           ├── analysis.rs   # KPIs, ABC, consumption, forecast
│           ├── reports.rs    # CSV export, PDF generation
│           └── settings.rs   # Users, categories, units, suppliers, audit, backup, QR
├── src-tauri/                # Tauri wrapper crate
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/lib.rs            # App setup, plugin registration, 40+ command handlers
├── src/                      # React frontend
│   ├── main.tsx
│   ├── App.tsx               # 28 routes with AuthProvider + ProtectedRoute
│   ├── api/index.ts          # 48 TypeScript invoke wrappers
│   ├── contexts/AuthContext.tsx
│   ├── layouts/DashboardLayout.tsx
│   └── pages/                # 28 route pages
│       ├── dashboard/
│       ├── materials/        # Stock, QR Generator, Labels
│       ├── transactions/     # Goods In, Goods Out, History
│       ├── analysis/         # Dashboard, Material, Consumption, Cost, ABC, Forecaster
│       ├── warehouse/        # Dashboard, List, Racks, Transfer, Opname
│       ├── reports/          # Summary, Stock, Transaction, Opname
│       └── settings/         # System, Users, Categories, Units, Suppliers, Audit Log
└── target/release/bundle/    # Build outputs (MSI + NSIS)
```

### 2.2 Data Flow
```
User Input (React) → invoke<T>() (IPC) → #[tauri::command] fn (Rust) → SQLite
                                                                          ↓
User Sees (React)  ←── Promise<T> (JSON)  ←── Result<T, AppError>
```

---

## 3. Database Schema (11 Tables)

| Table | Key Columns |
|-------|-------------|
| `users` | id, username, password_hash (bcrypt), full_name, email, role, is_active |
| `categories` | id, name (unique), description |
| `units` | id, name (unique), symbol |
| `suppliers` | id, name, contact, phone, email, address |
| `warehouses` | id, name, code (unique), location, is_active |
| `racks` | id, warehouse_id (FK), area, rack_name, bin_location, max_capacity |
| `materials` | id, sku (unique), name, category_id, unit_id, supplier_id, warehouse_id, rack_id, quantity, min_stock, max_stock, price, expiry_date, is_active |
| `transactions` | id, transaction_number (unique), type (in/out/transfer/opname), material_id, warehouse_id, rack_id, quantity, price, reference, notes, user_id |
| `stock_opname` | id, opname_number (unique), warehouse_id, status (draft/in_progress/completed), notes, created_by |
| `stock_opname_items` | id, opname_id (FK), material_id (FK), system_qty, physical_qty, difference, notes |
| `audit_log` | id, user_id, action, entity, entity_id, details |

**Seed Data (first run):**
- Default user: `admin` / `admin123` (role: admin)
- Default warehouses: WH-001 (Main Warehouse, Jakarta), WH-002 (Secondary Warehouse, Bandung)

---

## 4. Backend Commands (40+)

### 4.1 Auth
| Command | Params | Returns |
|---------|--------|---------|
| `login` | `req: { username, password }` | `{ user, token }` |
| `logout` | `token` | `()` |
| `get_current_user` | `token, user_id` | `User` |

### 4.2 Materials
| Command | Params | Returns |
|---------|--------|---------|
| `get_materials` | `token, search?, category_id?, warehouse_id?` | `Material[]` |
| `get_material` | `token, id` | `Material` |
| `create_material` | `token, material` | `Material` |
| `update_material` | `token, material` | `Material` |
| `delete_material` | `token, id` | `()` |
| `get_materials_low_stock` | `token` | `Material[]` |

### 4.3 Transactions
| Command | Params | Returns |
|---------|--------|---------|
| `get_transactions` | `token, search?, type_filter?, material_id?, limit?` | `Transaction[]` |
| `create_transaction` | `token, tx` | `Transaction` |

### 4.4 Warehouse
| Command | Params | Returns |
|---------|--------|---------|
| `get_warehouses` | `token` | `Warehouse[]` |
| `create_warehouse` | `token, wh` | `Warehouse` |
| `update_warehouse` | `token, wh` | `()` |
| `delete_warehouse` | `token, id` | `()` |
| `get_racks` | `token, warehouse_id?` | `Rack[]` |
| `create_rack` | `token, rack` | `Rack` |
| `update_rack` | `token, rack` | `()` |
| `delete_rack` | `token, id` | `()` |
| `get_stock_opnames` | `token` | `StockOpname[]` |
| `create_stock_opname` | `token, so` | `StockOpname` |
| `update_stock_opname_status` | `token, id, status` | `()` |
| `get_stock_opname_items` | `token, opname_id` | `StockOpnameItem[]` |
| `save_stock_opname_item` | `token, item` | `()` |
| `transfer_material` | `token, material_id, from_warehouse_id, to_warehouse_id, rack_id?, quantity, user_id?` | `()` |

### 4.5 Analysis
| Command | Params | Returns |
|---------|--------|---------|
| `get_dashboard_kpi` | `token` | `DashboardKpi` |
| `get_analysis_all` | `token` | `AnalysisItem[]` |
| `get_abc_analysis` | `token` | `AbcAnalysis` |

### 4.6 Reports
| Command | Params | Returns |
|---------|--------|---------|
| `export_report_csv` | `token, report_type` | `String` (CSV content) |
| `generate_report_pdf` | `token, report_type` | `Vec<u8>` (PDF bytes) |

### 4.7 Settings
| Command | Params | Returns |
|---------|--------|---------|
| `get_users` / `create_user` / `update_user` / `delete_user` | Various | `User[]` / `()` |
| `change_password` | `token, id, new_password` | `()` |
| `get_categories` / `create_category` / `update_category` / `delete_category` | Various | `Category[]` / `()` |
| `get_units` / `create_unit` / `update_unit` / `delete_unit` | Various | `Unit[]` / `()` |
| `get_suppliers` / `create_supplier` / `update_supplier` / `delete_supplier` | Various | `Supplier[]` / `()` |
| `get_audit_logs` | `token` | `AuditLog[]` |
| `add_audit_log` | `token, user_id?, action, entity, entity_id?, details` | `()` |
| `backup_database` | `token, app_handle` | `String` (backup path) |
| `get_db_stats` | `token` | `{ materials, transactions, users, categories }` |
| `generate_qr_code` | `token, data` | `String` (base64 PNG data URL) |

---

## 5. Frontend Routes (28)

| Route | Component | Description |
|-------|-----------|-------------|
| `/login` | LoginPage | Auth form |
| `/dashboard` | DashboardPage | KPI cards + recent transactions |
| `/materials/stock` | StockPage | Material CRUD table with search/filter |
| `/materials/qr-generator` | QrGeneratorPage | Generate QR codes for materials |
| `/materials/labels` | LabelPrintPage | Print labels with QR codes |
| `/transactions/in` | TransactionInPage | Record goods receiving |
| `/transactions/out` | TransactionOutPage | Record goods issue |
| `/transactions/history` | TransactionHistoryPage | Search/filter all transactions |
| `/analysis/dashboard` | AnalysisDashboardPage | Analytics overview |
| `/analysis/material` | MaterialAnalysisPage | Per-material analysis |
| `/analysis/consumption` | ConsumptionPage | Consumption trends (3/6/12 mo) |
| `/analysis/cost` | CostAnalysisPage | Cost analysis |
| `/analysis/abc` | AbcAnalysisPage | ABC classification (80/15/5) |
| `/analysis/forecaster` | ForecasterPage | Demand forecasting |
| `/warehouse/dashboard` | WarehouseDashboardPage | Warehouse overview |
| `/warehouse/list` | WarehouseListPage | Warehouse CRUD |
| `/warehouse/racks` | RackPage | Rack CRUD per warehouse |
| `/warehouse/transfer` | TransferPage | Inter-warehouse transfer |
| `/warehouse/opname` | StockOpnamePage | Stock opname (count) |
| `/reports/summary` | ReportSummaryPage | Report selection hub |
| `/reports/stock` | StockReportPage | Stock report CSV/PDF |
| `/reports/transactions` | TransactionReportPage | Transaction report CSV/PDF |
| `/reports/opname` | OpnameReportPage | Opname report |
| `/settings/system` | SystemPage | DB stats + backup |
| `/settings/users` | UsersPage | User management |
| `/settings/categories` | CategoriesPage | Category CRUD |
| `/settings/units` | UnitsPage | Unit of measure CRUD |
| `/settings/suppliers` | SuppliersPage | Supplier CRUD |
| `/settings/audit-log` | AuditLogPage | Audit trail viewer |

---

## 6. Security

### 6.1 Authentication
- Password hashing: bcrypt (cost factor 4)
- Session tokens: UUID v4 stored in memory-mapped `HashMap<String, String>` (token → user_id)
- Token optional Tauri IPC parameter, verified on every command via `db.verify_token()`
- Frontend persists token + user to `localStorage` for session persistence across reloads

### 6.2 Authorization
- `ProtectedRoute` component redirects unauthenticated users to `/login`
- Backend returns `AppError::Auth` for invalid/expired tokens
- Frontend catches `{ type: "Auth" }` errors to redirect to login

### 6.3 SQL Injection Prevention
All dynamic queries use rusqlite parameterized placeholders (`?`) with `Vec<Box<dyn ToSql>>` parameter binding. Zero user input is interpolated into SQL strings.

---

## 7. Error Handling

### AppError Enum (6 variants)

| Variant | HTTP Equivalent | Frontend Handling |
|---------|----------------|-------------------|
| `Db` | 500 | Show error toast |
| `Auth` | 401 | Redirect to login |
| `NotFound` | 404 | Show "not found" message |
| `Validation` | 400 | Show validation message |
| `Internal` | 500 | Show error toast |
| `Lock` | 503 | Retry action |

Serialized as `{ "type": "Auth", "message": "Invalid username or password" }` for structured frontend parsing.

---

## 8. Reports

### 8.1 CSV Export
- Types: `materials`, `transactions`
- Uses `csv` crate with `Writer::from_writer(Vec::new())`

### 8.2 PDF Generation
- Types: `materials`, `stock`
- Uses `printpdf` crate with built-in Helvetica fonts
- A4 portrait layout (210mm × 297mm)

### 8.3 Backup
- SQLite online backup via `rusqlite::backup::Backup`
- Output: `thermaltrue_backup_YYYYMMDD_HHMMSS.db`
- Location: Tauri app data directory

---

## 9. Build & Deployment

### 9.1 Prerequisites
- Rust 1.77.2+
- Node.js 20+
- Windows SDK (for MSI/NSIS bundling)

### 9.2 Build Commands
```bash
cd thermaltrue
cargo check           # Verify Rust compilation (both crates)
npm run build          # Build frontend (Vite)
npx tauri build        # Full release build
```

### 9.3 Outputs
| Artifact | Path |
|----------|------|
| Binary | `target/release/app.exe` |
| MSI Installer | `target/release/bundle/msi/Thermaltrue_0.1.0_x64_en-US.msi` |
| NSIS Setup | `target/release/bundle/nsis/Thermaltrue_0.1.0_x64-setup.exe` |

---

## 10. Implementation Phases Completed

| Phase | Description | Status |
|-------|-------------|--------|
| A | **Error Enum** — `AppError` with 6 variants, `Serialize` impl, `From<rusqlite::Error>` | ✅ |
| B | **Auth Token** — Session store in `Database.sessions`, `verify_token()`, `logout` command, localStorage persistence | ✅ |
| C | **SQL Parameterization** — 6 injection points fixed in `materials.rs`, `transactions.rs`, `warehouse.rs` | ✅ |
| D | **Frontend Fixes** — `warehouse_id || null` in StockOpnamePage, `expiry_date: null` in StockPage form init | ✅ |

## 11. Future Roadmap

- **Workspace dep alignment** — Move shared deps (tauri, serde, chrono, uuid) to `[workspace.dependencies]`
- **Role-based access** — Restrict admin functions (user management, settings) by role
- **Token expiry** — Add timestamp-based session expiry
- **Multi-language** — i18n support for labels/messages
- **Barcode scanning** — Hardware barcode scanner input for transactions
- **Cloud sync** — Optional PostgreSQL backend for multi-location deployments
