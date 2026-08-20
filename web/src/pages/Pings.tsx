import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Radio } from 'lucide-react';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { api } from '@/lib/api';
import { dateTime, money, number } from '@/lib/utils';
import type { Paginated, Ping, PingStatus, Vertical } from '@/lib/types';

const ALL = 'all';

const STATUS_VARIANT: Record<PingStatus, 'success' | 'warning' | 'muted' | 'default'> = {
  posted: 'success',
  open: 'default',
  no_bid: 'warning',
  expired: 'muted',
};

export function PingsPage() {
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState(ALL);
  const [verticalId, setVerticalId] = React.useState(ALL);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const params = {
    page,
    pageSize: 25,
    ...(status !== ALL ? { status } : {}),
    ...(verticalId !== ALL ? { verticalId } : {}),
  };

  const verticals = useQuery({
    queryKey: ['verticals'],
    queryFn: () => api.get<Vertical[]>('/api/verticals'),
  });
  const pings = useQuery({
    queryKey: ['pings', params],
    queryFn: () => api.get<Paginated<Ping>>('/api/pings', params),
    refetchInterval: 15_000,
  });

  const rows = pings.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Pings"
        description="Every auction run, whether or not it converted into a sale. A ping never sells — it only produces offers."
        actions={
          <>
            <Select
              value={verticalId}
              onValueChange={(v) => {
                setVerticalId(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[180px]">
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
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="no_bid">No bid</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      <Card>
        {pings.isLoading ? (
          <TableSkeleton cols={7} />
        ) : pings.isError ? (
          <ErrorState error={pings.error} onRetry={() => void pings.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="No pings yet"
            description="Run one from the Playground, or POST to /api/ping with a source API key."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Received</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Geo</TableHead>
                  <TableHead className="text-right">Matched</TableHead>
                  <TableHead className="text-right">Best bid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((ping) => {
                  const isOpen = expanded === ping.id;
                  const payload = ping.payload ?? {};
                  return (
                    <React.Fragment key={ping.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : ping.id)}
                      >
                        <TableCell>
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateTime(ping.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="muted">{ping.vertical?.key}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{ping.source?.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {[payload.state, payload.zip].filter(Boolean).join(' ') || '—'}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {number(ping.matched?.length ?? 0)}
                          {ping.rejected?.length ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              /{ping.matched.length + ping.rejected.length}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="tabular text-right font-semibold">
                          {ping.bestBid ? money(ping.bestBid) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[ping.status]}>
                            {ping.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {dateTime(ping.expiresAt)}
                        </TableCell>
                      </TableRow>

                      {isOpen ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="bg-muted/30 p-4">
                            <div className="grid gap-3 lg:grid-cols-3">
                              <JsonView value={payload} label="Ping payload (non-PII)" />
                              <JsonView value={ping.matched} label="Ranked offers" />
                              <JsonView value={ping.rejected} label="Rejections" />
                            </div>
                            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                              ping_id {ping.id}
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
              <p className="text-muted-foreground">{number(pings.data?.total)} pings</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || pings.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="tabular text-xs text-muted-foreground">
                  {pings.isFetching ? <Spinner /> : `Page ${page} of ${pings.data?.totalPages ?? 1}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= (pings.data?.totalPages ?? 1) || pings.isFetching}
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
