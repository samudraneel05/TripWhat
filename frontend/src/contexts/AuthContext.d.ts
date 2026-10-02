import type { ReactNode } from 'react';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  bio?: string | null;
  avatar_url?: string | null;
  preferences?: Record<string, any> | null;
  [key: string]: any;
}

export interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (email: string, password: string, userData: { name: string }) => Promise<void>;
  logout: () => void;
  updateUser: (updatedUserData: Partial<AuthUser>) => void;
  loading: boolean;
  isAuthenticated: boolean;
}

export function AuthProvider(props: { children: ReactNode }): JSX.Element;
export function useAuth(): AuthContextValue;
