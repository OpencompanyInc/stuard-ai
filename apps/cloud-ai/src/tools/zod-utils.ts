/**
 * Zod 4 → JSON Schema utilities
 *
 * Replaces the hand-rolled instanceof-based converters that broke when the
 * project moved to Zod 4 (._def moved to ._zod.def, class hierarchy changed).
 *
 * Uses Zod 4's built-in z.toJSONSchema() for reliable conversion, then
 * post-processes the output for LLM tool-calling compatibility:
 *  - target: draft-07  (most widely supported by LLM providers)
 *  - unrepresentable types become {} (instead of throwing)
 *  - additionalProperties: false is stripped (some models choke on it)
 */

import { z } from 'zod';

/**
 * A Gemini-safe stand-in for `z.any()` on a free-form tool-input field.
 *
 * A bare `z.any()` emits a JSON-Schema property with no `type`. Gemini's
 * GenerateContentRequest validator drops any named property (or array item) that
 * has no `type` and then 400s ("...function_declarations[N].parameters.required[0]:
 * property is not defined"). This bites specifically on the OpenRouter→Google
 * path — the native @ai-sdk/google provider sanitizes type-less props, so the
 * same tool can look fine on a BYOK/native Gemini call yet break on the
 * Stuard-served (OpenRouter) one. A type-less `additionalProperties` wildcard on
 * an otherwise-typed object IS tolerated; a type-less *named property/item* is not.
 *
 * This returns a union of concretely-typed branches (scalar | object | array of
 * scalars/objects), which always emits a `type` per branch (anyOf) while still
 * accepting any realistic JSON value. Use it instead of `z.any()` for any tool
 * field that reaches an LLM. Guarded by gemini-schema-safety.test.ts.
 */
export function geminiSafeJsonValue(): z.ZodTypeAny {
  const scalar = z.union([z.string(), z.number(), z.boolean()]);
  const obj = z.object({}).loose(); // any object (nested values pass through)
  const arr = z.array(z.union([scalar, obj]));
  return z.union([scalar, obj, arr]);
}

const COERCED_TOOL_SCHEMA = Symbol.for('stuard.coercedToolInputSchema');
const COERCED_TOOL = Symbol.for('stuard.coercedTool');

function getSchemaDef(schema: any): any {
  return schema?._zod?.def ?? schema?._def;
}

function getSchemaType(schema: any): string | undefined {
  const def = getSchemaDef(schema);
  const type = def?.type ?? def?.typeName;
  if (['optional', 'nullable', 'nullish', 'default', 'catch', 'readonly', 'nonoptional'].includes(type)) {
    return getSchemaType(def?.innerType);
  }
  return type;
}

function getSchemaWrappers(schema: any): { optional: boolean; nullable: boolean } {
  let optional = false;
  let nullable = false;
  let current = schema;
  while (current) {
    const def = getSchemaDef(current);
    const type = def?.type ?? def?.typeName;
    if (type === 'optional') optional = true;
    else if (type === 'nullable' || type === 'nullish') nullable = true;
    else break;
    current = def?.innerType;
  }
  return { optional, nullable };
}

function isRequiredNullableField(schema: any): boolean {
  const { optional, nullable } = getSchemaWrappers(schema);
  return nullable && !optional;
}

