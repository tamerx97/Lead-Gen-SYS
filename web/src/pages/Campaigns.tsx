import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Target, Trash2 } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, ErrorState, Spinner, TableSkeleton } from '@/components/states';
import { MultiTokenInput } from '@/components/MultiTokenInput';
import { RuleBuilder } from '@/components/RuleBuilder';
import { ScheduleEditor } from '@/components/ScheduleEditor';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/lib/api';
import { money, number, US_STATES, WEEKDAYS } from '@/lib/utils';
import type { Buyer, Campaign, FilterRule, Schedule, Vertical } from '@/lib/types';

const ALL = 'all';

interface Draft {
  id?: string;
  buyerId: string;
  name: string;
  verticalId: string;
  active: boolean;
  bid: string;
  routingPriority: string;
  states: string[];
  zips: string[];
  filters: FilterRule[];
  dailyCap: string;
  monthlyCap: string;
  concurrencyCap: string;
  schedule: Schedule;
}

function toDraft(campaign: Campaign): Draft {
  return {
    id: campaign.id,
    buyerId: campaign.buyerId,
    name: campaign.name,
    verticalId: campaign.verticalId,
    active: campaign.active,
    bid: String(campaign.bid),
    routingPriority: String(campaign.routingPriority),
    states: campaign.states ?? [],
    zips: campaign.zips ?? [],
    filters: campaign.filters ?? [],
    dailyCap: String(campaign.dailyCap),
    monthlyCap: String(campaign.monthlyCap),
    concurrencyCap: String(campaign.concurrencyCap),
    schedule: campaign.schedule ?? {},
  };
}

function blankDraft(buyerId: string, verticalId: string): Draft {
  return {
    buyerId,
    name: '',
    verticalId,
    active: true,
    bid: '25.00',
    routingPriority: '100',
    states: [],
    zips: [],
    filters: [],
    dailyCap: '0',
    monthlyCap: '0',
    concurrencyCap: '0',
    schedule: {},
  };
}

function scheduleLabel(schedule: Schedule): string {
  const days = schedule.days ?? [];
  if (days.length === 0 && !schedule.start) return '24/7';
  const dayPart =
    days.length === 0 || days.length === 7
      ? 'daily'
      : days.map((d) => WEEKDAYS.find((w) => w.value === d)?.label).join(',');
  const timePart = schedule.start && schedule.end ? ` ${schedule.start}–${schedule.end}` : '';
  return `${dayPart}${timePart}`;
}

function capsLabel(campaign: Campaign): string {
  const parts: string[] = [];
  if (campaign.dailyCap > 0) parts.push(`${campaign.dailyCap}/day`);
  if (campaign.monthlyCap > 0) parts.push(`${campaign.monthlyCap}/mo`);
  if (campaign.concurrencyCap > 0) parts.push(`${campaign.concurrencyCap} concurrent`);
  return parts.length ? parts.join(' · ') : 'uncapped';
}

