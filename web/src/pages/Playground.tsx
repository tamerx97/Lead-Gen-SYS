import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Gavel, Radio, RotateCcw, Send, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
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
import { Separator } from '@/components/ui/separator';
import { DynamicFields } from '@/components/DynamicFields';
import { JsonView } from '@/components/JsonView';
import { EmptyState, Spinner } from '@/components/states';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError, publicApi } from '@/lib/api';
import { money, relativeTime, US_STATES } from '@/lib/utils';
import type {
  PingResponse,
  PostResponse,
  Source,
  Vertical,
} from '@/lib/types';

const REASON_LABELS: Record<string, string> = {
  campaign_inactive: 'campaign inactive',
  buyer_inactive: 'buyer inactive',
  vertical_mismatch: 'wrong vertical',
  geo_state: 'state not covered',
  geo_zip: 'ZIP not covered',
  schedule: 'outside schedule',
  daily_cap: 'daily cap reached',
  monthly_cap: 'monthly cap reached',
  concurrency_cap: 'concurrency cap reached',
};

function reasonLabel(reason: string): string {
  if (reason.startsWith('filter:')) return `filter failed: ${reason.slice(7)}`;
  return REASON_LABELS[reason] ?? reason;
}

/**
 * The Playground drives the *public* lead API exactly as an external source
 * would — same endpoints, same X-Api-Key header. Nothing here is a shortcut
 * through the admin session.
 */
