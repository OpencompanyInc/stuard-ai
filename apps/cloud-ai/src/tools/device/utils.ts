/**
 * Utility tools for common operations that don't need scripts.
 * These are lightweight, fast tools for getting date/time, math, UUIDs, etc.
 */

import { z } from 'zod';
import { makeLocalTool, anyJsonValue } from './shared';

export const get_datetime = makeLocalTool(
  'get_datetime',
  'Get current date and time with optional formatting. Returns ISO, unix timestamp, date parts, formatted strings, etc.',
  z.object({
    format: z.string().optional().describe('Custom strftime format string (e.g., "%Y-%m-%d %H:%M")'),
    tzOffset: z.number().optional().describe('Timezone offset in minutes from UTC'),
  }),
  z.object({
    ok: z.boolean(),
    iso: z.string().optional(),
    unix: z.number().optional(),
    unixMs: z.number().optional(),
    year: z.number().optional(),
    month: z.number().optional(),
    day: z.number().optional(),
    hour: z.number().optional(),
    minute: z.number().optional(),
    second: z.number().optional(),
    weekday: z.string().optional(),
    weekdayShort: z.string().optional(),
    monthName: z.string().optional(),
    monthShort: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    time12: z.string().optional(),
    formatted: z.string().optional(),
  }),
);

