import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, ShieldCheck, Timer } from 'lucide-react';
import { PageHeader } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState, Spinner } from '@/components/states';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { PlatformSettings, RoutingStrategy } from '@/lib/types';

const STRATEGY_COPY: Record<RoutingStrategy, { title: string; description: string }> = {
  bid: {
    title: 'Highest bid',
    description:
      'The campaign paying the most wins. The revenue-maximising exchange model — use this when you sell to the open market.',
  },
  priority: {
    title: 'Priority waterfall',
    description:
      'The campaign with the lowest routing priority wins, regardless of bid. Use this when contractual preference outranks price.',
  },
  round_robin: {
    title: 'Round robin',
    description:
      'Accepting campaigns take turns, one per ping, per vertical. Use this to distribute volume evenly across buyers.',
  },
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<PlatformSettings>('/api/settings'),
  });

  const [dedupWindowDays, setDedupWindowDays] = React.useState('');
  const [pingTtlSeconds, setPingTtlSeconds] = React.useState('');
  const [timezone, setTimezone] = React.useState('');
  const [phoneRegion, setPhoneRegion] = React.useState('');

  // Seed the local fields once the server values land.
  React.useEffect(() => {
    if (!settings.data) return;
    setDedupWindowDays(String(settings.data.dedupWindowDays));
    setPingTtlSeconds(String(settings.data.pingTtlSeconds));
    setTimezone(settings.data.timezone);
    setPhoneRegion(settings.data.defaultPhoneRegion);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<PlatformSettings>) =>
      api.patch<PlatformSettings>('/api/settings', patch),
    onSuccess: (data, patch) => {
      queryClient.setQueryData(['settings'], data);
      // Auction outcomes depend on these, so anything cached is now stale.
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast.success(
        patch.routingStrategy ? `Routing strategy set to "${patch.routingStrategy}"` : 'Settings saved',
        patch.routingStrategy ? 'The next ping will be ranked with the new strategy.' : undefined
      );
    },
    onError: (err) => toast.error('Could not save settings', (err as Error).message),
  });

  if (settings.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }

  const current = settings.data!;
  const dirty =
    String(current.dedupWindowDays) !== dedupWindowDays ||
    String(current.pingTtlSeconds) !== pingTtlSeconds ||
    current.timezone !== timezone ||
    current.defaultPhoneRegion !== phoneRegion;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Global auction configuration. Changes take effect on the next ping — no restart."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gavel className="h-4 w-4" /> Routing strategy
            </CardTitle>
            <CardDescription>
              Decides which accepting campaign is ranked first. The full ranked offer list always
              goes back to the source either way, so a source can still pick a different offer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {current.routingStrategies.map((strategy) => {
              const copy = STRATEGY_COPY[strategy];
              const selected = current.routingStrategy === strategy;
              return (
                <button
                  key={strategy}
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ routingStrategy: strategy })}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    selected ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                      selected ? 'border-primary' : 'border-muted-foreground/40'
                    )}
                  >
                    {selected ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {copy?.title ?? strategy}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {strategy}
                      </code>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {copy?.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4" /> Deduplication &amp; timing
            </CardTitle>
            <CardDescription>
              Duplicates are matched on a normalised hash of phone or email, scoped to a single
              vertical.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="dedup">Dedup window (days)</Label>
                <Input
                  id="dedup"
                  type="number"
                  min="0"
                  value={dedupWindowDays}
                  onChange={(e) => setDedupWindowDays(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">0 disables dedup entirely.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ttl">
                  <Timer className="mr-1 inline h-3 w-3" />
                  Ping TTL (seconds)
                </Label>
                <Input
                  id="ttl"
                  type="number"
                  min="10"
                  value={pingTtlSeconds}
                  onChange={(e) => setPingTtlSeconds(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  How long a ping_id stays postable. Default 300 (5 min).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tz">Platform timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger id="tz">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      'UTC',
                      'America/New_York',
                      'America/Chicago',
                      'America/Denver',
                      'America/Los_Angeles',
                      'America/Phoenix',
                      'Europe/London',
                      'Europe/Berlin',
                      'Asia/Dubai',
                      'Asia/Singapore',
                      'Australia/Sydney',
                    ].map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Used for dayparting and for "today" in caps and reports.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="region">Phone region</Label>
                <Select value={phoneRegion} onValueChange={setPhoneRegion}>
                  <SelectTrigger id="region">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'MX', 'BR', 'IN', 'ZA'].map(
                      (r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  How to read phone numbers written without a country code. Numbers sent in
                  +E.164 form are understood either way.
                </p>
              </div>
            </div>

            <Button
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({
                  dedupWindowDays: Number(dedupWindowDays),
                  pingTtlSeconds: Number(pingTtlSeconds),
                  timezone,
                  defaultPhoneRegion: phoneRegion,
                })
              }
            >
              {save.isPending ? <Spinner /> : null}
              Save changes
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
