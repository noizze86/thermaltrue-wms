import { setupTest, teardownTest, navigateTo } from "../helpers/tauri-helper";
import type { TauriMcpClient } from "../helpers/tauri-helper";

async function testSettings() {
  console.log("🧪 Settings Test Suite");
  let passed = 0;
  let failed = 0;
  const client = await setupTest();

  try {
    // TC-SET-01: Navigate to System Settings
    console.log("  TC-SET-01: Navigate to System Settings");
    await navigateTo(client, "System Settings");
    await client.waitForDomTextOrThrow("System", 10000);
    const sysDom = await client.inspectDom();
    if (sysDom.includes("System") || sysDom.includes("Company Profile") || sysDom.includes("Backup")) {
      console.log("    ✓ System Settings page loaded");
      passed++;
    } else {
      console.log("    ✗ System Settings page not loaded");
      failed++;
    }

    // TC-SET-02: Navigate to Users
    console.log("  TC-SET-02: Navigate to Users");
    await navigateTo(client, "Users");
    await client.waitForDomTextOrThrow("Users", 10000);
    const usersDom = await client.inspectDom();
    if (usersDom.includes("Add User") || usersDom.includes("Username") || usersDom.includes("Users")) {
      console.log("    ✓ Users page loaded");
      passed++;
    } else {
      console.log("    ✗ Users page not loaded");
      failed++;
    }

    // TC-SET-03: Navigate to Roles
    console.log("  TC-SET-03: Navigate to Roles");
    await navigateTo(client, "Roles");
    await client.waitForDomTextOrThrow("Roles", 10000);
    const rolesDom = await client.inspectDom();
    if (rolesDom.includes("Roles") || rolesDom.includes("Permissions")) {
      console.log("    ✓ Roles page loaded");
      passed++;
    } else {
      console.log("    ✗ Roles page not loaded");
      failed++;
    }

    // TC-SET-04: Navigate to Audit Log
    console.log("  TC-SET-04: Navigate to Audit Log");
    await navigateTo(client, "Audit Log");
    await client.waitForDomTextOrThrow("Audit Log", 10000);
    const auditDom = await client.inspectDom();
    if (auditDom.includes("Audit Log") || auditDom.includes("Purge")) {
      console.log("    ✓ Audit Log page loaded");
      passed++;
    } else {
      console.log("    ✗ Audit Log page not loaded");
      failed++;
    }

    // TC-SET-05: Navigate to Label Templates
    console.log("  TC-SET-05: Navigate to Label Templates");
    await navigateTo(client, "Label Templates");
    await client.waitForDomTextOrThrow("Label Templates", 10000);
    const labelDom = await client.inspectDom();
    if (labelDom.includes("Label Templates") || labelDom.includes("Add Template")) {
      console.log("    ✓ Label Templates page loaded");
      passed++;
    } else {
      console.log("    ✗ Label Templates page not loaded");
      failed++;
    }

    // TC-SET-06: Navigate to API Settings
    console.log("  TC-SET-06: Navigate to API Settings");
    await navigateTo(client, "API Settings");
    await client.waitForDomTextOrThrow("API Settings", 10000);
    const apiDom = await client.inspectDom();
    if (apiDom.includes("API Settings") || apiDom.includes("Server URL")) {
      console.log("    ✓ API Settings page loaded");
      passed++;
    } else {
      console.log("    ✗ API Settings page not loaded");
      failed++;
    }
  } catch (err) {
    console.error(`  ✗ Test error: ${err}`);
    failed++;
  } finally {
    await teardownTest(client);
  }

  console.log(`\n📊 Settings Results: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

export { testSettings };
