import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/auth';
import { Spinner } from '@/components/states';
import { LoginPage } from '@/pages/Login';
import { OverviewPage } from '@/pages/Overview';
import { VerticalsPage } from '@/pages/Verticals';
import { CampaignsPage } from '@/pages/Campaigns';
import { BuyersPage } from '@/pages/Buyers';
import { SourcesPage } from '@/pages/Sources';
import { LeadsPage } from '@/pages/Leads';
import { PingsPage } from '@/pages/Pings';
import { PlaygroundPage } from '@/pages/Playground';
import { SettingsPage } from '@/pages/Settings';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  if (!admin) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<OverviewPage />} />
        <Route path="/verticals" element={<VerticalsPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/buyers" element={<BuyersPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/pings" element={<PingsPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
