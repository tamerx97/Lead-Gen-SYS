import * as React from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Token entry for state and ZIP lists. Empty means "no restriction", which is
 * shown explicitly so an operator can't mistake it for "matches nothing".
 */
export function MultiTokenInput({
  values,
  onChange,
  placeholder,
  suggestions,
  uppercase = false,
  emptyHint = 'Empty = no restriction',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  uppercase?: boolean;
  emptyHint?: string;
}) {
  const [draft, setDraft] = React.useState('');

  function commit(raw: string) {
    const tokens = raw
      .split(/[,\s]+/)
      .map((s) => (uppercase ? s.trim().toUpperCase() : s.trim()))
      .filter(Boolean)
      .filter((s) => !values.includes(s));
    if (tokens.length) onChange([...values, ...tokens]);
    setDraft('');
  }

  const matches = suggestions
    ?.filter(
      (s) =>
        draft.length > 0 &&
        s.toLowerCase().startsWith(draft.toLowerCase()) &&
        !values.includes(s)
    )
    .slice(0, 8);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft && commit(draft)}
        />
        {matches && matches.length > 0 ? (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            {matches.map((m) => (
              <button
                key={m}
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(m);
                }}
              >
                {m}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={cn('flex flex-wrap gap-1.5', values.length === 0 && 'hidden')}>
        {values.map((value) => (
          <Badge key={value} variant="secondary" className="gap-1 py-1">
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Remove ${value}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      {values.length === 0 ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null}
    </div>
  );
}
