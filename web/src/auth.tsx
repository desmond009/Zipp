import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type User } from './api';

interface AuthState {
  /** undefined while we're still asking the server, null for guests. */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * The session itself lives in an httpOnly cookie that JavaScript can't read,
 * so on load we ask the server who we are.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
  }, []);

  const state: AuthState = {
    user,
    login: async (email, password) => setUser(await api.login(email, password)),
    register: async (email, password) => setUser(await api.register(email, password)),
    logout: async () => {
      await api.logout();
      setUser(null);
    },
  };

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return state;
}