export function CampaignsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filterVertical, setFilterVertical] = React.useState(ALL);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const verticals = useQuery({
    queryKey: ['verticals'],
    queryFn: () => api.get<Vertical[]>('/api/verticals'),
  });
  const buyers = useQuery({ queryKey: ['buyers'], queryFn: () => api.get<Buyer[]>('/api/buyers') });
  const campaigns = useQuery({
    queryKey: ['campaigns', filterVertical],
    queryFn: () =>
      api.get<Campaign[]>('/api/campaigns', filterVertical !== ALL ? { verticalId: filterVertical } : {}),
  });

  // The rule builder's field list comes from the vertical chosen in the drawer.
  const draftVertical = (verticals.data ?? []).find((v) => v.id === draft?.verticalId);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  }

  const save = useMutation({
    mutationFn: (input: Draft) => {
      const body = {
        buyerId: input.buyerId,
        name: input.name,
        verticalId: input.verticalId,
        active: input.active,
        bid: Number(input.bid),
        routingPriority: Number(input.routingPriority),
        states: input.states,
        zips: input.zips,
        filters: input.filters,
        dailyCap: Number(input.dailyCap),
        monthlyCap: Number(input.monthlyCap),
        concurrencyCap: Number(input.concurrencyCap),
        schedule: input.schedule,
      };
      return input.id
        ? api.patch<Campaign>(`/api/campaigns/${input.id}`, body)
        : api.post<Campaign>('/api/campaigns', body);
    },
    onSuccess: (_data, input) => {
      invalidate();
      setDraft(null);
      toast.success(input.id ? 'Campaign updated' : 'Campaign created');
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && Array.isArray(err.details)
          ? (err.details as { message: string }[]).map((d) => d.message).join('; ')
          : undefined;
      toast.error('Could not save campaign', detail ?? (err as Error).message);
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<Campaign>(`/api/campaigns/${id}`, { active }),
    onMutate: async ({ id, active }) => {
      const key = ['campaigns', filterVertical];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Campaign[]>(key);
      queryClient.setQueryData<Campaign[]>(key, (old) =>
        (old ?? []).map((c) => (c.id === id ? { ...c, active } : c))
      );
      return { previous, key };
    },
    onError: (err, _vars, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
      toast.error('Could not update campaign', (err as Error).message);
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/campaigns/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Campaign deleted');
    },
    onError: (err) => toast.error('Could not delete campaign', (err as Error).message),
  });

  const canCreate = (buyers.data ?? []).length > 0 && (verticals.data ?? []).length > 0;

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="A campaign is a buyer's standing order: what they'll pay, for which vertical, and under which geo, attribute, schedule and cap constraints."
        actions={
          <>
            <Select value={filterVertical} onValueChange={setFilterVertical}>
              <SelectTrigger className="w-[200px]">
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
            <Button
              disabled={!canCreate}
              onClick={() =>
                setDraft(
                  blankDraft(
                    buyers.data![0].id,
                    filterVertical !== ALL ? filterVertical : verticals.data![0].id
                  )
                )
              }
            >
              <Plus /> New campaign
            </Button>
          </>
        }
      />

      <Card>
        {campaigns.isLoading ? (
          <TableSkeleton cols={7} />
        ) : campaigns.isError ? (
          <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
        ) : (campaigns.data ?? []).length === 0 ? (
          <EmptyState
            icon={Target}
            title="No campaigns"
            description={
              canCreate
                ? 'Create a campaign so buyers have something to bid with.'
                : 'Create at least one buyer and one vertical first.'
            }
            action={
              canCreate ? (
                <Button
                  size="sm"
                  onClick={() =>
                    setDraft(
                      blankDraft(
                        buyers.data![0].id,
                        filterVertical !== ALL ? filterVertical : verticals.data![0].id
                      )
                    )
                  }
                >
                  <Plus /> New campaign
                </Button>
              ) : null
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead className="text-right">Bid</TableHead>
                <TableHead className="text-right">Priority</TableHead>
                <TableHead>Geo</TableHead>
                <TableHead>Filters</TableHead>
                <TableHead>Caps</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(campaigns.data ?? []).map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">{campaign.name}</TableCell>
                  <TableCell className="text-muted-foreground">{campaign.buyer?.name}</TableCell>
                  <TableCell>
                    <Badge variant="muted">{campaign.vertical?.key}</Badge>
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {money(campaign.bid)}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {campaign.routingPriority}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {campaign.states.length === 0 && campaign.zips.length === 0
                      ? 'nationwide'
                      : [
                          campaign.states.length
                            ? campaign.states.slice(0, 4).join(', ') +
                              (campaign.states.length > 4 ? ` +${campaign.states.length - 4}` : '')
                            : null,
                          campaign.zips.length ? `${campaign.zips.length} ZIP(s)` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {campaign.filters.length === 0
                      ? 'none'
                      : campaign.filters
                          .map((f) => `${f.field} ${f.op}`)
                          .slice(0, 2)
                          .join(', ') + (campaign.filters.length > 2 ? '…' : '')}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{capsLabel(campaign)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {scheduleLabel(campaign.schedule ?? {})}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {number(campaign._count?.leads)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={campaign.active}
                      onCheckedChange={(active) => toggleActive.mutate({ id: campaign.id, active })}
                      aria-label="Toggle active"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit"
                        onClick={() => setDraft(toDraft(campaign))}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        onClick={() => {
                          if (confirm(`Delete campaign "${campaign.name}"?`)) remove.mutate(campaign.id);
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
                <DialogTitle>{draft.id ? 'Edit campaign' : 'New campaign'}</DialogTitle>
                <DialogDescription>
                  All filters must pass for this campaign to bid. Empty geo lists mean no geo
                  restriction; a cap of 0 means unlimited.
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 space-y-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Campaign name</Label>
                    <Input
                      value={draft.name}
                      placeholder="e.g. West Coast Premium"
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Buyer</Label>
                    <Select
                      value={draft.buyerId}
                      onValueChange={(buyerId) => setDraft({ ...draft, buyerId })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(buyers.data ?? []).map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                            {b.active ? '' : ' (inactive)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Vertical</Label>
                    <Select
                      value={draft.verticalId}
                      onValueChange={(verticalId) =>
                        // Filters reference fields of a specific vertical, so
                        // switching verticals clears them rather than leaving
                        // rules that can never match.
                        setDraft({ ...draft, verticalId, filters: [] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(verticals.data ?? []).map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Bid ($ per lead)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.bid}
                      onChange={(e) => setDraft({ ...draft, bid: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Routing priority</Label>
                    <Input
                      type="number"
                      min="0"
                      value={draft.routingPriority}
                      onChange={(e) => setDraft({ ...draft, routingPriority: e.target.value })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Lower wins under the "priority" routing strategy.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id="c-active"
                    checked={draft.active}
                    onCheckedChange={(active) => setDraft({ ...draft, active })}
                  />
                  <Label htmlFor="c-active">Active — bids on matching pings</Label>
                </div>

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>States</Label>
                    <MultiTokenInput
                      values={draft.states}
                      onChange={(states) => setDraft({ ...draft, states })}
                      placeholder="Type CA, press Enter"
                      suggestions={US_STATES}
                      uppercase
                      emptyHint="Empty = every state"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>ZIP codes</Label>
                    <MultiTokenInput
                      values={draft.zips}
                      onChange={(zips) => setDraft({ ...draft, zips })}
                      placeholder="90210, 90211"
                      emptyHint="Empty = every ZIP"
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div>
                    <Label>Attribute filters</Label>
                    <p className="text-xs text-muted-foreground">
                      Fields come from{' '}
                      <span className="font-medium">{draftVertical?.name ?? 'the vertical'}</span>'s
                      schema. All rules must pass.
                    </p>
                  </div>
                  <RuleBuilder
                    fields={draftVertical?.fieldSchema ?? []}
                    rules={draft.filters}
                    onChange={(filters) => setDraft({ ...draft, filters })}
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Caps</Label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        ['dailyCap', 'Daily'],
                        ['monthlyCap', 'Monthly'],
                        ['concurrencyCap', 'Concurrent'],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="space-y-1.5">
                        <Label className="text-xs">{label}</Label>
                        <Input
                          type="number"
                          min="0"
                          value={draft[key]}
                          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    0 = unlimited. Caps are checked at ping time and re-checked when the lead is
                    awarded.
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Schedule / dayparting</Label>
                  <ScheduleEditor
                    schedule={draft.schedule}
                    onChange={(schedule) => setDraft({ ...draft, schedule })}
                  />
                </div>
              </div>

              <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !draft.name}>
                  {save.isPending ? <Spinner /> : null}
                  {draft.id ? 'Save changes' : 'Create campaign'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
