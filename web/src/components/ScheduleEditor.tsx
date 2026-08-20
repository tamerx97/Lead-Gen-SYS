import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn, WEEKDAYS } from '@/lib/utils';
import type { Schedule } from '@/lib/types';

/**
 * Dayparting editor. An empty schedule means the campaign bids 24/7; an end time
 * earlier than the start time is a window that wraps past midnight.
 */
export function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: Schedule;
  onChange: (schedule: Schedule) => void;
}) {
  const days = schedule.days ?? [];
  const alwaysOn = days.length === 0 && !schedule.start && !schedule.end;
  const wraps = !!schedule.start && !!schedule.end && schedule.end < schedule.start;

  function toggleDay(day: number) {
    onChange({
      ...schedule,
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {WEEKDAYS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => toggleDay(d.value)}
            className={cn(
              'h-8 w-11 rounded-md border text-xs font-medium transition-colors',
              days.includes(d.value)
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            )}
          >
            {d.label}
          </button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-1"
          onClick={() => onChange({})}
          disabled={alwaysOn}
        >
          Clear
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
        <div className="space-y-1.5">
          <Label className="text-xs">Start</Label>
          <Input
            type="time"
            value={schedule.start ?? ''}
            onChange={(e) => onChange({ ...schedule, start: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">End</Label>
          <Input
            type="time"
            value={schedule.end ?? ''}
            onChange={(e) => onChange({ ...schedule, end: e.target.value || undefined })}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {alwaysOn
          ? 'Always on — this campaign bids 24/7.'
          : days.length === 0
            ? `Every day, ${schedule.start ?? '00:00'}–${schedule.end ?? '24:00'}.`
            : `${days.map((d) => WEEKDAYS.find((w) => w.value === d)?.label).join(', ')}${
                schedule.start && schedule.end ? `, ${schedule.start}–${schedule.end}` : ', all day'
              }.`}
        {wraps ? ' The window wraps past midnight.' : ''}{' '}
        Evaluated in the platform timezone set under Settings.
      </p>
    </div>
  );
}
