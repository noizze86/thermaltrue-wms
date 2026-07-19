import { setupTest, teardownTest, navigateTo } from "../helpers/tauri-helper";
import type { TauriMcpClient } from "../helpers/tauri-helper";

async function testWarehouse() {
  console.log("🧪 Warehouse Test Suite");
  let passed = 0;
  let failed = 0;
  const client = await setupTest();

  try {
    // TC-WH-01: Navigate to Warehouse Dashboard
    console.log("  TC-WH-01: Navigate to Warehouse Dashboard");
    await navigateTo(client, "Warehouse Dashboard");
    await client.waitForDomTextOrThrow("Warehouse Dashboard", 10000);
    const whDashDom = await client.inspectDom();
    if (whDashDom.includes("Warehouse Dashboard") || whDashDom.includes("Throughput")) {
      console.log("    ✓ Warehouse Dashboard loaded");
      passed++;
    } else {
      console.log("    ✗ Warehouse Dashboard not loaded");
      failed++;
    }

    // TC-WH-02: Navigate to Warehouses list
    console.log("  TC-WH-02: Navigate to Warehouses");
    await navigateTo(client, "Warehouses");
    await client.waitForDomTextOrThrow("Warehouses", 10000);
    const listDom = await client.inspectDom();
    if (listDom.includes("Add Warehouse") || listDom.includes("Warehouse")) {
      console.log("    ✓ Warehouse list page loaded");
      passed++;
    } else {
      console.log("    ✗ Warehouse list page not loaded");
      failed++;
    }

    // TC-WH-03: Navigate to Rack/Bin
    console.log("  TC-WH-03: Navigate to Rack/Bin");
    await navigateTo(client, "Rack/Bin");
    await client.waitForDomTextOrThrow("Rack", 10000);
    const rackDom = await client.inspectDom();
    if (rackDom.includes("Rack") || rackDom.includes("Add Rack")) {
      console.log("    ✓ Rack/Bin page loaded");
      passed++;
    } else {
      console.log("    ✗ Rack/Bin page not loaded");
      failed++;
    }

    // TC-WH-04: Navigate to Transfer
    console.log("  TC-WH-04: Navigate to Transfer");
    await navigateTo(client, "Transfer");
    await client.waitForDomTextOrThrow("Transfer", 10000);
    const txDom = await client.inspectDom();
    if (txDom.includes("Single Transfer") || txDom.includes("Transfer Orders") || txDom.includes("Bulk")) {
      console.log("    ✓ Transfer page loaded");
      passed++;
    } else {
      console.log("    ✗ Transfer page not loaded");
      failed++;
    }

    // TC-WH-05: Navigate to Stock Opname
    console.log("  TC-WH-05: Navigate to Stock Opname");
    await navigateTo(client, "Stock Opname");
    await client.waitForDomTextOrThrow("Stock Opname", 10000);
    const opDom = await client.inspectDom();
    if (opDom.includes("New Opname") || opDom.includes("Opname")) {
      console.log("    ✓ Stock Opname page loaded");
      passed++;
    } else {
      console.log("    ✗ Stock Opname page not loaded");
      failed++;
    }
  } catch (err) {
    console.error(`  ✗ Test error: ${err}`);
    failed++;
  } finally {
    await teardownTest(client);
  }

  console.log(`\n📊 Warehouse Results: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

export { testWarehouse };
