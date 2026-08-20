import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Read-only JSON block with a copy button — used for payloads and responses. */
export function JsonView({
  value,
  className,
  label,
}: {
  value: unknown;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = React.useMemo(() => {
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value ?? null, null, 2);
  }, [value]);

  return (
    <div className={cn('relative rounded-md border bg-muted/40', className)}>
      {label ? (
        <div className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1.5"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <pre className="scrollbar-thin max-h-80 overflow-auto p-3 text-xs leading-relaxed">
        <code className="font-mono">{text}</code>
      </pre>
    </div>
  );
}
