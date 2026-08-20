import { z } from 'zod';
import { toBoolean, toNumber } from './filters';
import type { FieldType, PingAttributes, VerticalField } from './types';

export const FIELD_TYPES: FieldType[] = ['text', 'number', 'enum', 'boolean'];

/** Zod schema for a vertical's `fieldSchema` column, used by the admin API. */
export const verticalFieldSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/i, 'field names must be alphanumeric/underscore and start with a letter'),
    label: z.string().trim().min(1).max(120),
    type: z.enum(['text', 'number', 'enum', 'boolean']),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1)).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'enum' && (!field.options || field.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'enum fields require at least one option',
      });
    }
  });

export const verticalFieldSchemaArray = z
  .array(verticalFieldSchema)
  .max(100)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const f of fields) {
      const key = f.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate field name: ${f.name}`,
        });
      }
      seen.add(key);
    }
    for (const reserved of ['state', 'zip', 'vertical']) {
      if (seen.has(reserved)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${reserved}" is reserved — it is always collected alongside the vertical's own fields`,
        });
      }
    }
  });

export function parseFieldSchema(raw: unknown): VerticalField[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const result = verticalFieldSchemaArray.safeParse(value);
  return result.success ? (result.data as VerticalField[]) : [];
}

export interface FieldValidationIssue {
  field: string;
  message: string;
}

export interface FieldValidationResult {
  ok: boolean;
  /** Coerced attribute values, keyed by field name. */
  values: PingAttributes;
  issues: FieldValidationIssue[];
}

/**
 * Validate and coerce an incoming payload against a vertical's field schema.
 *
 * Values arrive as strings over HTTP, so numbers and booleans are coerced rather
 * than rejected. Unknown keys are preserved untouched: a source may send extra
 * context, and campaigns can still filter on it.
 */
export function validateAgainstFieldSchema(
  fields: VerticalField[],
  input: Record<string, unknown>
): FieldValidationResult {
  const issues: FieldValidationIssue[] = [];
  const values: PingAttributes = {};
  const known = new Set(fields.map((f) => f.name));

  for (const field of fields) {
    const raw = input[field.name];
    const present = raw !== undefined && raw !== null && raw !== '';

    if (!present) {
      if (field.required) {
        issues.push({ field: field.name, message: `${field.label} is required` });
      }
      continue;
    }

    switch (field.type) {
      case 'number': {
        const n = toNumber(raw);
        if (n === null) {
          issues.push({ field: field.name, message: `${field.label} must be a number` });
        } else {
          values[field.name] = n;
        }
        break;
      }
      case 'boolean': {
        const b = toBoolean(raw);
        if (b === null) {
          issues.push({ field: field.name, message: `${field.label} must be a boolean` });
        } else {
          values[field.name] = b;
        }
        break;
      }
      case 'enum': {
        const options = field.options ?? [];
        const match = options.find(
          (o) => o.trim().toLowerCase() === String(raw).trim().toLowerCase()
        );
        if (!match) {
          issues.push({
            field: field.name,
            message: `${field.label} must be one of: ${options.join(', ')}`,
          });
        } else {
          values[field.name] = match;
        }
        break;
      }
      case 'text':
      default:
        values[field.name] = String(raw);
        break;
    }
  }

  // Pass through anything the schema didn't claim, minus transport-level keys.
  const transportKeys = new Set(['vertical', 'ping_id', 'campaign_id']);
  for (const [key, value] of Object.entries(input)) {
    if (known.has(key) || transportKeys.has(key)) continue;
    values[key] = value;
  }

  return { ok: issues.length === 0, values, issues };
}

/** Keys treated as PII and therefore stripped from ping payloads. */
export const PII_KEYS = [
  'first_name',
  'last_name',
  'name',
  'full_name',
  'phone',
  'phone_number',
  'email',
  'email_address',
  'address',
  'address1',
  'address2',
  'street',
  'ssn',
  'dob',
  'date_of_birth',
  'ip',
  'ip_address',
];

/** Defence in depth: a ping should never carry PII, so drop it if a source sends any. */
export function stripPii<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (PII_KEYS.includes(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}
