import { setupTest, teardownTest, navigateTo } from "../helpers/tauri-helper";
import type { TauriMcpClient } from "../helpers/tauri-helper";

async function testAnalysis() {
  console.log("🧪 Analysis Test Suite");
  let passed = 0;
  let failed = 0;
  const client = await setupTest();

  try {
    // TC-ANL-01: Navigate to Analysis Dashboard
    console.log("  TC-ANL-01: Navigate to Analysis Dashboard");
    await navigateTo(client, "Analysis Dashboard");
    await client.waitForDomTextOrThrow("Analysis Dashboard", 10000);
    const dashDom = await client.inspectDom();
    if (dashDom.includes("Analysis Dashboard") || dashDom.includes("Total Materials")) {
      console.log("    ✓ Analysis Dashboard loaded");
      passed++;
    } else {
      console.log("    ✗ Analysis Dashboard not loaded");
      failed++;
    }

    // TC-ANL-02: Navigate to Material Analysis
    console.log("  TC-ANL-02: Navigate to Material Analysis");
    await navigateTo(client, "Material Analysis");
    await client.waitForDomTextOrThrow("Material Analysis", 10000);
    const matDom = await client.inspectDom();
    if (matDom.includes("Material Analysis") || matDom.includes("Dead Stock")) {
      console.log("    ✓ Material Analysis page loaded");
      passed++;
    } else {
      console.log("    ✗ Material Analysis page not loaded");
      failed++;
    }

    // TC-ANL-03: Navigate to Consumption Analysis
    console.log("  TC-ANL-03: Navigate to Consumption Analysis");
    await navigateTo(client, "Consumption");
    await client.waitForDomTextOrThrow("Consumption Analysis", 10000);
    const consDom = await client.inspectDom();
    if (consDom.includes("Consumption Analysis") || consDom.includes("3-Month")) {
      console.log("    ✓ Consumption Analysis page loaded");
      passed++;
    } else {
      console.log("    ✗ Consumption Analysis page not loaded");
      failed++;
    }

    // TC-ANL-04: Navigate to Cost Analysis
    console.log("  TC-ANL-04: Navigate to Cost Analysis");
    await navigateTo(client, "Cost Analysis");
    await client.waitForDomTextOrThrow("Cost Analysis", 10000);
    const costDom = await client.inspectDom();
    if (costDom.includes("Cost Analysis") || costDom.includes("Inventory Value")) {
      console.log("    ✓ Cost Analysis page loaded");
      passed++;
    } else {
      console.log("    ✗ Cost Analysis page not loaded");
      failed++;
    }

    // TC-ANL-05: Navigate to ABC Analysis
    console.log("  TC-ANL-05: Navigate to ABC Analysis");
    await navigateTo(client, "ABC Analysis");
    await client.waitForDomTextOrThrow("ABC Analysis", 10000);
    const abcDom = await client.inspectDom();
    if (abcDom.includes("ABC Analysis") || abcDom.includes("Class A")) {
      console.log("    ✓ ABC Analysis page loaded");
      passed++;
    } else {
      console.log("    ✗ ABC Analysis page not loaded");
      failed++;
    }

    // TC-ANL-06: Navigate to Forecaster
    console.log("  TC-ANL-06: Navigate to Forecaster");
    await navigateTo(client, "Forecaster");
    await client.waitForDomTextOrThrow("Forecaster", 10000);
    const fcDom = await client.inspectDom();
    if (fcDom.includes("Forecaster") || fcDom.includes("Stock Coverage")) {
      console.log("    ✓ Forecaster page loaded");
      passed++;
    } else {
      console.log("    ✗ Forecaster page not loaded");
      failed++;
    }
  } catch (err) {
    console.error(`  ✗ Test error: ${err}`);
    failed++;
  } finally {
    await teardownTest(client);
  }

  console.log(`\n📊 Analysis Results: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

export { testAnalysis };
