import { z } from 'zod';

/**
 * Gemini-safe replacements for `z.any()` in tool INPUT schemas.
 *
 * `z.any()` converts to a *typeless* JSON-schema node (`{}` with no `type`).
 * Strict providers like Google Gemini reject typeless properties/items in
 * function declarations — they drop the node and then error on the now-dangling
 * `required` entry (`parameters.required[N]: property is not defined`). The
 * typed equivalents below accept the same realistic JSON values at runtime
 * while staying representable for every provider.
 *
 * - `anyJsonObject`: an arbitrary key/value object. The Google converter drops
 *   `additionalProperties`, leaving a valid `{ type: 'object' }`.
 * - `anyJsonValue`: a single scalar / null / object value.
 * - `anyJsonArray`: an array of `anyJsonValue` items (typed items).
 */
export const anyJsonObject = z.record(z.string(), z.any());
export const anyJsonValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  anyJsonObject,
]);
export const anyJsonArray = z.array(anyJsonValue);
