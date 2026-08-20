import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

interface Admin {
  id: string;
  email: string;
}

interface AuthValue {
  admin: Admin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // The session is an httpOnly cookie, so "am I signed in?" is a server question.
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Admin>('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const value = React.useMemo<AuthValue>(
    () => ({
      admin: data ?? null,
      loading: isLoading,
      login: async (email, password) => {
        await api.post('/api/auth/login', { email, password });
        await queryClient.invalidateQueries();
      },
      logout: async () => {
        await api.post('/api/auth/logout');
        queryClient.clear();
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      },
    }),
    [data, isLoading, queryClient]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
