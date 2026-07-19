import { testDashboard } from "./e2e/dashboard.test";
import { testMasterData } from "./e2e/master-data.test";
import { testTransactions } from "./e2e/transactions.test";
import { testReports } from "./e2e/reports.test";
import { testWarehouse } from "./e2e/warehouse.test";
import { testAnalysis } from "./e2e/analysis.test";
import { testSettings } from "./e2e/settings.test";
import { testNegative } from "./e2e/negative.test";
import fs from "fs";
import path from "path";

interface TestResult {
  suite: string;
  passed: number;
  failed: number;
  total: number;
  timestamp: string;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  THERMALTRUE WMS — Tauri MCP E2E Test Runner");
  console.log("=".repeat(60));
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("=".repeat(60));
  console.log();

  const results: TestResult[] = [];
  let globalPassed = 0;
  let globalFailed = 0;

  const testSuites = [
    { name: "Dashboard", fn: testDashboard },
    { name: "Master Data", fn: testMasterData },
    { name: "Transactions", fn: testTransactions },
    { name: "Reports", fn: testReports },
    { name: "Warehouse", fn: testWarehouse },
    { name: "Analysis", fn: testAnalysis },
    { name: "Settings", fn: testSettings },
    { name: "Negative & Edge Cases", fn: testNegative },
  ];

  // Parse command line args for suite filter
  const args = process.argv.slice(2);
  const runSuites = args.length > 0
    ? testSuites.filter(s => args.includes(s.name.toLowerCase().replace(/\s+/g, "-")))
    : testSuites;

  if (runSuites.length === 0) {
    console.log("No matching test suites. Available:");
    testSuites.forEach(s => console.log(`  ${s.name.toLowerCase().replace(/\s+/g, "-")}`));
    process.exit(1);
  }

  for (const suite of runSuites) {
    console.log(`\n${"-".repeat(50)}`);
    try {
      const result = await suite.fn();
      results.push({
        suite: suite.name,
        passed: result.passed,
        failed: result.failed,
        total: result.passed + result.failed,
        timestamp: new Date().toISOString(),
      });
      globalPassed += result.passed;
      globalFailed += result.failed;
    } catch (err) {
      console.error(`  FATAL: Test suite "${suite.name}" crashed: ${err}`);
      results.push({
        suite: suite.name,
        passed: 0,
        failed: 1,
        total: 1,
        timestamp: new Date().toISOString(),
      });
      globalFailed++;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Total Suites: ${results.length}`);
  console.log(`  Total Tests:  ${globalPassed + globalFailed}`);
  console.log(`  Passed:       ${globalPassed}`);
  console.log(`  Failed:       ${globalFailed}`);
  console.log(`  Success Rate: ${((globalPassed / (globalPassed + globalFailed || 1)) * 100).toFixed(1)}%`);
  console.log();
  console.log("  Results by Suite:");
  console.log("  " + "-".repeat(50));
  for (const r of results) {
    const status = r.failed === 0 ? "✓" : "✗";
    console.log(`  ${status} ${r.suite.padEnd(20)} ${r.passed}/${r.total} passed (${r.failed > 0 ? r.failed + " failed" : "all ok"})`);
  }
  console.log("=".repeat(60));

  // Write report file
  const reportPath = path.resolve(__dirname, "results", `test-report-${Date.now()}.json`);
  const reportDir = path.dirname(reportPath);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  fs.writeFileSync(reportPath, JSON.stringify({
    summary: {
      total: globalPassed + globalFailed,
      passed: globalPassed,
      failed: globalFailed,
      successRate: ((globalPassed / (globalPassed + globalFailed || 1)) * 100).toFixed(1),
      duration: new Date().toISOString(),
    },
    suites: results,
  }, null, 2));

  console.log(`\n  Report saved: ${reportPath}`);
  console.log();

  process.exit(globalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
