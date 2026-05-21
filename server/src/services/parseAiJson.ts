import { jsonrepair } from 'jsonrepair';

/**
 * Parse a JSON-shaped string returned by Claude (or any LLM).
 *
 * LLMs occasionally return malformed JSON in long-tail cases:
 *   - unescaped quotes/apostrophes inside string values
 *   - trailing commas
 *   - markdown code fences around the JSON
 *   - trailing prose after the JSON object
 *
 * Strategy:
 *   1. Try a clean `JSON.parse` first — happy path, no allocation cost.
 *   2. On failure, extract the outermost `{...}` block (strips code fences
 *      or trailing prose).
 *   3. Run that extracted block through `jsonrepair` to fix unescaped
 *      quotes, trailing commas, etc.
 *   4. Final `JSON.parse` on the repaired output.
 *
 * If even repair fails, throw — the caller's existing try/catch surfaces
 * the original 500 error shape to the client.
 *
 * NOTE: callers receive `unknown` and should narrow with their own type
 * assertion. This helper does NOT validate the JSON shape — it only
 * guarantees you get a parsed JS value back.
 */
export function parseAiJson(content: string): unknown {
  // Happy path: clean JSON.
  try {
    return JSON.parse(content);
  } catch {
    // fall through to repair
  }

  // Extract outermost {...} block. Strips markdown fences, trailing prose,
  // leading apologies, etc.
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse story from AI response');
  }

  // Repair common LLM JSON defects (unescaped quotes, trailing commas).
  // jsonrepair returns a string; we still need JSON.parse to get a JS value.
  try {
    const repaired = jsonrepair(jsonMatch[0]);
    return JSON.parse(repaired);
  } catch {
    throw new Error('Failed to parse story from AI response');
  }
}
