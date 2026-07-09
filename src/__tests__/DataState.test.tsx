import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingState, ErrorState, EmptyState } from "../components/ui/data-state";

describe("LoadingState", () => {
  it("renders default text", () => {
    render(<LoadingState />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders custom text", () => {
    render(<LoadingState text="Fetching data..." />);
    expect(screen.getByText("Fetching data...")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders error message", () => {
    render(<ErrorState message="Network error" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders retry button when onRetry provided", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Error" onRetry={onRetry} />);
    const btn = screen.getByText("Try again");
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(onRetry).toHaveBeenCalled();
  });

  it("does not render retry button without onRetry", () => {
    render(<ErrorState message="Error" />);
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders default title", () => {
    render(<EmptyState />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders custom title and description", () => {
    render(<EmptyState title="No materials" description="Create your first material" />);
    expect(screen.getByText("No materials")).toBeInTheDocument();
    expect(screen.getByText("Create your first material")).toBeInTheDocument();
  });
});
