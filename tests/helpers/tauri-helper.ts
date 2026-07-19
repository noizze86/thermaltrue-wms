import { spawn, type ChildProcess } from "child_process";
import path from "path";

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
  private host?: string;
  private port?: number;

  constructor(opts: TauriMcpClientOptions = {}) {
    this.appPath = opts.appPath || "";
    this.projectRoot = opts.projectRoot || process.cwd();
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
          "@hypothesi/tauri-mcp-server",
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

  async startSession(host?: string, port?: number): Promise<void> {
    const args: Record<string, unknown> = { action: "start" };
    if (host) args.host = host;
    if (port) args.port = port;
    await this.callToolWithRetry("driver_session", args, 5);
  }

  async endSession(): Promise<void> {
    try {
      await this.callTool("driver_session", { action: "end" });
    } catch {
      // ignore
    }
  }

  async screenshot(): Promise<string> {
    const result = await this.callTool("screenshot_desktop", {});
    const item = result.content.find(c => c.type === "image" || c.type === "resource");
    if (item && "data" in item) return item.data as string;
    if (item && "text" in item) return item.text as string;
    return "";
  }

  async click(x: number, y: number, button = "left"): Promise<void> {
    await this.callTool("click_mouse", { x, y, button });
  }

  async clickElement(text: string): Promise<void> {
    const dom = await this.inspectDom();
    const regex = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const lines = dom.split("\n");
    for (const line of lines) {
      if (regex.test(line)) {
        const match = line.match(/(?:x|left|"x"):\s*(\d+)/i);
        const matchY = line.match(/(?:y|top|"y"):\s*(\d+)/i);
        if (match && matchY) {
          await this.click(parseInt(match[1]) + 5, parseInt(matchY[1]) + 5);
          return;
        }
      }
    }
    throw new Error(`Element with text "${text}" not found in DOM`);
  }

  async type(text: string): Promise<void> {
    await this.callTool("type_text", { text });
  }

  async typeInto(x: number, y: number, text: string): Promise<void> {
    await this.click(x, y);
    await this.sleep(300);
    await this.type(text);
  }

  async scroll(deltaX = 0, deltaY = 200): Promise<void> {
    await this.callTool("scroll_mouse", { deltaX, deltaY });
  }

  async inspectDom(): Promise<string> {
    const result = await this.callTool("inspect_dom", {});
    const item = result.content.find(c => c.type === "text" || c.type === "string");
    return item?.text || JSON.stringify(result.content);
  }

  async monitorIpc(filter?: string): Promise<void> {
    await this.callTool("monitor_ipc_calls", filter ? { filter } : {});
  }

  async getIpcLogs(): Promise<string> {
    const result = await this.callTool("get_ipc_logs", {});
    const item = result.content.find(c => c.type === "text");
    return item?.text || "";
  }

  async streamConsoleLogs(): Promise<void> {
    await this.callTool("stream_console_logs", {});
  }

  async getConsoleLogs(): Promise<string> {
    const result = await this.callTool("get_console_logs", {});
    const item = result.content.find(c => c.type === "text");
    return item?.text || "";
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
      throw new Error(`Timeout waiting for "${text}" to appear in DOM (${timeout}ms)`);
    }
  }

  async sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
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
    });
  }
  return sharedClient;
}

export async function setupTest(): Promise<TauriMcpClient> {
  const client = getClient();
  await client.connect();
  await client.startSession();
  await client.sleep(1000);
  return client;
}

export async function teardownTest(client: TauriMcpClient): Promise<void> {
  await client.disconnect();
}

export async function login(client: TauriMcpClient, username = "admin", password = "admin123"): Promise<void> {
  await client.waitForDomTextOrThrow("Login", 15000);
  await client.typeInto(200, 300, username);
  await client.typeInto(200, 350, password);
  await client.click(200, 400);
  await client.sleep(2000);
}

export async function navigateTo(client: TauriMcpClient, label: string): Promise<void> {
  await client.clickElement(label);
  await client.sleep(2000);
}