export const math_eval = makeLocalTool(
  'math_eval',
  'Evaluate a safe math expression. Supports: abs, round, min, max, sum, pow, sqrt, sin, cos, tan, log, exp, floor, ceil, pi, e, etc.',
  z.object({
    expression: z.string().describe('Math expression to evaluate (e.g., "sqrt(16) + pow(2, 3)")'),
  }),
  z.object({
    ok: z.boolean(),
    result: z.union([z.number(), z.boolean()]).optional(),
    expression: z.string().optional(),
    type: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const generate_uuid = makeLocalTool(
  'generate_uuid',
  'Generate one or more UUIDs',
  z.object({
    version: z.number().int().min(1).max(4).default(4).describe('UUID version (1 or 4)'),
    count: z.number().int().min(1).max(100).default(1).describe('Number of UUIDs to generate'),
  }),
  z.object({
    ok: z.boolean(),
    uuid: z.string().optional().describe('Single UUID if count=1'),
    uuids: z.array(z.string()).optional().describe('Array of UUIDs if count>1'),
    count: z.number().optional(),
  }),
);

export const random_number = makeLocalTool(
  'random_number',
  'Generate random number(s) within a range',
  z.object({
    min: z.number().default(0).describe('Minimum value'),
    max: z.number().default(100).describe('Maximum value'),
    count: z.number().int().min(1).max(1000).default(1).describe('Number of values to generate'),
    float: z.boolean().default(false).describe('Generate floating-point numbers'),
    decimals: z.number().int().min(0).max(10).default(2).describe('Decimal places for floats'),
  }),
  z.object({
    ok: z.boolean(),
    value: z.number().optional().describe('Single value if count=1'),
    values: z.array(z.number()).optional().describe('Array of values if count>1'),
    min: z.number().optional(),
    max: z.number().optional(),
    count: z.number().optional(),
  }),
);

export const random_choice = makeLocalTool(
  'random_choice',
  'Pick random item(s) from a list',
  z.object({
    items: z.array(anyJsonValue).describe('Array of items to choose from'),
    count: z.number().int().min(1).default(1).describe('Number of items to pick'),
    allowDuplicates: z.boolean().default(false).describe('Allow picking the same item multiple times'),
  }),
  z.object({
    ok: z.boolean(),
    choice: z.any().optional().describe('Single choice if count=1'),
    choices: z.array(z.any()).optional().describe('Array of choices if count>1'),
    count: z.number().optional(),
  }),
);

export const get_env_var = makeLocalTool(
  'get_env_var',
  'Get an environment variable value',
  z.object({
    name: z.string().describe('Environment variable name'),
    default: anyJsonValue.optional().describe('Default value if not found'),
  }),
  z.object({
    ok: z.boolean(),
    name: z.string().optional(),
    value: z.any().optional(),
    exists: z.boolean().optional(),
  }),
);

export const get_system_info = makeLocalTool(
  'get_system_info',
  'Get basic system information (OS, hostname, username, paths)',
  z.object({}),
  z.object({
    ok: z.boolean(),
    os: z.string().optional(),
    osVersion: z.string().optional(),
    osRelease: z.string().optional(),
    machine: z.string().optional(),
    processor: z.string().optional(),
    python: z.string().optional(),
    hostname: z.string().optional(),
    username: z.string().optional(),
    home: z.string().optional(),
    cwd: z.string().optional(),
  }),
);

export const hash_string = makeLocalTool(
  'hash_string',
  'Hash a string using MD5, SHA1, SHA256, or SHA512',
  z.object({
    text: z.string().describe('Text to hash'),
    algorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']).default('sha256'),
  }),
  z.object({
    ok: z.boolean(),
    hash: z.string().optional(),
    algorithm: z.string().optional(),
    length: z.number().optional(),
  }),
);

export const base64_encode = makeLocalTool(
  'base64_encode',
  'Encode text to base64',
  z.object({
    text: z.string().describe('Text to encode'),
    urlSafe: z.boolean().default(false).describe('Use URL-safe encoding'),
  }),
  z.object({
    ok: z.boolean(),
    encoded: z.string().optional(),
    urlSafe: z.boolean().optional(),
  }),
);

export const base64_decode = makeLocalTool(
  'base64_decode',
  'Decode base64 to text',
  z.object({
    encoded: z.string().describe('Base64 string to decode'),
    urlSafe: z.boolean().default(false).describe('Input uses URL-safe encoding'),
  }),
  z.object({
    ok: z.boolean(),
    decoded: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const json_parse = makeLocalTool(
  'json_parse',
  'Parse a JSON string into an object',
  z.object({
    text: z.string().describe('JSON string to parse'),
  }),
  z.object({
    ok: z.boolean(),
    data: z.any().optional(),
    type: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const json_stringify = makeLocalTool(
  'json_stringify',
  'Convert data to JSON string',
  z.object({
    data: anyJsonValue.describe('Data to stringify'),
    pretty: z.boolean().default(false).describe('Pretty-print with indentation'),
  }),
  z.object({
    ok: z.boolean(),
    json: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const sleep = makeLocalTool(
  'sleep',
  'Sleep/wait for a specified duration (max 5 minutes)',
  z.object({
    ms: z.number().optional().describe('Duration in milliseconds'),
    seconds: z.number().optional().describe('Duration in seconds'),
  }),
  z.object({
    ok: z.boolean(),
    sleptMs: z.number().optional(),
    error: z.string().optional(),
  }),
);

export const regex_match = makeLocalTool(
  'regex_match',
  'Match a regex pattern against text and get all matches with groups',
  z.object({
    text: z.string().describe('Text to search'),
    pattern: z.string().describe('Regex pattern'),
    flags: z.string().optional().describe('Flags: i=ignore case, m=multiline, s=dotall'),
  }),
  z.object({
    ok: z.boolean(),
    matches: z.array(z.object({
      match: z.string(),
      start: z.number(),
      end: z.number(),
      groups: z.array(z.string()).nullable().optional(),
      namedGroups: z.record(z.string(), z.string()).optional(),
    })).optional(),
    count: z.number().optional(),
    hasMatch: z.boolean().optional(),
    error: z.string().optional(),
  }),
);

export const regex_replace = makeLocalTool(
  'regex_replace',
  'Replace text using a regex pattern',
  z.object({
    text: z.string().describe('Text to modify'),
    pattern: z.string().describe('Regex pattern'),
    replacement: z.string().describe('Replacement string (can use \\1, \\2 for groups)'),
    flags: z.string().optional().describe('Flags: i=ignore case, m=multiline, s=dotall'),
    count: z.number().int().default(0).describe('Max replacements (0 = all)'),
  }),
  z.object({
    ok: z.boolean(),
    result: z.string().optional(),
    changed: z.boolean().optional(),
    error: z.string().optional(),
  }),
);
