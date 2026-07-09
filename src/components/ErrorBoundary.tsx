import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: "" };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    const fullInfo = `Error: ${error.message}\nStack: ${error.stack}\nComponent Stack: ${info.componentStack || "N/A"}`;
    this.setState({ info: fullInfo });
    try {
      localStorage.setItem("wms_last_error", fullInfo);
    } catch {}
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: "" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle className="text-destructive">Something went wrong</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm font-mono bg-muted p-3 rounded break-all whitespace-pre-wrap max-h-60 overflow-y-auto">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              {this.state.info && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Stack trace</summary>
                  <pre className="mt-2 p-2 bg-muted rounded max-h-40 overflow-auto">{this.state.info}</pre>
                </details>
              )}
              <div className="flex gap-2">
                <Button onClick={this.handleReset} variant="outline" className="flex-1">
                  Try Again
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    const text = this.state.info || this.state.error?.message || "";
                    navigator.clipboard?.writeText(text);
                  }}
                >
                  Copy Error
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
