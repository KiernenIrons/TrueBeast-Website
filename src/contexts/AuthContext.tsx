import { createContext, useContext, useEffect, useState } from 'react';
import { type User } from 'firebase/auth';
import { FirebaseDB } from '@/lib/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = FirebaseDB.onAuthStateChanged((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function login(email: string, password: string) {
    await FirebaseDB.adminSignIn(email, password);
  }

  async function logout() {
    await FirebaseDB.adminSignOut();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
