import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Radio, RotateCw, Search } from 'lucide-react';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { dateTime, money, number } from '@/lib/utils';
import type { Buyer, Lead, LeadStatus, Paginated, Vertical } from '@/lib/types';

const ALL = 'all';

const STATUS_VARIANT: Record<LeadStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  delivered: 'success',
  sold: 'warning',
  delivery_failed: 'destructive',
  rejected_dup: 'muted',
};

export function LeadsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [status, setStatus] = React.useState(ALL);
  const [verticalId, setVerticalId] = React.useState(ALL);
  const [buyerId, setBuyerId] = React.useState(ALL);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = {
    page,
    pageSize: 25,
    ...(debounced ? { q: debounced } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(verticalId !== ALL ? { verticalId } : {}),
    ...(buyerId !== ALL ? { buyerId } : {}),
  };

  const verticals = useQuery({
    queryKey: ['verticals'],
    queryFn: () => api.get<Vertical[]>('/api/verticals'),
  });
  const buyers = useQuery({ queryKey: ['buyers'], queryFn: () => api.get<Buyer[]>('/api/buyers') });
  const leads = useQuery({
    queryKey: ['leads', params],
    queryFn: () => api.get<Paginated<Lead>>('/api/leads', params),
  });

  const redeliver = useMutation({
    mutationFn: (id: string) => api.post<{ delivery: { outcome: string; status?: number } }>(
      `/api/leads/${id}/redeliver`
    ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      if (result.delivery.outcome === 'delivered') {
        toast.success('Redelivered', `HTTP ${result.delivery.status}`);
      } else {
        toast.error('Redelivery failed', `outcome: ${result.delivery.outcome}`);
      }
    },
    onError: (err) => toast.error('Redelivery failed', (err as Error).message),
  });

  const rows = leads.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Every awarded lead, with the price paid and the buyer's delivery response."
      />

      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name, phone, email, lead id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            value={verticalId}
            onValueChange={(v) => {
              setVerticalId(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All verticals</SelectItem>
              {(verticals.data ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={buyerId}
            onValueChange={(v) => {
              setBuyerId(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All buyers</SelectItem>
              {(buyers.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="sold">Sold (awaiting pickup)</SelectItem>
              <SelectItem value="delivery_failed">Delivery failed</SelectItem>
              <SelectItem value="rejected_dup">Duplicate</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        {leads.isLoading ? (
          <TableSkeleton cols={7} />
        ) : leads.isError ? (
          <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="No leads match"
            description="Sell one from the Playground, or clear the filters above."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Received</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((lead) => {
                  const isOpen = expanded === lead.id;
                  return (
                    <React.Fragment key={lead.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : lead.id)}
                      >
                        <TableCell>
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateTime(lead.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium">{lead.buyer?.name ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {lead.campaign?.name ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="muted">{lead.vertical?.key}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{lead.source?.name}</TableCell>
                        <TableCell className="tabular text-right font-semibold">
                          {money(lead.price)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[lead.status]}>
                            {lead.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {lead.status === 'delivery_failed' && lead.buyerId ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Retry delivery"
                              title="Retry delivery"
                              disabled={redeliver.isPending}
                              onClick={() => redeliver.mutate(lead.id)}
                            >
                              <RotateCw className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>

                      {isOpen ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="bg-muted/30 p-4">
                            <div className="grid gap-3 lg:grid-cols-2">
                              <JsonView value={lead.payload} label="Lead payload (incl. PII)" />
                              <JsonView
                                value={lead.deliveryResponse ?? { note: 'No delivery recorded' }}
                                label={`Delivery — ${lead.deliveryAttempts} attempt(s)`}
                              />
                            </div>
                            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                              lead_id {lead.id}
                              {lead.pingId ? ` · ping_id ${lead.pingId}` : ''}
                            </p>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
              <p className="text-muted-foreground">
                {number(leads.data?.total)} lead{leads.data?.total === 1 ? '' : 's'}
                {leads.data?.revenue !== undefined ? ` · ${money(leads.data.revenue)} total` : ''}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || leads.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="tabular text-xs text-muted-foreground">
                  {leads.isFetching ? <Spinner /> : `Page ${page} of ${leads.data?.totalPages ?? 1}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= (leads.data?.totalPages ?? 1) || leads.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
