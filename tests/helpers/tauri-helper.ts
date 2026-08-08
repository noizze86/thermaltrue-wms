import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

interface TauriMcpClientOptions {
  appPath?: string;
  projectRoot?: string;
  serverPath?: string;
  host?: string;
  port?: number;
}

export class TauriMcpClient {
  private process: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests: Map<number, { resolve: (v: McpToolResult) => void; reject: (e: Error) => void }> = new Map();
  private buffer = "";
  private connected = false;
  private appPath: string;
  private projectRoot: string;
  private serverEntry: string;
  private host?: string;
  private port?: number;

  constructor(opts: TauriMcpClientOptions = {}) {
    this.appPath = opts.appPath || "";
    this.projectRoot = opts.projectRoot || process.cwd();
    this.serverEntry = opts.serverPath || "";
    this.host = opts.host;
    this.port = opts.port;
  }

  async connect(): Promise<void> {
    const args = [];
    if (this.appPath) args.push("--app-path", this.appPath);
    if (this.host) args.push("--host", this.host);
    if (this.port) args.push("--port", String(this.port));

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn("npx", [
          "-y",
          "@hypothesi/tauri-mcp-server@0.12.0",
          ...args,
        ], {
          cwd: this.projectRoot,
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
        });

        let resolved = false;

        this.process.stdout?.on("data", (data: Buffer) => {
          this.buffer += data.toString();
          this.processBuffer();
          if (!resolved) {
            resolved = true;
            this.connected = true;
            resolve();
          }
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          if (text.includes("MCP server running") || text.includes("started") || text.includes("listening")) {
            if (!resolved) {
              resolved = true;
              this.connected = true;
              resolve();
            }
          }
        });

        this.process.on("error", (err) => {
          if (!resolved) {
            resolved = true;
            reject(new Error(`Failed to start MCP server: ${err.message}`));
          }
        });

        this.process.on("exit", (code) => {
          this.connected = false;
          if (!resolved) {
            resolved = true;
            reject(new Error(`MCP server exited with code ${code}`));
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.connected = true;
            resolve();
          }
        }, 5000);
      } catch (err) {
        reject(err);
      }
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pendingRequests.has(msg.id)) {
            const { resolve, reject } = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
              reject(new Error(msg.error.message || String(msg.error)));
            } else {
              resolve(msg.result || { content: [] });
            }
          }
        } catch {
          // not JSON, skip
        }
      }
    }
    this.buffer = lines[lines.length - 1];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    if (!this.connected) {
      throw new Error("MCP client not connected. Call connect() first.");
    }
    const id = this.messageId++;
    const request = {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    };
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process?.stdin?.write(JSON.stringify(request) + "\n");
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Tool call '${name}' timed out after 60s`));
        }
      }, 60000);
    });
  }

  async callToolWithRetry(name: string, args: Record<string, unknown> = {}, maxRetries = 3): Promise<McpToolResult> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.callTool(name, args);
      } catch (err) {
        if (i === maxRetries - 1) throw err;
        await this.sleep(2000);
      }
    }
    throw new Error(`Tool call '${name}' failed after ${maxRetries} retries`);
  }

  private textOf(result: McpToolResult): string {
    const item = result.content.find(c => c.type === "text");
    return item?.text || JSON.stringify(result.content);
  }

  async startSession(host?: string, port?: number): Promise<void> {
    const args: Record<string, unknown> = { action: "start" };
    if (host) args.host = host;
    if (port) args.port = port;
    const result = await this.callToolWithRetry("driver_session", args, 5);
    const out = this.textOf(result);
    if (/Session start failed/i.test(out)) {
      throw new Error(`driver_session start failed: ${out}`);
    }
  }

  async endSession(): Promise<void> {
    try {
      await this.callTool("driver_session", { action: "end" });
    } catch {
      // ignore
    }
  }

  async screenshot(): Promise<string> {
    const result = await this.callTool("webview_screenshot", { format: "png" });
    const item = result.content.find(c => c.type === "image" || c.type === "resource");
    if (item && "data" in item) return item.data as string;
    return this.textOf(result);
  }

  async click(x: number, y: number): Promise<void> {
    await this.callTool("webview_interact", { action: "click", x, y });
  }

  async clickElement(text: string): Promise<void> {
    const result = await this.callTool("webview_interact", { action: "click", strategy: "text", selector: text });
    const out = this.textOf(result);
    if (/not found|no element|failed|error/i.test(out)) {
      const dom = await this.inspectDom();
      throw new Error(`clickElement("${text}") failed: ${out}. DOM snippet: ${dom.slice(0, 1500)}`);
    }
  }

  async fillField(label: string, text: string): Promise<void> {
    const script = `(() => {
      const labelText = ${JSON.stringify(label)};
      const value = ${JSON.stringify(text)};
      let target = null;
      for (const lab of document.querySelectorAll('label')) {
        if (lab.textContent.trim().toLowerCase() === labelText.toLowerCase()) {
          if (lab.htmlFor) target = document.getElementById(lab.htmlFor);
          if (!target) target = lab.parentElement ? lab.parentElement.querySelector('input,select,textarea') : null;
          break;
        }
      }
      if (!target) target = document.querySelector('input[placeholder="' + labelText + '"]');
      if (!target) return { ok: false, reason: 'no target for label ' + labelText };
      const proto = target.tagName === 'SELECT' ? HTMLSelectElement.prototype :
        target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(target, value);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`;
    const result = await this.callTool("webview_execute_js", { script });
    const out = this.textOf(result);
    if (!/"ok"\s*:\s*true/.test(out)) {
      const dom = await this.inspectDom();
      throw new Error(`fillField("${label}") failed: ${out}. DOM snippet: ${dom.slice(0, 1500)}`);
    }
  }

  async type(text: string): Promise<void> {
    const script = `(() => {
      const el = document.activeElement;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return { ok: false, reason: 'no focused input' };
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`;
    const result = await this.callTool("webview_execute_js", { script });
    const out = this.textOf(result);
    if (!/"ok"\s*:\s*true/.test(out)) {
      throw new Error(`type() failed: ${out}`);
    }
  }

  async typeInto(x: number, y: number, text: string): Promise<void> {
    await this.click(x, y);
    await this.sleep(300);
    await this.type(text);
  }

  async scroll(deltaX = 0, deltaY = 200): Promise<void> {
    await this.callTool("webview_interact", { action: "scroll", scrollX: deltaX, scrollY: deltaY });
  }

  async inspectDom(): Promise<string> {
    const result = await this.callTool("webview_dom_snapshot", { type: "accessibility" });
    return this.textOf(result);
  }

  async setHash(hash: string): Promise<void> {
    const script = `(() => { location.hash = ${JSON.stringify(hash)}; return location.hash; })()`;
    await this.callTool("webview_execute_js", { script });
  }

  async waitForDomText(text: string, timeout = 10000): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const dom = await this.inspectDom();
      if (dom.toLowerCase().includes(text.toLowerCase())) return true;
      await this.sleep(500);
    }
    return false;
  }

  async waitForDomTextOrThrow(text: string, timeout = 10000): Promise<void> {
    const found = await this.waitForDomText(text, timeout);
    if (!found) {
      const dom = await this.inspectDom();
      throw new Error(
        `Timeout waiting for "${text}" to appear in DOM (${timeout}ms). DOM snippet: ${dom.slice(0, 1500)}`
      );
    }
  }

  async sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  async resetAuth(): Promise<void> {
    const script = `(() => { localStorage.removeItem('wms_user'); localStorage.removeItem('wms_token'); location.hash = '#/'; location.reload(); return 'ok'; })()`;
    try {
      await this.callTool("webview_execute_js", { script });
    } catch {
      // app may reload before reply — ignore
    }
  }

  async disconnect(): Promise<void> {
    await this.endSession();
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
  }
}

let sharedClient: TauriMcpClient | null = null;

export function getClient(): TauriMcpClient {
  if (!sharedClient) {
    sharedClient = new TauriMcpClient({
      projectRoot: path.resolve(__dirname, "../.."),
      appPath: process.env.TAURI_APP_PATH || path.resolve(__dirname, "../../target/debug/app.exe"),
    });
  }
  return sharedClient;
}

export async function setupTest(): Promise<TauriMcpClient> {
  const client = getClient();
  await client.connect();
  await client.startSession("127.0.0.1", parseInt(process.env.MCP_BRIDGE_PORT || "9223", 10));
  await client.resetAuth();
  await client.sleep(1000);
  return client;
}

export async function teardownTest(client: TauriMcpClient): Promise<void> {
  await client.disconnect();
}

export async function login(
  client: TauriMcpClient,
  username = "admin",
  password = process.env.E2E_ADMIN_PASSWORD || "admin123"
): Promise<void> {
  await client.waitForDomTextOrThrow("Sign In", 15000);
  await client.fillField("Username", username);
  await client.fillField("Password", password);
  await client.clickElement("Sign In");
  await client.waitForDomTextOrThrow("Dashboard", 15000);
}

const MENU_PARENTS: Record<string, string[]> = {
  Materials: ["Master Data", "Stock Management", "QR Generator", "Label Printing"],
  Transactions: ["Goods In", "Goods Out", "History"],
  Analysis: ["Analysis Dashboard", "Material Analysis", "Consumption", "Cost Analysis", "ABC Analysis", "Forecaster"],
  Warehouse: ["Warehouse Dashboard", "Warehouses", "Rack/Bin", "Transfer", "Stock Opname"],
  Reports: ["Material Summary", "Stock Report", "Transaction Report", "Opname Report", "Multi-Warehouse", "Pivot Report"],
  Settings: ["My Profile", "System", "Users", "Categories", "Units", "Suppliers", "Audit Log", "Roles", "Label Templates", "Inventory Settings", "Email Config", "API Settings", "Network Test", "Update Test"],
};

const ROUTE_BY_LABEL: Record<string, string> = {
  Dashboard: "#/dashboard",
  "Master Data": "#/materials/master-data",
  "Stock Management": "#/materials/stock",
  "QR Generator": "#/materials/qr-generator",
  "Label Printing": "#/materials/labels",
  "Goods In": "#/transactions/in",
  "Goods Out": "#/transactions/out",
  History: "#/transactions/history",
  "Analysis Dashboard": "#/analysis/dashboard",
  "Material Analysis": "#/analysis/material",
  Consumption: "#/analysis/consumption",
  "Cost Analysis": "#/analysis/cost",
  "ABC Analysis": "#/analysis/abc",
  Forecaster: "#/analysis/forecaster",
  "Warehouse Dashboard": "#/warehouse/dashboard",
  Warehouses: "#/warehouse/list",
  "Rack/Bin": "#/warehouse/racks",
  Transfer: "#/warehouse/transfer",
  "Stock Opname": "#/warehouse/opname",
  "Material Summary": "#/reports/summary",
  "Stock Report": "#/reports/stock",
  "Transaction Report": "#/reports/transactions",
  "Opname Report": "#/reports/opname",
  "Multi-Warehouse": "#/reports/multi-warehouse",
  "Pivot Report": "#/reports/pivot",
  "My Profile": "#/settings/profile",
  System: "#/settings/system",
  Users: "#/settings/users",
  Categories: "#/settings/categories",
  Units: "#/settings/units",
  Suppliers: "#/settings/suppliers",
  "Audit Log": "#/settings/audit-log",
  Roles: "#/settings/roles",
  "Label Templates": "#/settings/label-templates",
  "Email Config": "#/settings/email",
  "Inventory Settings": "#/settings/inventory",
  "API Settings": "#/settings/api",
  "Network Test": "#/settings/network-test",
  "Update Test": "#/settings/update-test",
};

export async function navigateTo(client: TauriMcpClient, label: string): Promise<void> {
  const target = LABEL_ALIASES[label] || label;
  const route = ROUTE_BY_LABEL[target];
  if (route) {
    try {
      await client.setHash(route);
      await client.sleep(2500);
      return;
    } catch {
      // hash navigation failed — fall through to menu clicks
    }
  }
  const dom = await client.inspectDom();
  if (!dom.toLowerCase().includes(target.toLowerCase())) {
    const parent = Object.keys(MENU_PARENTS).find(k => MENU_PARENTS[k].includes(target));
    if (parent) {
      try {
        await client.clickElement(parent);
        await client.sleep(800);
      } catch {
        // parent expansion failed — fall through and attempt direct click
      }
    }
  }
  await client.clickElement(target);
  await client.sleep(2000);
}

const LABEL_ALIASES: Record<string, string> = { "System Settings": "System" };