export function PlaygroundPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [verticalId, setVerticalId] = React.useState('');
  const [sourceId, setSourceId] = React.useState('');
  const [state, setState] = React.useState('CA');
  const [zip, setZip] = React.useState('90210');
  const [attributes, setAttributes] = React.useState<Record<string, unknown>>({});
  const [pii, setPii] = React.useState({
    first_name: 'Jane',
    last_name: 'Doe',
    phone: '5550101234',
    email: 'jane.doe@example.com',
    address: '742 Evergreen Terrace',
  });

  const [ping, setPing] = React.useState<PingResponse | null>(null);
  const [chosenCampaign, setChosenCampaign] = React.useState<string>('');
  const [post, setPost] = React.useState<PostResponse | null>(null);

  const verticals = useQuery({
    queryKey: ['verticals'],
    queryFn: () => api.get<Vertical[]>('/api/verticals'),
  });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<Source[]>('/api/sources'),
  });

  const activeVerticals = (verticals.data ?? []).filter((v) => v.active);
  const vertical = activeVerticals.find((v) => v.id === verticalId) ?? activeVerticals[0];
  const source = (sources.data ?? []).find((s) => s.id === sourceId) ?? (sources.data ?? [])[0];

  // Reset the attribute values whenever the selected vertical changes — the
  // form is generated from that vertical's schema, so old keys are meaningless.
  React.useEffect(() => {
    setAttributes({});
    setPing(null);
    setPost(null);
    setChosenCampaign('');
  }, [vertical?.id]);

  const doPing = useMutation({
    mutationFn: async () => {
      if (!vertical || !source) throw new Error('Pick a vertical and a source first');
      return publicApi<PingResponse>('/api/ping', source.apiKey, {
        vertical: vertical.key,
        state,
        zip,
        ...attributes,
      });
    },
    onSuccess: (data) => {
      setPing(data);
      setPost(null);
      setChosenCampaign(data.winner?.campaign_id ?? '');
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['pings'] });
      if (data.status === 'no_bid') {
        toast.toast({
          title: 'No bid',
          description: `${data.rejected.length} campaign(s) declined — see the reasons below.`,
        });
      } else {
        toast.success(
          `${data.offers.length} offer${data.offers.length === 1 ? '' : 's'}`,
          `Winner bids ${money(data.winner?.bid)} under the "${data.routing_strategy}" strategy.`
        );
      }
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && Array.isArray(err.details)
          ? (err.details as { message: string }[]).map((d) => d.message).join('; ')
          : undefined;
      toast.error('Ping failed', detail ?? (err as Error).message);
    },
  });

  const doPost = useMutation({
    mutationFn: async () => {
      if (!ping || !source) throw new Error('Run a ping first');
      return publicApi<PostResponse>('/api/post', source.apiKey, {
        ping_id: ping.ping_id,
        ...(chosenCampaign && chosenCampaign !== ping.winner?.campaign_id
          ? { campaign_id: chosenCampaign }
          : {}),
        state,
        zip,
        ...attributes,
        ...pii,
      });
    },
    onSuccess: (data) => {
      setPost(data);
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['pings'] });
      if (!data.accepted) {
        toast.toast({
          title: 'Lead rejected',
          description: data.reason ? `Reason: ${data.reason.replace('_', ' ')}` : undefined,
          variant: 'destructive',
        });
      } else {
        toast.success(
          `Sold to ${data.sold_to?.buyer_name} for ${money(data.price)}`,
          `Delivery: ${data.delivery.outcome}${data.delivery.status ? ` (HTTP ${data.delivery.status})` : ''}`
        );
      }
    },
    onError: (err) => toast.error('Post failed', (err as Error).message),
  });

  function reset() {
    setPing(null);
    setPost(null);
    setChosenCampaign('');
  }

  if (verticals.isLoading || sources.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (activeVerticals.length === 0 || (sources.data ?? []).length === 0) {
    return (
      <div>
        <PageHeader title="Playground" />
        <Card>
          <EmptyState
            icon={Gavel}
            title={activeVerticals.length === 0 ? 'No active verticals' : 'No sources'}
            description={
              activeVerticals.length === 0
                ? 'Create a vertical first — the Playground renders its form from the vertical you define.'
                : 'Create a source under Sources to get an API key. The Playground calls the public API exactly as an external source would.'
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Playground"
        description="Drive the real public API end to end: ping for offers, then post the full lead to the winner."
        actions={
          ping ? (
            <Button variant="outline" onClick={reset}>
              <RotateCcw /> Start over
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ---------------------------------------------------------- input */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  1
                </span>
                Ping — qualifying attributes only
              </CardTitle>
              <CardDescription>
                No PII goes in a ping. These fields are generated from the selected vertical's
                schema.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Vertical</Label>
                  <Select value={vertical?.id ?? ''} onValueChange={setVerticalId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activeVerticals.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Source (API key)</Label>
                  <Select value={source?.id ?? ''} onValueChange={setSourceId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(sources.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          {s.active ? '' : ' (inactive)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">State</Label>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">ZIP</Label>
                  <Input value={zip} onChange={(e) => setZip(e.target.value)} />
                </div>
              </div>

              <Separator />

              <DynamicFields
                fields={vertical?.fieldSchema ?? []}
                values={attributes}
                onChange={setAttributes}
              />

              <Button
                className="w-full"
                onClick={() => doPing.mutate()}
                disabled={doPing.isPending || !source}
              >
                {doPing.isPending ? <Spinner /> : <Radio />}
                Ping
              </Button>
            </CardContent>
          </Card>

          <Card className={ping?.status === 'open' ? '' : 'opacity-60'}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  2
                </span>
                Post — full lead including PII
              </CardTitle>
              <CardDescription>
                {ping?.status === 'open'
                  ? `Posting against ping ${ping.ping_id.slice(0, 8)}… (expires ${relativeTime(ping.expires_at)}).`
                  : 'Run a ping that draws at least one bid to enable this step.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['first_name', 'First name'],
                    ['last_name', 'Last name'],
                    ['phone', 'Phone'],
                    ['email', 'Email'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      value={pii[key]}
                      disabled={ping?.status !== 'open'}
                      onChange={(e) => setPii({ ...pii, [key]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Address</Label>
                  <Input
                    value={pii.address}
                    disabled={ping?.status !== 'open'}
                    onChange={(e) => setPii({ ...pii, address: e.target.value })}
                  />
                </div>
              </div>

              {ping && ping.offers.length > 1 ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Award to</Label>
                  <Select value={chosenCampaign} onValueChange={setChosenCampaign}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ping.offers.map((offer, index) => (
                        <SelectItem key={offer.campaign_id} value={offer.campaign_id}>
                          {index === 0 ? '★ ' : ''}
                          {offer.buyer_name} — {offer.campaign_name} · {money(offer.bid)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    A source may take any offer, not just the top-ranked one.
                  </p>
                </div>
              ) : null}

              <Button
                className="w-full"
                onClick={() => doPost.mutate()}
                disabled={doPost.isPending || ping?.status !== 'open' || !!post}
              >
                {doPost.isPending ? <Spinner /> : <Send />}
                {post ? 'Already posted' : 'Post to winner'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* --------------------------------------------------------- output */}
        <div className="space-y-4">
          {!ping ? (
            <Card className="h-full">
              <EmptyState
                icon={Gavel}
                title="No auction run yet"
                description="Fill in the qualifying attributes and hit Ping. You'll see every campaign that bid, ranked by the active routing strategy, plus why the others declined."
              />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm">Auction result</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">strategy: {ping.routing_strategy}</Badge>
                      <Badge variant={ping.status === 'open' ? 'success' : 'warning'}>
                        {ping.status}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="font-mono text-[11px]">
                    ping_id {ping.ping_id}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ping.offers.length === 0 ? (
                    <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                      No campaign bid on this ping. Nothing was sold.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {ping.offers.map((offer, index) => (
                        <div
                          key={offer.campaign_id}
                          className={`flex items-center justify-between gap-3 rounded-md border p-2.5 ${
                            index === 0 ? 'border-primary/40 bg-primary/5' : ''
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground">
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{offer.buyer_name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {offer.campaign_name} · priority {offer.routing_priority}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {index === 0 ? <Badge>winner</Badge> : null}
                            <span className="tabular text-sm font-semibold">{money(offer.bid)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {ping.rejected.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Declined ({ping.rejected.length})
                      </p>
                      {ping.rejected.map((rejection) => (
                        <div
                          key={rejection.campaign_id}
                          className="flex items-start justify-between gap-3 rounded-md border border-dashed p-2 text-xs"
                        >
                          <span className="min-w-0 truncate text-muted-foreground">
                            {rejection.campaign_name}
                          </span>
                          <span className="shrink-0 text-right">
                            <Badge variant="muted">{reasonLabel(rejection.reason)}</Badge>
                            {rejection.detail ? (
                              <span
                                className="ml-1.5 hidden text-muted-foreground sm:inline"
                                title={rejection.detail}
                              >
                                {rejection.detail.length > 40
                                  ? `${rejection.detail.slice(0, 40)}…`
                                  : rejection.detail}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {post ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      {post.accepted ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      {post.accepted ? 'Lead sold' : 'Lead rejected'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {post.accepted ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="secondary">{post.sold_to?.buyer_name}</Badge>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="tabular font-semibold">{money(post.price)}</span>
                        <Badge
                          variant={
                            post.status === 'delivered'
                              ? 'success'
                              : post.status === 'delivery_failed'
                                ? 'destructive'
                                : 'warning'
                          }
                        >
                          {post.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {post.delivery.attempts} attempt
                          {post.delivery.attempts === 1 ? '' : 's'}
                          {post.delivery.status ? ` · HTTP ${post.delivery.status}` : ''}
                        </span>
                      </div>
                    ) : (
                      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        Rejected as{' '}
                        <span className="font-medium">{post.reason ?? post.status}</span> — no charge,
                        nothing delivered.
                      </p>
                    )}
                    <JsonView value={post} label="POST /api/post response" />
                  </CardContent>
                </Card>
              ) : null}

              <JsonView value={ping} label="POST /api/ping response" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
