import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../components/ErrorBoundary";

const ThrowError = () => {
  throw new Error("test error");
};

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("catches error and shows fallback UI", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("test error")).toBeInTheDocument();
    expect(screen.getByText("Try Again")).toBeInTheDocument();
    (console.error as unknown as ReturnType<typeof vi.spyOn>).mockRestore();
  });

  it("uses custom fallback when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <ThrowError />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
    (console.error as unknown as ReturnType<typeof vi.spyOn>).mockRestore();
  });
});
