import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/states';
import type { FieldType, VerticalField } from '@/lib/types';

const TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: 'text', label: 'Text', hint: 'Free text. Filterable with contains / eq.' },
  { value: 'number', label: 'Number', hint: 'Numeric. Filterable with gt / gte / lt / lte.' },
  { value: 'enum', label: 'Choice', hint: 'One of a fixed option list.' },
  { value: 'boolean', label: 'Yes / No', hint: 'True or false.' },
];

/** Turn "Property Age (years)" into "property_age_years". */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f$1');
}

/**
 * The field-schema editor.
 *
 * This is the single place a new niche gets defined. Whatever is built here
 * becomes: the ping's validation rules, the Playground's form, and the field
 * list in every campaign's rule builder — with no code change anywhere.
 */
export function FieldSchemaBuilder({
  fields,
  onChange,
}: {
  fields: VerticalField[];
  onChange: (fields: VerticalField[]) => void;
}) {
  function update(index: number, patch: Partial<VerticalField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function add() {
    onChange([...fields, { name: '', label: '', type: 'text', required: false }]);
  }

  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            title="No fields yet"
            description="Add the qualifying attributes this niche needs. They drive ping validation, the lead forms, and the campaign filter builder."
            action={
              <Button size="sm" onClick={add}>
                <Plus /> Add first field
              </Button>
            }
          />
        </div>
      ) : null}

      {fields.map((field, index) => (
        <div key={index} className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <div className="flex flex-col pt-6">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            </div>

            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={field.label}
                  placeholder="e.g. Roof Condition"
                  onChange={(e) => {
                    const label = e.target.value;
                    // Auto-derive the wire name until the operator edits it.
                    const shouldSync = !field.name || field.name === slugify(field.label);
                    update(index, { label, ...(shouldSync ? { name: slugify(label) } : {}) });
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  Field name <span className="text-muted-foreground">(used in the API)</span>
                </Label>
                <Input
                  value={field.name}
                  placeholder="roof_condition"
                  className="font-mono text-xs"
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={field.type}
                  onValueChange={(type) =>
                    update(index, {
                      type: type as FieldType,
                      options: type === 'enum' ? (field.options ?? []) : undefined,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {TYPES.find((t) => t.value === field.type)?.hint}
                </p>
              </div>

              <div className="flex items-end justify-between gap-3 pb-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`required-${index}`}
                    checked={field.required}
                    onCheckedChange={(required) => update(index, { required })}
                  />
                  <Label htmlFor={`required-${index}`} className="text-xs">
                    Required on ping
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  aria-label="Remove field"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              {field.type === 'enum' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Options (comma separated)</Label>
                  <Input
                    value={(field.options ?? []).join(', ')}
                    placeholder="excellent, fair, needs_replacement"
                    className="font-mono text-xs"
                    onChange={(e) =>
                      update(index, {
                        options: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}

      {fields.length > 0 ? (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus /> Add field
        </Button>
      ) : null}
    </div>
  );
}
