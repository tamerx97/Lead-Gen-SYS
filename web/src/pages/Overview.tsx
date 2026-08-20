import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, DollarSign, Percent, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { money, number, percent } from '@/lib/utils';
import type { RollupRow, Stats, TimeseriesPoint, Vertical } from '@/lib/types';

const ALL = 'all';

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <p className="tabular truncate text-2xl font-semibold">{value}</p>
          )}
          {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover p-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="tabular" style={{ color: entry.color }}>
          {entry.name}: {formatter ? formatter(entry.value, entry.dataKey) : entry.value}
        </p>
      ))}
    </div>
  );
}

export function OverviewPage() {
  const [verticalId, setVerticalId] = React.useState<string>(ALL);
  const [days, setDays] = React.useState('30');

  const params = {
    days,
    ...(verticalId !== ALL ? { verticalId } : {}),
  };

  const verticals = useQuery({
    queryKey: ['verticals'],
    queryFn: () => api.get<Vertical[]>('/api/verticals'),
  });

  const stats = useQuery({
    queryKey: ['stats', params],
    queryFn: () => api.get<Stats>('/api/stats', params),
  });

  const series = useQuery({
    queryKey: ['stats-timeseries', params],
    queryFn: () => api.get<TimeseriesPoint[]>('/api/stats/timeseries', params),
  });

  const topBuyers = useQuery({
    queryKey: ['stats-rollup', 'buyer', params],
    queryFn: () =>
      api.get<{ rows: RollupRow[] }>('/api/stats/rollup', { ...params, by: 'buyer', limit: 8 }),
  });

  const byVertical = useQuery({
    queryKey: ['stats-rollup', 'vertical', params],
    queryFn: () =>
      api.get<{ rows: RollupRow[] }>('/api/stats/rollup', { ...params, by: 'vertical', limit: 10 }),
  });

  const s = stats.data;
  const chartData = (series.data ?? []).map((p) => ({
    ...p,
    label: p.date.slice(5), // MM-DD
  }));
  const hasActivity = (s?.pings.range ?? 0) > 0 || (s?.leads.range ?? 0) > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Auction and revenue performance across every vertical you've defined."
        actions={
          <>
            <Select value={verticalId} onValueChange={setVerticalId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All verticals" />
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
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {stats.isError ? (
        <Card>
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Revenue today"
              value={money(s?.revenue.today)}
              sub={`${number(s?.leads.today)} leads sold today`}
              icon={DollarSign}
              loading={stats.isLoading}
            />
            <KpiCard
              label="Revenue (all time)"
              value={money(s?.revenue.total, true)}
              sub={`${money(s?.revenue.range)} in range`}
              icon={DollarSign}
              loading={stats.isLoading}
            />
            <KpiCard
              label="Leads sold"
              value={number(s?.leads.range)}
              sub={`avg ${money(s?.averagePrice)} · ${number(s?.leads.duplicates)} dupes rejected`}
              icon={ShoppingCart}
              loading={stats.isLoading}
            />
            <KpiCard
              label="Fill rate"
              value={percent(s?.rates.fillRate)}
              sub={`${percent(s?.rates.noBidRate)} no-bid · ${number(s?.pings.range)} pings`}
              icon={Percent}
              loading={stats.isLoading}
            />
          </div>

          {!stats.isLoading && !hasActivity ? (
            <Card>
              <EmptyState
                icon={Activity}
                title="No auction activity in this range"
                description="Run a ping from the Playground, or point a source at POST /api/ping, and the numbers here will fill in."
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Revenue over time</CardTitle>
                  </CardHeader>
                  <CardContent className="pl-0">
                    {series.isLoading ? (
                      <Skeleton className="mx-4 h-[240px]" />
                    ) : (
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickLine={false}
                            axisLine={false}
                            minTickGap={24}
                          />
                          <YAxis
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickLine={false}
                            axisLine={false}
                            width={56}
                            tickFormatter={(v) => money(v, true)}
                          />
                          <Tooltip content={<ChartTooltip formatter={(v: number) => money(v)} />} />
                          <Line
                            type="monotone"
                            dataKey="revenue"
                            name="Revenue"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Fill rate &amp; ping volume</CardTitle>
                  </CardHeader>
                  <CardContent className="pl-0">
                    {series.isLoading ? (
                      <Skeleton className="mx-4 h-[240px]" />
                    ) : (
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickLine={false}
                            axisLine={false}
                            minTickGap={24}
                          />
                          <YAxis
                            yAxisId="left"
                            domain={[0, 1]}
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickLine={false}
                            axisLine={false}
                            width={44}
                            tickFormatter={(v) => `${Math.round(v * 100)}%`}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickLine={false}
                            axisLine={false}
                            width={36}
                          />
                          <Tooltip
                            content={
                              <ChartTooltip
                                formatter={(v: number, key: string) =>
                                  key === 'fillRate' ? percent(v) : number(v)
                                }
                              />
                            }
                          />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="fillRate"
                            name="Fill rate"
                            stroke="hsl(var(--success))"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="pings"
                            name="Pings"
                            stroke="hsl(var(--muted-foreground))"
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Top buyers by spend</CardTitle>
                  </CardHeader>
                  <CardContent className="pl-0">
                    {topBuyers.isLoading ? (
                      <TableSkeleton rows={4} cols={3} />
                    ) : (topBuyers.data?.rows ?? []).length === 0 ? (
                      <EmptyState title="No purchases in this range" />
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart
                          data={topBuyers.data?.rows ?? []}
                          layout="vertical"
                          margin={{ left: 8, right: 24, top: 8, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                          <XAxis
                            type="number"
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => money(v, true)}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={150}
                            tick={{ fontSize: 11 }}
                            stroke="hsl(var(--muted-foreground))"
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip
                            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                            content={<ChartTooltip formatter={(v: number) => money(v)} />}
                          />
                          <Bar
                            dataKey="revenue"
                            name="Spend"
                            fill="hsl(var(--primary))"
                            radius={[0, 4, 4, 0]}
                            barSize={18}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">By vertical</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {byVertical.isLoading ? (
                      <TableSkeleton rows={3} cols={2} />
                    ) : (byVertical.data?.rows ?? []).length === 0 ? (
                      <EmptyState title="No sales yet" />
                    ) : (
                      (byVertical.data?.rows ?? []).map((row) => (
                        <div
                          key={row.id}
                          className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{row.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {number(row.leads)} leads · avg {money(row.averagePrice)}
                            </p>
                          </div>
                          <Badge variant="secondary" className="tabular shrink-0">
                            {money(row.revenue)}
                          </Badge>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
