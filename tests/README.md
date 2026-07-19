# Thermaltrue WMS — E2E Tests via Tauri MCP

## Prerequisites

- Node.js 20+
- Rust/Cargo
- Tauri CLI (`@tauri-apps/cli@^2.11.3`)
- ThermaltrueServer service running (port 3000)

## Quick Start

### 1. Install test dependencies

```powershell
cd tests
npm install
```

### 2. Start the Tauri app (dev mode)

From the project root:
```powershell
cargo tauri dev
```

### 3. Run all tests

```powershell
cd tests
npm run test:all
```

### 4. Run specific test suite

```powershell
npm run test:dashboard
npm run test:transactions
npm run test:master-data
npm run test:warehouse
npm run test:analysis
npm run test:reports
npm run test:settings
npm run test:negative
```

## Architecture

```
tests/
├── e2e/                    # Test suites
│   ├── dashboard.test.ts   # Dashboard (8 scenarios)
│   ├── master-data.test.ts # Master Data CRUD (5 scenarios)
│   ├── transactions.test.ts# Transactions (5 scenarios)
│   ├── reports.test.ts     # Reports (5 scenarios)
│   ├── warehouse.test.ts   # Warehouse (5 scenarios)
│   ├── analysis.test.ts    # Analysis (6 scenarios)
│   ├── settings.test.ts    # Settings (6 scenarios)
│   └── negative.test.ts    # Negative/Edge (3 scenarios)
├── helpers/
│   └── tauri-helper.ts     # MCP client wrapper
├── fixtures/
│   └── data.ts             # Test data
├── runner.ts               # Test orchestrator
└── package.json            # Dependencies
```

## Test Coverage (43 scenarios)

| Suite | Scenarios |
|-------|-----------|
| Dashboard | 8 (KPI, navigation, filters, charts, widgets) |
| Master Data | 5 (create/search: material, category, unit, supplier) |
| Transactions | 5 (page loads, filters, export) |
| Reports | 5 (page loads, CSV export) |
| Warehouse | 5 (page loads for all WH pages) |
| Analysis | 6 (page loads for all analysis pages) |
| Settings | 6 (page loads for all settings pages) |
| Negative/Edge | 3 (errors, validation, constraint) |
| **Total** | **43** |

## Writing Tests

Each test function receives a `TauriMcpClient` instance with these helpers:

```typescript
const client = await setupTest();
await client.clickElement("Button Text");  // Click by text
await client.typeInto(x, y, "text");       // Type at coordinates
await client.screenshot();                  // Take screenshot
await client.inspectDom();                  // Get DOM as text
await client.waitForDomTextOrThrow("text"); // Wait for text
await teardownTest(client);
```
