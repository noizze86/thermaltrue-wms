import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { Button } from "../../components/ui/button"
import { Label } from "../../components/ui/label"
import { Badge } from "../../components/ui/badge"
import { Server, CheckCircle, XCircle, Loader2, Save } from "lucide-react"
import { toast } from "../../hooks/use-toast"

const STORAGE_KEY = "wms_api_url";

function getStoredUrl(): string {
  return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_API_URL || "http://localhost:3000";
}

export default function ApiSettingsPage() {
  const [url, setUrl] = useState(getStoredUrl);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");

  useEffect(() => {
    setUrl(getStoredUrl());
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult("idle");
    setTestMsg("");
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const body = await res.json();
        setTestResult("ok");
        setTestMsg(body?.status === "ok" ? "Server online" : `Unexpected response: ${JSON.stringify(body)}`);
      } else {
        setTestResult("fail");
        setTestMsg(`HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (e: unknown) {
      setTestResult("fail");
      setTestMsg(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const cleanUrl = url.replace(/\/+$/, "");
    localStorage.setItem(STORAGE_KEY, cleanUrl);
    toast({ title: "Saved", description: `API URL set to ${cleanUrl}` });
    setUrl(cleanUrl);
  };

  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    const defaultUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
    setUrl(defaultUrl);
    toast({ title: "Reset", description: `API URL reset to ${defaultUrl}` });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            API Server Configuration
          </CardTitle>
          <CardDescription>
            Set the URL of the Thermaltrue API server. All client requests will be sent to this address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-url">Server URL</Label>
            <div className="flex gap-2">
              <Input
                id="api-url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setTestResult("idle"); }}
                placeholder="http://192.168.1.100:3000"
                className="font-mono"
              />
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Test
              </Button>
            </div>
          </div>

          {testResult !== "idle" && (
            <div className="flex items-center gap-2 text-sm">
              {testResult === "ok" ? (
                <Badge variant="default" className="bg-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" /> {testMsg}
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" /> {testMsg}
                </Badge>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={!url}>
              <Save className="h-4 w-4 mr-1" /> Save
            </Button>
            <Button variant="ghost" onClick={handleReset}>
              Reset to Default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Deployment Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• For local development, use <code className="bg-muted px-1 rounded">http://localhost:3000</code></p>
          <p>• For LAN deployment, use the server's IP address (e.g. <code className="bg-muted px-1 rounded">http://192.168.1.100:3000</code>)</p>
          <p>• The server port is configured via <code className="bg-muted px-1 rounded">PORT</code> environment variable (default: 3000)</p>
          <p>• URL is stored in your browser's localStorage and persists between sessions</p>
        </CardContent>
      </Card>
    </div>
  );
}
