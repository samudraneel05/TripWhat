import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTripStore } from "../stores/tripStore";
import api from "../lib/api";

export interface UserPreferences {
  budget?: string;
  travelStyle?: string;
  interests?: string[];
  [key: string]: unknown;
}

export interface User {
  id: number | string;
  name: string;
  email: string;
  bio?: string;
  avatarUrl?: string;
  preferences?: UserPreferences;
  [key: string]: unknown;
}

interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string, userData: { name: string }) => Promise<void>;
  logout: () => void;
  updateUser: (updatedUserData: Partial<User>) => void;
  loginWithToken: (token: string) => Promise<User | null>;
  loading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const errMessage = (err: unknown, fallback: string): string => {
  const data = (err as any)?.response?.data;
  return (typeof data?.detail === "string" && data.detail) || data?.message || fallback;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("tripwhat_token");
    if (token) {
      // Verify token and get user info
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async (): Promise<User | null> => {
    try {
      // Backend returns { user: { id, name, email } }
      const res = await api.get("/api/auth/me");
      setUser(res.data.user);
      return res.data.user;
    } catch {
      localStorage.removeItem("tripwhat_token");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<User> => {
    try {
      const res = await api.post("/api/auth/login", { email, password });
      const { token, user } = res.data;
      localStorage.setItem("tripwhat_token", token);
      setUser(user);
      return user; // So login page can handle redirect
    } catch (err) {
      throw new Error(errMessage(err, "Login failed"));
    }
  };

  const signup = async (email: string, password: string, userData: { name: string }): Promise<void> => {
    try {
      const res = await api.post("/api/auth/register", {
        name: userData.name,
        email,
        password,
      });
      const { token, user } = res.data;
      localStorage.setItem("tripwhat_token", token);
      setUser(user);
    } catch (err) {
      throw new Error(errMessage(err, "Signup failed"));
    }
  };

  const logout = () => {
    useTripStore.getState().disconnectSocket();
    localStorage.removeItem("tripwhat_token");
    setUser(null);
  };

  // For pages that already hold a token (Google OAuth callback). Stores it
  // and fetches the user so ProtectedRoute sees a logged-in session — the
  // mount-time token check in the effect above races with children that
  // store the token in their own effects, so we do it explicitly here.
  const loginWithToken = async (token: string): Promise<User | null> => {
    localStorage.setItem("tripwhat_token", token);
    return await fetchUser();
  };

  const updateUser = (updatedUserData: Partial<User>) => {
    setUser(prev => (prev ? { ...prev, ...updatedUserData } : prev));
  };

  const value: AuthContextValue = {
    user,
    login,
    signup,
    logout,
    updateUser,
    loginWithToken,
    loading,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
