import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Eye, EyeOff, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { PageHeader } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, ErrorState, Spinner, TableSkeleton } from '@/components/states';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { number, percent } from '@/lib/utils';
import type { RollupRow, Source } from '@/lib/types';

function ApiKeyCell({ apiKey }: { apiKey: string }) {
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  return (
    <div className="flex items-center gap-1">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {revealed ? apiKey : `${apiKey.slice(0, 8)}${'•'.repeat(16)}`}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? 'Hide key' : 'Reveal key'}
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy key"
        onClick={() => {
          void navigator.clipboard.writeText(apiKey);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

export function SourcesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');

  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<Source[]>('/api/sources'),
  });

  // Per-source volume and fill rate for the last 30 days.
  const rollup = useQuery({
    queryKey: ['stats-rollup', 'source'],
    queryFn: () => api.get<{ rows: RollupRow[] }>('/api/stats/rollup', { by: 'source', days: 30 }),
  });

  const statsById = new Map((rollup.data?.rows ?? []).map((r) => [r.id, r]));

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
  }

  const create = useMutation({
    mutationFn: () => api.post<Source>('/api/sources', { name }),
    onSuccess: (source) => {
      invalidate();
      setCreating(false);
      setName('');
      toast.success(`Source "${source.name}" created`, 'Copy its API key — it authenticates every ping and post.');
    },
    onError: (err) => toast.error('Could not create source', (err as Error).message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<Source>(`/api/sources/${id}`, { active }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['sources'] });
      const previous = queryClient.getQueryData<Source[]>(['sources']);
      queryClient.setQueryData<Source[]>(['sources'], (old) =>
        (old ?? []).map((s) => (s.id === id ? { ...s, active } : s))
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(['sources'], context?.previous);
      toast.error('Could not update source', (err as Error).message);
    },
    onSettled: invalidate,
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.post<Source>(`/api/sources/${id}/rotate-key`),
    onSuccess: () => {
      invalidate();
      toast.success('API key rotated', 'The previous key stopped working immediately.');
    },
    onError: (err) => toast.error('Could not rotate key', (err as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/sources/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Source deleted');
    },
    onError: (err) => toast.error('Could not delete source', (err as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Sources"
        description="Lead publishers. Each gets an API key sent as X-Api-Key on every ping and post."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New source
          </Button>
        }
      />

      <Card>
        {sources.isLoading ? (
          <TableSkeleton cols={6} />
        ) : sources.isError ? (
          <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
        ) : (sources.data ?? []).length === 0 ? (
          <EmptyState
            icon={Users}
            title="No sources yet"
            description="Create a source to get an API key, then point a lead vendor or your own form at POST /api/ping."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New source
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>API key</TableHead>
                <TableHead className="text-right">Pings (30d)</TableHead>
                <TableHead className="text-right">Fill rate</TableHead>
                <TableHead className="text-right">Leads sold</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sources.data ?? []).map((source) => {
                const stats = statsById.get(source.id);
                return (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">{source.name}</TableCell>
                    <TableCell>
                      <ApiKeyCell apiKey={source.apiKey} />
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {number(stats?.extra?.pings ?? 0)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {stats?.extra?.pings ? percent(stats.extra.fillRate) : '—'}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {number(source._count?.leads)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={source.active}
                        onCheckedChange={(active) => toggleActive.mutate({ id: source.id, active })}
                        aria-label="Toggle active"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Rotate API key"
                          title="Rotate API key"
                          onClick={() => {
                            if (
                              confirm(
                                `Rotate the API key for "${source.name}"? Anything using the old key stops working immediately.`
                              )
                            )
                              rotate.mutate(source.id);
                          }}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete"
                          onClick={() => {
                            if (confirm(`Delete source "${source.name}" and its history?`))
                              remove.mutate(source.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New source</DialogTitle>
            <DialogDescription>
              An API key is generated automatically. You can rotate it at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="s-name">Name</Label>
            <Input
              id="s-name"
              value={name}
              placeholder="e.g. Partner Web Forms"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) create.mutate();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
              {create.isPending ? <Spinner /> : null}
              Create source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
