import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, ErrorState, Spinner, TableSkeleton } from '@/components/states';
import { JsonView } from '@/components/JsonView';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { number } from '@/lib/utils';
import type { Buyer, DeliveryMethod, DeliveryResult } from '@/lib/types';

interface Draft {
  id?: string;
  name: string;
  active: boolean;
  deliveryUrl: string;
  deliveryMethod: DeliveryMethod;
  headersText: string;
  mappingText: string;
}

const BLANK: Draft = {
  name: '',
  active: true,
  deliveryUrl: '',
  deliveryMethod: 'json',
  headersText: '{}',
  mappingText: '{}',
};

function toDraft(buyer: Buyer): Draft {
  return {
    id: buyer.id,
    name: buyer.name,
    active: buyer.active,
    deliveryUrl: buyer.deliveryUrl ?? '',
    deliveryMethod: buyer.deliveryMethod,
    headersText: JSON.stringify(buyer.deliveryHeaders ?? {}, null, 2),
    mappingText: JSON.stringify(buyer.fieldMapping ?? {}, null, 2),
  };
}

function parseJsonObject(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
}

export function BuyersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [testResult, setTestResult] = React.useState<DeliveryResult | null>(null);

  const buyers = useQuery({ queryKey: ['buyers'], queryFn: () => api.get<Buyer[]>('/api/buyers') });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['buyers'] });
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  }

  const save = useMutation({
    mutationFn: (input: Draft) => {
      const body = {
        name: input.name,
        active: input.active,
        deliveryUrl: input.deliveryUrl.trim() || null,
        deliveryMethod: input.deliveryMethod,
        deliveryHeaders: parseJsonObject(input.headersText),
        fieldMapping: parseJsonObject(input.mappingText),
      };
      return input.id
        ? api.patch<Buyer>(`/api/buyers/${input.id}`, body)
        : api.post<Buyer>('/api/buyers', body);
    },
    onSuccess: (_data, input) => {
      invalidate();
      setDraft(null);
      toast.success(input.id ? 'Buyer updated' : 'Buyer created');
    },
    onError: (err) => toast.error('Could not save buyer', (err as Error).message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<Buyer>(`/api/buyers/${id}`, { active }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['buyers'] });
      const previous = queryClient.getQueryData<Buyer[]>(['buyers']);
      queryClient.setQueryData<Buyer[]>(['buyers'], (old) =>
        (old ?? []).map((b) => (b.id === id ? { ...b, active } : b))
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(['buyers'], context?.previous);
      toast.error('Could not update buyer', (err as Error).message);
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/buyers/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Buyer deleted');
    },
    onError: (err) => toast.error('Could not delete buyer', (err as Error).message),
  });

  const testDelivery = useMutation({
    mutationFn: (id: string) => api.post<DeliveryResult>(`/api/buyers/${id}/test-delivery`),
    onSuccess: (result) => {
      setTestResult(result);
      if (result.outcome === 'delivered') {
        toast.success('Test delivery accepted', `HTTP ${result.status} from ${result.url}`);
      } else if (result.outcome === 'skipped') {
        toast.toast({ title: 'No endpoint configured', description: result.error });
      } else {
        toast.error('Test delivery failed', result.error ?? `HTTP ${result.status}`);
      }
    },
    onError: (err) => toast.error('Test delivery failed', (err as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Buyers"
        description="A buyer is any HTTP endpoint. Configure the URL, body format, headers and optional field mapping — that's the entire integration."
        actions={
          <Button onClick={() => setDraft({ ...BLANK })}>
            <Plus /> New buyer
          </Button>
        }
      />

      <Card>
        {buyers.isLoading ? (
          <TableSkeleton cols={6} />
        ) : buyers.isError ? (
          <ErrorState error={buyers.error} onRetry={() => void buyers.refetch()} />
        ) : (buyers.data ?? []).length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No buyers yet"
            description="Add the systems that should receive your leads. Any webhook-capable endpoint works."
            action={
              <Button size="sm" onClick={() => setDraft({ ...BLANK })}>
                <Plus /> New buyer
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Buyer</TableHead>
                <TableHead>Delivery endpoint</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Mapping</TableHead>
                <TableHead className="text-right">Campaigns</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(buyers.data ?? []).map((buyer) => (
                <TableRow key={buyer.id}>
                  <TableCell className="font-medium">{buyer.name}</TableCell>
                  <TableCell className="max-w-[280px]">
                    {buyer.deliveryUrl ? (
                      <code
                        className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                        title={buyer.deliveryUrl}
                      >
                        {buyer.deliveryUrl}
                      </code>
                    ) : (
                      <Badge variant="warning">manual pickup</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="muted">{buyer.deliveryMethod}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {Object.keys(buyer.fieldMapping ?? {}).length
                      ? `${Object.keys(buyer.fieldMapping).length} field(s)`
                      : 'pass-through'}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {number(buyer._count?.campaigns)}
                  </TableCell>
                  <TableCell className="tabular text-right">{number(buyer._count?.leads)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={buyer.active}
                      onCheckedChange={(active) => toggleActive.mutate({ id: buyer.id, active })}
                      aria-label="Toggle active"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Send test delivery"
                        title="Send test delivery"
                        disabled={testDelivery.isPending}
                        onClick={() => testDelivery.mutate(buyer.id)}
                      >
                        <Zap className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit"
                        onClick={() => setDraft(toDraft(buyer))}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        onClick={() => {
                          if (confirm(`Delete buyer "${buyer.name}" and its campaigns?`))
                            remove.mutate(buyer.id);
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

      {/* Test delivery result */}
      <Dialog open={!!testResult} onOpenChange={(open) => !open && setTestResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test delivery</DialogTitle>
            <DialogDescription>
              A synthetic lead sent to this buyer's endpoint, exactly as a real award would be.
            </DialogDescription>
          </DialogHeader>
          <JsonView value={testResult} className="mt-2" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestResult(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent side="right">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? 'Edit buyer' : 'New buyer'}</DialogTitle>
                <DialogDescription>
                  Delivery is a plain webhook. Leave the URL empty to mark leads `sold` for manual
                  pickup instead.
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 space-y-5 py-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={draft.name}
                    placeholder="e.g. Acme CRM"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id="b-active"
                    checked={draft.active}
                    onCheckedChange={(active) => setDraft({ ...draft, active })}
                  />
                  <Label htmlFor="b-active">Active — their campaigns may bid</Label>
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <div className="space-y-1.5">
                    <Label>Delivery URL</Label>
                    <Input
                      value={draft.deliveryUrl}
                      placeholder="https://buyer.example.com/api/leads"
                      className="font-mono text-xs"
                      onChange={(e) => setDraft({ ...draft, deliveryUrl: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Body format</Label>
                    <Select
                      value={draft.deliveryMethod}
                      onValueChange={(deliveryMethod) =>
                        setDraft({ ...draft, deliveryMethod: deliveryMethod as DeliveryMethod })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="json">JSON</SelectItem>
                        <SelectItem value="form">Form-encoded</SelectItem>
                        <SelectItem value="xml">XML</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Headers (JSON object)</Label>
                  <Textarea
                    value={draft.headersText}
                    rows={4}
                    className="font-mono text-xs"
                    onChange={(e) => setDraft({ ...draft, headersText: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    e.g. <code>{'{"Authorization": "Bearer abc123"}'}</code>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Field mapping (JSON object)</Label>
                  <Textarea
                    value={draft.mappingText}
                    rows={6}
                    className="font-mono text-xs"
                    onChange={(e) => setDraft({ ...draft, mappingText: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Maps <code>outgoing_name</code> → <code>lead_field</code>, e.g.{' '}
                    <code>{'{"FirstName": "first_name"}'}</code>. When non-empty it doubles as an
                    allow-list: only mapped fields are sent. Leave as <code>{'{}'}</code> to send the
                    whole lead unchanged.
                  </p>
                </div>
              </div>

              <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !draft.name}>
                  {save.isPending ? <Spinner /> : null}
                  {draft.id ? 'Save changes' : 'Create buyer'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
