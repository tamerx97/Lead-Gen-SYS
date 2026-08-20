import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, UNAUTHORIZED_EVENT } from '@/lib/api';

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

  // If the session dies while the dashboard is open — it expired, or another
  // tab signed out — drop straight back to the login screen rather than leaving
  // a shell up whose every request fails.
  React.useEffect(() => {
    function onUnauthorized() {
      if (queryClient.getQueryData(['me']) !== null) {
        queryClient.setQueryData(['me'], null);
      }
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

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

        // Record that we are signed out *first*. This flips `admin` to null,
        // which unmounts the dashboard and sends the user to the login screen.
        queryClient.setQueryData(['me'], null);

        // Then drop every other page's cached data so the next sign-in starts
        // clean. Deliberately NOT queryClient.clear(): that destroys the query
        // object this provider's useQuery is bound to, after which the observer
        // keeps reporting the old signed-in value and any later write lands on
        // a new entry nobody is watching — which left the user stuck on a dead
        // dashboard whose every request 401'd.
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== 'me',
        });
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
