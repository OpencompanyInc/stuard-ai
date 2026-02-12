/**
 * Agentic File Tools
 *
 * Specialized file read/edit tools for AI agents with safety limits.
 * Used by stuard-agent for precise file operations.
 */

import { z } from 'zod';
import { makeLocalTool } from './device/shared';

const MAX_FILE_LINES = 650;

/**
 * File Read Tool
 *
 * Reads file contents with line range support.
 * - whole_file: Read entire file (errors if > 650 lines)
 * - line_start/line_end: Read specific line range
 */
export const file_read = makeLocalTool(
  'file_read',
  `Read file contents. Returns file content with line numbers.

MODES:
1. Whole file: Set whole_file=true (ERRORS if file has > ${MAX_FILE_LINES} lines)
2. Line range: Specify line_start and line_end (1-indexed, inclusive)

For large files (> ${MAX_FILE_LINES} lines), you MUST use line_start and line_end to read portions.

RETURNS:
- content: File content with line numbers
- total_lines: Total line count in file
- line_start/line_end: Actual range returned
- truncated: True if file was too large and you must specify a range`,
  z.object({
    path: z.string().describe('Absolute path to file'),
    whole_file: z.boolean().optional().describe(`Set to true to read entire file (fails if > ${MAX_FILE_LINES} lines)`),
    line_start: z.number().int().positive().optional().describe('Starting line (1-indexed, inclusive)'),
    line_end: z.number().int().positive().optional().describe('Ending line (1-indexed, inclusive)'),
  }),
  z.object({
    ok: z.boolean(),
    content: z.string().optional(),
    total_lines: z.number().optional(),
    line_start: z.number().optional(),
    line_end: z.number().optional(),
    lines_returned: z.number().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
);

/**
 * File Edit Tool
 *
 * Edit files using string-based matching (no line numbers needed):
 * - replace: Find old_string and replace with new_string
 * - insert_before: Insert new_string before old_string
 * - insert_after: Insert new_string after old_string
 * - delete: Delete old_string from the file
 * - regex: Use regex pattern matching
 */
export const file_edit = makeLocalTool(
  'file_edit',
  `Edit file contents using string-based matching.

MODES:
1. replace (default): Find old_string and replace with new_string
   - Fails if old_string appears multiple times (for safety)
   - Set replace_all=true to replace all occurrences

2. insert_before: Insert new_string before old_string
   - The old_string remains in the file

3. insert_after: Insert new_string after old_string
   - The old_string remains in the file

4. delete: Remove old_string from the file
   - Set replace_all=true to delete all occurrences

5. regex: Use regex pattern for old_string
   - new_string can use capture groups ($1, $2, etc.)

SAFETY:
- By default, fails if old_string matches multiple times (prevents accidental mass edits)
- Set replace_all=true to allow multiple replacements
- Always returns error if old_string is not found

RETURNS:
- ok: Whether operation succeeded
- changes: Number of occurrences modified
- message: Description of what was done`,
  z.object({
    path: z.string().describe('Absolute path to file'),
    mode: z.enum(['replace', 'insert_before', 'insert_after', 'delete', 'regex']).default('replace').describe('Edit mode'),
    old_string: z.string().describe('The exact text to find in the file'),
    new_string: z.string().optional().describe('The replacement text (required for replace/insert modes)'),
    replace_all: z.boolean().optional().describe('Replace all occurrences instead of failing on multiple matches (default: false)'),
    description: z.string().optional().describe('Brief description of what change you are making'),
  }),
  z.object({
    ok: z.boolean(),
    mode: z.string().optional(),
    changes: z.number().optional(),
    occurrences: z.number().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
);

/**
 * Glob Tool
 *
 * Finds files/folders using a glob pattern.
 */
export const glob = makeLocalTool(
  'glob',
  `Find files/folders using a glob pattern.

PARAMS:
- pattern: Glob pattern (required)
- root: Optional base path
- recursive: Enable ** to match recursively (default true)
- include_files/include_dirs: Filter results
- max_results: Max results to return

RETURNS:
- items: [{ path, type }]
- count: Number of results
- truncated: True if max_results hit`,
  z.object({
    pattern: z.string().describe('Glob pattern to match'),
    root: z.string().optional().describe('Optional base path for the pattern'),
    recursive: z.boolean().optional().describe('Enable recursive glob (**). Default true'),
    include_files: z.boolean().optional().describe('Include files (default true)'),
    include_dirs: z.boolean().optional().describe('Include directories (default true)'),
    max_results: z.number().int().positive().optional().describe('Max results to return'),
  }),
  z.object({
    ok: z.boolean(),
    items: z.array(z.object({
      path: z.string(),
      type: z.enum(['file', 'dir']),
    })).optional(),
    count: z.number().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
);

/**
 * Grep Tool
 *
 * Searches for text in files within a file or directory.
 */
export const grep = makeLocalTool(
  'grep',
  `Search text in files (regex or literal).

PARAMS:
- path: File or directory to search
- pattern: Search pattern
- regex: Treat pattern as regex (default true)
- case_sensitive: Default true
- include_glob/exclude_glob: Filter filenames (string or string[])
- max_results: Max matches to return
- max_file_size: Skip files larger than this (bytes)

RETURNS:
- results: [{ path, line_number, line, match }]
- count: Number of matches
- truncated: True if max_results hit`,
  z.object({
    path: z.string().describe('File or directory to search'),
    pattern: z.string().describe('Search pattern'),
    regex: z.boolean().optional().describe('Treat pattern as regex (default true)'),
    case_sensitive: z.boolean().optional().describe('Case-sensitive search (default true)'),
    include_glob: z.union([z.string(), z.array(z.string())]).optional().describe('Include filename glob(s)'),
    exclude_glob: z.union([z.string(), z.array(z.string())]).optional().describe('Exclude filename glob(s)'),
    max_results: z.number().int().positive().optional().describe('Max matches to return'),
    max_file_size: z.number().int().positive().optional().describe('Skip files larger than this in bytes'),
  }),
  z.object({
    ok: z.boolean(),
    results: z.array(z.object({
      path: z.string(),
      line_number: z.number(),
      line: z.string(),
      match: z.string(),
    })).optional(),
    count: z.number().optional(),
    truncated: z.boolean().optional(),
    skipped_too_large: z.number().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
);

// Export all tools
export const agenticFileTools = {
  file_read,
  file_edit,
  glob,
  grep,
};
