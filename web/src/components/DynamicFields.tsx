import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { VerticalField } from '@/lib/types';

/**
 * Renders a form directly from a vertical's field schema.
 *
 * This is what makes a brand-new niche immediately usable in the Playground:
 * define the fields, and the form appears. No per-vertical components exist.
 */
export function DynamicFields({
  fields,
  values,
  onChange,
}: {
  fields: VerticalField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  if (fields.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        This vertical defines no attributes — only geo will be matched on.
      </p>
    );
  }

  function set(name: string, value: unknown) {
    onChange({ ...values, [name]: value });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.name];
        const id = `field-${field.name}`;

        return (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={id} className="text-xs">
              {field.label}
              {field.required ? <span className="ml-1 text-destructive">*</span> : null}
              <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                {field.name}
              </span>
            </Label>

            {field.type === 'boolean' ? (
              <Select
                value={value === undefined || value === '' ? '' : String(value)}
                onValueChange={(v) => set(field.name, v === '' ? undefined : v === 'true')}
              >
                <SelectTrigger id={id}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes</SelectItem>
                  <SelectItem value="false">No</SelectItem>
                </SelectContent>
              </Select>
            ) : field.type === 'enum' ? (
              <Select
                value={value === undefined ? '' : String(value)}
                onValueChange={(v) => set(field.name, v)}
              >
                <SelectTrigger id={id}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                type={field.type === 'number' ? 'number' : 'text'}
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(e) =>
                  set(
                    field.name,
                    e.target.value === ''
                      ? undefined
                      : field.type === 'number'
                        ? Number(e.target.value)
                        : e.target.value
                  )
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
