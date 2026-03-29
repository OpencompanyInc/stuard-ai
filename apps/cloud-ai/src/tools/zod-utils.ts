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
