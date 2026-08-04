import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import type { User } from "../api";
import { logout as apiLogout, getRoles } from "../api";

function parsePermissions(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  can: (permission: string) => boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  refreshRoles: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  can: () => false,
  login: () => {},
  logout: () => {},
  refreshRoles: () => {},
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
  const [rolePerms, setRolePerms] = useState<Record<string, string[]> | null>(null);

  const loadRoles = useCallback(() => {
    if (!token) return;
    getRoles()
      .then((roles) => {
        const map: Record<string, string[]> = {};
        roles.forEach((r) => {
          map[r.name] = parsePermissions(r.permissions);
        });
        setRolePerms(map);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const can = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      const perms = rolePerms?.[user.role];
      if (!perms) return false;
      return perms.includes("*") || perms.includes(permission);
    },
    [user, rolePerms]
  );

  const login = useCallback((user: User, token: string) => {
    setUser(user);
    setToken(token);
    saveAuth(user, token);
  }, []);

  const logout = useCallback(() => {
    apiLogout().catch(() => {});
    setUser(null);
    setToken(null);
    setRolePerms(null);
    clearAuth();
  }, []);

  const refreshRoles = useCallback(() => {
    if (!token) return;
    getRoles()
      .then((roles) => {
        const map: Record<string, string[]> = {};
        roles.forEach((r) => {
          map[r.name] = parsePermissions(r.permissions);
        });
        setRolePerms(map);
      })
      .catch(() => {});
  }, [token]);

  const value = useMemo(
    () => ({ user, token, can, login, logout, refreshRoles }),
    [user, token, can, login, logout, refreshRoles]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
