import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../api", () => ({
  login: vi.fn(),
}));

import { login } from "../api";
import LoginPage from "../pages/LoginPage";

function renderLogin() {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </BrowserRouter>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders login form", () => {
    renderLogin();
    expect(screen.getByText("Thermaltrue WMS")).toBeInTheDocument();
    expect(screen.getByText("Sign In")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows error on failed login", async () => {
    const user = userEvent.setup();
    vi.mocked(login).mockRejectedValue("Invalid credentials");
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByText("Sign In"));

    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
  });
});
