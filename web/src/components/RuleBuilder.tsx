import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FilterOp, FilterRule, VerticalField } from '@/lib/types';

const OPS: { value: FilterOp; label: string; forTypes: VerticalField['type'][] }[] = [
  { value: 'eq', label: 'is', forTypes: ['text', 'number', 'enum', 'boolean'] },
  { value: 'ne', label: 'is not', forTypes: ['text', 'number', 'enum', 'boolean'] },
  { value: 'in', label: 'is any of', forTypes: ['text', 'number', 'enum'] },
  { value: 'gt', label: 'greater than', forTypes: ['number', 'text'] },
  { value: 'gte', label: 'at least', forTypes: ['number', 'text'] },
  { value: 'lt', label: 'less than', forTypes: ['number', 'text'] },
  { value: 'lte', label: 'at most', forTypes: ['number', 'text'] },
  { value: 'contains', label: 'contains', forTypes: ['text', 'enum'] },
  { value: 'exists', label: 'is present', forTypes: ['text', 'number', 'enum', 'boolean'] },
];

/**
 * Campaign rule builder.
 *
 * The available fields come entirely from the selected vertical's schema — there
 * is no hardcoded list of attributes anywhere in this component.
 */
export function RuleBuilder({
  fields,
  rules,
  onChange,
}: {
  fields: VerticalField[];
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
}) {
  // `state` and `zip` are always available, alongside whatever the vertical defines.
  const allFields: VerticalField[] = [
    { name: 'state', label: 'State', type: 'text', required: false },
    { name: 'zip', label: 'ZIP', type: 'text', required: false },
    ...fields,
  ];

  function fieldFor(name: string): VerticalField | undefined {
    return allFields.find((f) => f.name === name);
  }

  function update(index: number, patch: Partial<FilterRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  if (allFields.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        This vertical has no fields yet. Add some under Verticals and they'll appear here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rules.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No attribute filters — this campaign bids on every lead in the vertical that clears its
          geo, schedule and caps.
        </p>
      ) : null}

      {rules.map((rule, index) => {
        const field = fieldFor(rule.field);
        const ops = OPS.filter((o) => !field || o.forTypes.includes(field.type));

        return (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
            <span className="w-8 shrink-0 text-center text-[11px] font-medium uppercase text-muted-foreground">
              {index === 0 ? 'if' : 'and'}
            </span>

            <Select value={rule.field} onValueChange={(value) => update(index, { field: value })}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Field" />
              </SelectTrigger>
              <SelectContent>
                {allFields.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={rule.op}
              onValueChange={(value) => update(index, { op: value as FilterOp })}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Operator" />
              </SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* The value editor follows the field's declared type. */}
            {rule.op === 'exists' ? (
              <Select
                value={String(rule.value ?? true)}
                onValueChange={(value) => update(index, { value: value === 'true' })}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">present</SelectItem>
                  <SelectItem value="false">absent</SelectItem>
                </SelectContent>
              </Select>
            ) : field?.type === 'boolean' ? (
              <Select
                value={String(rule.value ?? true)}
                onValueChange={(value) => update(index, { value: value === 'true' })}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">yes</SelectItem>
                  <SelectItem value="false">no</SelectItem>
                </SelectContent>
              </Select>
            ) : field?.type === 'enum' && rule.op !== 'in' ? (
              <Select
                value={String(rule.value ?? '')}
                onValueChange={(value) => update(index, { value })}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Value" />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : rule.op === 'in' ? (
              <Input
                className="w-[240px] font-mono text-xs"
                placeholder={
                  field?.type === 'enum' ? (field.options ?? []).slice(0, 2).join(', ') : 'a, b, c'
                }
                value={Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? '')}
                onChange={(e) =>
                  update(index, {
                    value: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : (
              <Input
                className="w-[180px]"
                type={field?.type === 'number' ? 'number' : 'text'}
                placeholder="Value"
                value={String(rule.value ?? '')}
                onChange={(e) =>
                  update(index, {
                    value: field?.type === 'number' ? Number(e.target.value) : e.target.value,
                  })
                }
              />
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
              aria-label="Remove rule"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...rules, { field: allFields[0].name, op: 'eq', value: '' }])
        }
      >
        <Plus /> Add rule
      </Button>
    </div>
  );
}