/** LLMs often emit "" instead of null for unused nullable tool parameters. */
function emptyStringAsNull(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

function getObjectShape(schema: any, def: any): Record<string, any> | undefined {
  const shape = schema?.shape ?? def?.shape;
  return typeof shape === 'function' ? shape() : shape;
}

function parseJsonishString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!['[', '{', '"'].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function splitScalarArrayString(value: string, elementSchema: any): unknown[] {
  const parsed = parseJsonishString(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== value) return [parsed];

  const trimmed = value.trim();
  const elementType = getSchemaType(elementSchema);
  const scalarElementTypes = new Set(['string', 'number', 'int', 'integer', 'float', 'boolean']);
  if (scalarElementTypes.has(String(elementType)) && /[\n,]/.test(trimmed)) {
    return trimmed
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [trimmed];
}

/**
 * Normalize common LLM tool-argument shape mistakes before Zod validation.
 *
 * The most common provider/model error is emitting a scalar for an array field
 * (`labels: "bug"` instead of `labels: ["bug"]`). Zod should still reject
 * genuinely invalid input, but this gives tool calls a chance to recover from
 * obvious JSON-shape mistakes before the AI SDK/Mastra validation layer aborts
 * the whole turn.
 */
export function normalizeToolInputForSchema(schema: any, value: any): any {
  const def = getSchemaDef(schema);
  if (!def) return value;

  const type = def.type ?? def.typeName;

  switch (type) {
    case 'optional':
    case 'nullable':
    case 'nullish':
    case 'default':
    case 'catch':
    case 'readonly':
    case 'nonoptional': {
      if (value == null) return value;
      const coerced = (type === 'nullable' || type === 'nullish')
        ? emptyStringAsNull(value)
        : value;
      if (coerced == null) return null;
      return normalizeToolInputForSchema(def.innerType, coerced);
    }

    case 'pipe':
      return normalizeToolInputForSchema(def.in ?? def.innerType, value);

    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const shape = getObjectShape(schema, def);
      if (!shape || typeof shape !== 'object') return value;
      const next: Record<string, any> = { ...value };
      for (const [key, fieldSchema] of Object.entries(shape)) {
        if (Object.prototype.hasOwnProperty.call(next, key)) {
          next[key] = normalizeToolInputForSchema(fieldSchema, next[key]);
        } else if (isRequiredNullableField(fieldSchema)) {
          // Strict tool schemas require every nullable field; models often omit unused ones.
          next[key] = null;
        }
      }
      return next;
    }

    case 'array': {
      if (value == null) return value;
      const elementSchema = schema?.element ?? def.element ?? def.innerType;
      const rawItems = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? splitScalarArrayString(value, elementSchema)
          : [value];
      return rawItems.map((item) => normalizeToolInputForSchema(elementSchema, item));
    }

    case 'tuple': {
      if (!Array.isArray(value)) return value;
      const items = def.items ?? [];
      return value.map((item, index) => normalizeToolInputForSchema(items[index], item));
    }

    case 'union': {
      try {
        if (schema?.safeParse?.(value)?.success) return value;
      } catch {}
      const options = Array.isArray(def.options) ? def.options : [];
      for (const option of options) {
        const normalized = normalizeToolInputForSchema(option, value);
        try {
          if (option?.safeParse?.(normalized)?.success) return normalized;
        } catch {}
      }
      return value;
    }

    case 'number':
    case 'int':
    case 'integer':
    case 'float':
      if (typeof value === 'string' && value.trim() !== '') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
      }
      return value;

    case 'boolean':
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
      }
      return value;

    case 'string':
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return value;

    default:
      return value;
  }
}

export function coerceToolInputSchema(schema: any): any {
  if (!schema || (schema as any)[COERCED_TOOL_SCHEMA]) return schema;
  const wrapped = z.preprocess((value) => normalizeToolInputForSchema(schema, value), schema);
  (wrapped as any)[COERCED_TOOL_SCHEMA] = true;
  (wrapped as any).__stuardBaseSchema = schema;
  return wrapped;
}

export function withToolInputCoercion<T extends Record<string, any>>(tool: T): T {
  if (!tool || typeof tool !== 'object' || (tool as any)[COERCED_TOOL]) return tool;
  const inputSchema = (tool as any).inputSchema || (tool as any).parameters;
  if (!inputSchema) return tool;

  const originalExecute = typeof (tool as any).execute === 'function'
    ? (tool as any).execute.bind(tool)
    : undefined;
  const wrapped: any = {
    ...tool,
    inputSchema: coerceToolInputSchema(inputSchema),
  };

  if ((tool as any).parameters) {
    wrapped.parameters = wrapped.inputSchema;
  }

  if (originalExecute) {
    wrapped.execute = async (args: any, ctx: any) => {
      const normalized = normalizeToolInputForSchema(inputSchema, args);
      const parsed = typeof inputSchema?.safeParse === 'function'
        ? inputSchema.safeParse(normalized)
        : null;
      return originalExecute(parsed?.success ? parsed.data : normalized, ctx);
    };
  }

  wrapped[COERCED_TOOL] = true;
  return wrapped as T;
}

export function withToolInputCoercionMap<T extends Record<string, any>>(tools: T): T {
  const wrapped: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools || {})) {
    wrapped[name] = withToolInputCoercion(tool as any);
  }
  return wrapped as T;
}

// ─── JSON Schema conversion ──────────────────────────────────────────────────

/**
 * Convert a Zod schema to a clean JSON Schema object suitable for LLM tool calling.
 * Uses Zod 4's native z.toJSONSchema() with settings optimised for cross-model compatibility.
 */
export function zodToJsonSchema(schema: any): any {
  if (!schema) return {};

  try {
    const jsonSchema = z.toJSONSchema(schema, {
      target: 'draft-07',
      unrepresentable: 'any',
      io: 'input',
    });

    // Post-process for LLM compatibility
    return cleanSchemaForLLM(jsonSchema);
  } catch (e) {
    // Fallback: try to extract info from the schema using the Zod 4 API
    try {
      return fallbackZodConvert(schema);
    } catch {
      return {};
    }
  }
}

/**
 * Clean a JSON Schema object for maximum LLM tool-calling compatibility.
 * - Strips additionalProperties: false (causes issues with some models)
 * - Strips $schema (unnecessary noise for tool calling)
 * - Recursively processes nested schemas
 */
