import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { User } from "../api";
import { logout as apiLogout } from "../api";

const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
};

// Required role level for each action
const PERMISSIONS: Record<string, number> = {
  "manage_users": 3,           // admin only
  "manage_settings": 2,        // manager+
  "manage_materials": 1,       // operator+
  "manage_transactions": 1,    // operator+
  "manage_warehouse": 2,       // manager+
  "delete_any": 2,             // manager+
  "view_reports": 0,           // everyone
  "view_analysis": 0,          // everyone
  "approve_transfer": 2,       // manager+
  "cycle_count": 1,            // operator+
  "create_user": 3,            // admin only
  "adjust_opname": 2,          // manager+
  "view_cost": 2,              // manager+
  "export_data": 1,            // operator+
  "purge_logs": 2,             // manager+
  "restore_database": 2,       // manager+
};

interface AuthContextType {
  user: User | null;
  token: string | null;
  can: (permission: string) => boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  can: () => false,
  login: () => {},
  logout: () => {},
});

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem("wms_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadToken(): string | null {
  return localStorage.getItem("wms_token");
}

function saveAuth(user: User, token: string) {
  localStorage.setItem("wms_user", JSON.stringify(user));
  localStorage.setItem("wms_token", token);
}

function clearAuth() {
  localStorage.removeItem("wms_user");
  localStorage.removeItem("wms_token");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadUser);
  const [token, setToken] = useState<string | null>(loadToken);

  const can = useCallback((permission: string): boolean => {
    if (!user) return false;
    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const requiredLevel = PERMISSIONS[permission] ?? 0;
    return userLevel >= requiredLevel;
  }, [user]);

  const login = useCallback((user: User, token: string) => {
    setUser(user);
    setToken(token);
    saveAuth(user, token);
  }, []);

  const logout = useCallback(() => {
    apiLogout().catch(() => {});
    setUser(null);
    setToken(null);
    clearAuth();
  }, []);

  const value = useMemo(() => ({ user, token, can, login, logout }), [user, token, can, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
