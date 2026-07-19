import { setupTest, teardownTest, navigateTo } from "../helpers/tauri-helper";
import { testData } from "../fixtures/data";
import type { TauriMcpClient } from "../helpers/tauri-helper";

async function testMasterData() {
  console.log("🧪 Master Data Test Suite");
  let passed = 0;
  let failed = 0;
  const client = await setupTest();

  try {
    // TC-MD-01: Create material
    console.log("  TC-MD-01: Create new material");
    await navigateTo(client, "Stock Management");
    await client.waitForDomTextOrThrow("Stock Management", 10000);

    await client.clickElement("Add Material");
    await client.sleep(1500);
    await client.waitForDomTextOrThrow("Add Material", 5000);

    // Fill SKU
    await client.typeInto(250, 300, testData.material.sku);
    await client.typeInto(250, 340, testData.material.name);
    await client.typeInto(250, 580, String(testData.material.quantity));
    await client.typeInto(250, 620, String(testData.material.price));
    await client.typeInto(250, 660, String(testData.material.minStock));
    await client.typeInto(250, 700, String(testData.material.maxStock));

    await client.clickElement("Create");
    await client.sleep(3000);

    const domAfterCreate = await client.inspectDom();
    if (domAfterCreate.includes(testData.material.sku)) {
      console.log(`    ✓ Material "${testData.material.name}" created successfully`);
      passed++;
    } else {
      console.log("    ✗ Material not found after creation");
      failed++;
    }

    // TC-MD-02: Search material
    console.log("  TC-MD-02: Search material by SKU");
    await client.typeInto(100, 180, testData.material.sku);
    await client.sleep(1000);
    const searchDom = await client.inspectDom();
    if (searchDom.includes(testData.material.sku)) {
      console.log("    ✓ Search found the material");
      passed++;
    } else {
      console.log("    ✗ Search did not find the material");
      failed++;
    }

    // TC-MD-03: Create category
    console.log("  TC-MD-03: Create new category");
    await navigateTo(client, "Categories");
    await client.waitForDomTextOrThrow("/settings/categories", 5000);

    await client.clickElement("Add Category");
    await client.sleep(1500);
    await client.typeInto(250, 250, testData.category.name);
    await client.typeInto(250, 290, testData.category.description);
    await client.clickElement("Create");
    await client.sleep(3000);

    const catDom = await client.inspectDom();
    if (catDom.includes(testData.category.name)) {
      console.log("    ✓ Category created successfully");
      passed++;
    } else {
      console.log("    ✗ Category not found after creation");
      failed++;
    }

    // TC-MD-04: Create unit
    console.log("  TC-MD-04: Create new unit");
    await navigateTo(client, "Units");
    await client.waitForDomTextOrThrow("/settings/units", 5000);

    await client.clickElement("Add Unit");
    await client.sleep(1500);
    await client.typeInto(250, 250, testData.unit.name);
    await client.typeInto(250, 290, testData.unit.symbol);
    await client.clickElement("Create");
    await client.sleep(3000);

    const unitDom = await client.inspectDom();
    if (unitDom.includes(testData.unit.name)) {
      console.log("    ✓ Unit created successfully");
      passed++;
    } else {
      console.log("    ✗ Unit not found after creation");
      failed++;
    }

    // TC-MD-05: Create supplier
    console.log("  TC-MD-05: Create new supplier");
    await navigateTo(client, "Suppliers");
    await client.waitForDomTextOrThrow("/settings/suppliers", 5000);

    await client.clickElement("Add Supplier");
    await client.sleep(1500);
    await client.typeInto(250, 250, testData.supplier.name);
    await client.typeInto(250, 290, testData.supplier.contact);
    await client.typeInto(250, 330, testData.supplier.phone);
    await client.typeInto(250, 370, testData.supplier.contactPerson);
    await client.clickElement("Create");
    await client.sleep(3000);

    const suppDom = await client.inspectDom();
    if (suppDom.includes(testData.supplier.name)) {
      console.log("    ✓ Supplier created successfully");
      passed++;
    } else {
      console.log("    ✗ Supplier not found after creation");
      failed++;
    }
  } catch (err) {
    console.error(`  ✗ Test error: ${err}`);
    failed++;
  } finally {
    await teardownTest(client);
  }

  console.log(`\n📊 Master Data Results: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

export { testMasterData };
