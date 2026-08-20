import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
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
import { FieldSchemaBuilder } from '@/components/FieldSchemaBuilder';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/lib/api';
import { number } from '@/lib/utils';
import type { Vertical, VerticalField } from '@/lib/types';

interface Draft {
  id?: string;
  key: string;
  name: string;
  active: boolean;
  fieldSchema: VerticalField[];
}

const BLANK: Draft = { key: '', name: '', active: true, fieldSchema: [] };

export function VerticalsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const verticals = useQuery({
    queryKey: ['verticals'],
    queryFn: () => api.get<Vertical[]>('/api/verticals'),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['verticals'] });
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  }

  const save = useMutation({
    mutationFn: async (input: Draft) => {
      const body = {
        key: input.key,
        name: input.name,
        active: input.active,
        fieldSchema: input.fieldSchema,
      };
      return input.id
        ? api.patch<Vertical>(`/api/verticals/${input.id}`, body)
        : api.post<Vertical>('/api/verticals', body);
    },
    onSuccess: (_data, input) => {
      invalidate();
      setDraft(null);
      toast.success(
        input.id ? 'Vertical updated' : `Vertical "${input.name}" created`,
        input.id
          ? undefined
          : 'It is already selectable in Campaigns and the Playground — no deployment needed.'
      );
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && Array.isArray(err.details)
          ? (err.details as { message: string }[]).map((d) => d.message).join('; ')
          : undefined;
      toast.error('Could not save vertical', detail ?? (err as Error).message);
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<Vertical>(`/api/verticals/${id}`, { active }),
    // Optimistic: the switch flips immediately and rolls back on failure.
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['verticals'] });
      const previous = queryClient.getQueryData<Vertical[]>(['verticals']);
      queryClient.setQueryData<Vertical[]>(['verticals'], (old) =>
        (old ?? []).map((v) => (v.id === id ? { ...v, active } : v))
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(['verticals'], context?.previous);
      toast.error('Could not update vertical', (err as Error).message);
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (vertical: Vertical) =>
      api.del(`/api/verticals/${vertical.id}`, {
        force: (vertical._count?.leads ?? 0) > 0 ? 'true' : undefined,
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Vertical deleted');
    },
    onError: (err) => toast.error('Could not delete vertical', (err as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Verticals"
        description="A vertical is a niche you define. Its field schema drives ping validation, the lead forms, and every campaign's filter builder — defining one is configuration, never a code change."
        actions={
          <Button onClick={() => setDraft({ ...BLANK })}>
            <Plus /> New vertical
          </Button>
        }
      />

      <Card>
        {verticals.isLoading ? (
          <TableSkeleton cols={6} />
        ) : verticals.isError ? (
          <ErrorState error={verticals.error} onRetry={() => void verticals.refetch()} />
        ) : (verticals.data ?? []).length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No verticals yet"
            description="Create your first niche — name it, add the attributes it qualifies on, and it becomes immediately available to campaigns, the API and the Playground."
            action={
              <Button size="sm" onClick={() => setDraft({ ...BLANK })}>
                <Plus /> New vertical
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead className="text-right">Campaigns</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(verticals.data ?? []).map((vertical) => (
                <TableRow key={vertical.id}>
                  <TableCell className="font-medium">{vertical.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {vertical.key}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {vertical.fieldSchema.length === 0 ? (
                        <span className="text-xs text-muted-foreground">geo only</span>
                      ) : (
                        vertical.fieldSchema.map((f) => (
                          <Badge key={f.name} variant="muted" title={`${f.name} · ${f.type}`}>
                            {f.label}
                            {f.required ? <span className="ml-0.5 text-destructive">*</span> : null}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {number(vertical._count?.campaigns)}
                  </TableCell>
                  <TableCell className="tabular text-right">{number(vertical._count?.leads)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={vertical.active}
                      onCheckedChange={(active) => toggleActive.mutate({ id: vertical.id, active })}
                      aria-label="Toggle active"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit"
                        onClick={() =>
                          setDraft({
                            id: vertical.id,
                            key: vertical.key,
                            name: vertical.name,
                            active: vertical.active,
                            fieldSchema: vertical.fieldSchema ?? [],
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        onClick={() => {
                          const leads = vertical._count?.leads ?? 0;
                          const message = leads
                            ? `Delete "${vertical.name}" and its ${leads} lead(s)? This cannot be undone.`
                            : `Delete "${vertical.name}"?`;
                          if (confirm(message)) remove.mutate(vertical);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent side="right">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? 'Edit vertical' : 'New vertical'}</DialogTitle>
                <DialogDescription>
                  Everything you define here flows straight through to the API and the UI. No
                  redeploy, no migration.
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 space-y-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="v-name">Display name</Label>
                    <Input
                      id="v-name"
                      value={draft.name}
                      placeholder="e.g. Commercial Solar"
                      onChange={(e) => {
                        const name = e.target.value;
                        const autoKey = name
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '_')
                          .replace(/^_+|_+$/g, '');
                        setDraft({
                          ...draft,
                          name,
                          // Only auto-fill the key while creating.
                          ...(draft.id ? {} : { key: autoKey }),
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="v-key">
                      Key <span className="text-muted-foreground">(sent as `vertical` on a ping)</span>
                    </Label>
                    <Input
                      id="v-key"
                      value={draft.key}
                      placeholder="commercial_solar"
                      className="font-mono text-xs"
                      onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id="v-active"
                    checked={draft.active}
                    onCheckedChange={(active) => setDraft({ ...draft, active })}
                  />
                  <Label htmlFor="v-active">Active — accepts pings</Label>
                </div>

                <div className="space-y-2">
                  <div>
                    <Label>Field schema</Label>
                    <p className="text-xs text-muted-foreground">
                      The qualifying attributes for this niche. `state` and `zip` are always
                      collected and don't need to be listed here.
                    </p>
                  </div>
                  <FieldSchemaBuilder
                    fields={draft.fieldSchema}
                    onChange={(fieldSchema) => setDraft({ ...draft, fieldSchema })}
                  />
                </div>
              </div>

              <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => save.mutate(draft)}
                  disabled={save.isPending || !draft.name || !draft.key}
                >
                  {save.isPending ? <Spinner /> : null}
                  {draft.id ? 'Save changes' : 'Create vertical'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
