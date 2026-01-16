import { z } from 'zod';
import { makeLocalTool } from './shared';

export const set_variable = makeLocalTool(
  'set_variable',
  'Set a workflow variable. For workflow-scoped variables (workflow.*), the variable must be defined in the workflow\'s variables array. Supports types: boolean, string, number, list.',
  z.object({
    name: z.string().describe('Variable name'),
    value: z.any().describe('Value to set'),
    type: z
      .enum(['boolean', 'string', 'number', 'list'])
      .optional()
      .describe('Type (auto-detected if not specified)'),
    flowId: z.string().optional().describe('Optional: scope to a specific workflow'),
  }),
  z.object({
    ok: z.boolean(),
    name: z.string(),
    value: z.any(),
    type: z.string(),
    updatedAt: z.string(),
  }),
);

export const get_variable = makeLocalTool(
  'get_variable',
  'Get a workflow variable value. For workflow-scoped variables (workflow.*), the variable must be defined in the workflow\'s variables array.',
  z.object({
    name: z.string().describe('Variable name'),
    default: z.any().optional().describe('Default value if variable does not exist'),
  }),
  z.object({
    ok: z.boolean(),
    name: z.string(),
    value: z.any(),
    type: z.string().optional(),
    exists: z.boolean(),
  }),
);

export const toggle_variable = makeLocalTool(
  'toggle_variable',
  'Toggle a boolean variable (true → false or false → true). Creates as false if not exists.',
  z.object({
    name: z.string().describe('Variable name'),
    flowId: z.string().optional(),
  }),
  z.object({
    ok: z.boolean(),
    name: z.string(),
    previousValue: z.any(),
    value: z.boolean(),
    type: z.literal('boolean'),
  }),
);

export const increment_variable = makeLocalTool(
  'increment_variable',
  'Increment a number variable by a specified amount. Creates as 0 if not exists.',
  z.object({
    name: z.string().describe('Variable name'),
    amount: z.number().optional().default(1).describe('Amount to add (default: 1)'),
    flowId: z.string().optional(),
  }),
  z.object({
    ok: z.boolean(),
    name: z.string(),
    previousValue: z.number(),
    value: z.number(),
    type: z.literal('number'),
  }),
);

export const append_to_list = makeLocalTool(
  'append_to_list',
  'Append an item to a list variable. Creates empty list if not exists.',
  z.object({
    name: z.string().describe('Variable name'),
    item: z.any().describe('Item to append'),
    flowId: z.string().optional(),
  }),
  z.object({
    ok: z.boolean(),
    name: z.string(),
    previousLength: z.number(),
    value: z.array(z.any()),
    type: z.literal('list'),
  }),
);

export const list_variables = makeLocalTool(
  'list_variables',
  'List all workflow variables, optionally filtered by prefix or flowId.',
  z.object({
    prefix: z.string().optional().describe('Only return variables starting with this prefix'),
    flowId: z.string().optional().describe('Only return variables scoped to this workflow'),
  }),
  z.object({
    ok: z.boolean(),
    count: z.number(),
    variables: z.array(
      z.object({
        name: z.string(),
        value: z.any(),
        type: z.string(),
        updatedAt: z.string(),
      }),
    ),
  }),
);

export const delete_variable = makeLocalTool(
  'delete_variable',
  'Delete a workflow variable.',
  z.object({
    name: z.string().describe('Variable name to delete'),
  }),
  z.object({
    ok: z.boolean(),
    name: z.string(),
    deleted: z.boolean().describe('True if the variable existed and was deleted'),
  }),
);