function cleanSchemaForLLM(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  // Remove $schema — not needed for tool calling
  delete result.$schema;

  // Strip additionalProperties: false — many models (DeepSeek, some OpenRouter models)
  // fail when this is present because they add extra fields to tool calls
  if (result.additionalProperties === false) {
    delete result.additionalProperties;
  }

  // Recursively clean nested properties
  if (result.properties && typeof result.properties === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(result.properties)) {
      cleaned[key] = cleanSchemaForLLM(value);
    }
    result.properties = cleaned;
  }

  // Clean items in arrays
  if (result.items) {
    result.items = cleanSchemaForLLM(result.items);
  }

  // Clean oneOf / anyOf / allOf
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].map((s: any) => cleanSchemaForLLM(s));
    }
  }

  // Clean $defs
  if (result.$defs && typeof result.$defs === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(result.$defs)) {
      cleaned[key] = cleanSchemaForLLM(value);
    }
    result.$defs = cleaned;
  }

  return result;
}

/**
 * Fallback converter for schemas that z.toJSONSchema() can't handle.
 * Uses Zod 4's public API (_zod.def) instead of the old Zod 3 ._def.
 */
function fallbackZodConvert(schema: any): any {
  if (!schema) return {};

  const def = schema?._zod?.def ?? schema?._def;
  if (!def) return {};

  const type = def.type ?? def.typeName;
  const description = schema?.description ?? def?.description;

  const base: any = {};
  if (description) base.description = String(description);

  switch (type) {
    case 'string':
      return { type: 'string', ...base };
    case 'number':
    case 'float':
      return { type: 'number', ...base };
    case 'int':
    case 'integer':
      return { type: 'integer', ...base };
    case 'boolean':
      return { type: 'boolean', ...base };
    case 'object': {
      const shape = schema?.shape ?? def?.shape;
      if (shape && typeof shape === 'object') {
        const properties: any = {};
        const required: string[] = [];
        for (const [key, fieldSchema] of Object.entries(shape)) {
          properties[key] = zodToJsonSchema(fieldSchema);
          const fieldDef = (fieldSchema as any)?._zod?.def ?? (fieldSchema as any)?._def;
          const isOptional = fieldDef?.type === 'optional' || fieldDef?.typeName === 'ZodOptional';
          const hasDefault = fieldDef?.type === 'default' || fieldDef?.typeName === 'ZodDefault';
          if (!isOptional && !hasDefault) {
            required.push(key);
          }
        }
        return { type: 'object', properties, ...(required.length ? { required } : {}), ...base };
      }
      return { type: 'object', ...base };
    }
    case 'array': {
      const elementSchema = schema?.element ?? def?.element ?? def?.innerType;
      return { type: 'array', items: zodToJsonSchema(elementSchema), ...base };
    }
    case 'enum': {
      const values = def?.values ?? def?.entries;
      return { type: 'string', enum: Array.isArray(values) ? values : Object.values(values || {}), ...base };
    }
    case 'literal': {
      const value = def?.value ?? def?.values?.[0];
      return { type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string', const: value, ...base };
    }
    case 'union':
    case 'discriminatedUnion': {
      const options = def?.options ?? [];
      return { anyOf: options.map((o: any) => zodToJsonSchema(o)), ...base };
    }
    case 'optional': {
      const inner = def?.innerType;
      return zodToJsonSchema(inner);
    }
    case 'nullable': {
      const inner = def?.innerType;
      const innerSchema = zodToJsonSchema(inner);
      return { anyOf: [innerSchema, { type: 'null' }], ...base };
    }
    case 'default': {
      const inner = def?.innerType;
      const result = zodToJsonSchema(inner);
      try {
        const dv = def?.defaultValue;
        result.default = typeof dv === 'function' ? dv() : dv;
      } catch {}
      return result;
    }
    case 'record':
      return { type: 'object', ...base };
    default:
      return base;
  }
}

// ─── Template generation ─────────────────────────────────────────────────────

/**
 * Generate a template / example args object from a JSON Schema.
 * Uses the JSON Schema output from zodToJsonSchema() to create default values.
 */
export function jsonSchemaToTemplate(schema: any): any {
  if (!schema || typeof schema !== 'object') return null;

  // Handle default values
  if ('default' in schema) return schema.default;

  switch (schema.type) {
    case 'object': {
      const out: any = {};
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          out[key] = jsonSchemaToTemplate(propSchema as any);
        }
      }
      return out;
    }
    case 'array':
      return [];
    case 'string': {
      if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum[0];
      }
      return '';
    }
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default: {
      // Handle anyOf / oneOf — take first option
      const options = schema.anyOf || schema.oneOf;
      if (Array.isArray(options) && options.length > 0) {
        return jsonSchemaToTemplate(options[0]);
      }
      // Handle const
      if ('const' in schema) return schema.const;
      return null;
    }
  }
}

/**
 * Generate a template from a Zod schema directly.
 * Convenience wrapper: zodToJsonSchema() → jsonSchemaToTemplate().
 */
export function zodToTemplate(schema: any): any {
  if (!schema) return {};
  const jsonSchema = zodToJsonSchema(schema);
  return jsonSchemaToTemplate(jsonSchema);
}
