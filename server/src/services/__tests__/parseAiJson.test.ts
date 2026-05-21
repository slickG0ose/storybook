import { describe, it, expect } from 'vitest';
import { parseAiJson } from '../parseAiJson';

describe('parseAiJson', () => {
  it('parses clean JSON on the happy path', () => {
    const input = '{"title": "Hello", "pages": []}';
    const result = parseAiJson(input) as { title: string; pages: unknown[] };
    expect(result.title).toBe('Hello');
    expect(result.pages).toEqual([]);
  });

  it('strips markdown code fences before parsing', () => {
    const input = '```json\n{"title": "Hello", "pages": []}\n```';
    const result = parseAiJson(input) as { title: string };
    expect(result.title).toBe('Hello');
  });

  it('strips leading/trailing prose before parsing', () => {
    const input = "Sure! Here's your story:\n{\"title\": \"Hello\", \"pages\": []}\n\nLet me know if you want changes.";
    const result = parseAiJson(input) as { title: string };
    expect(result.title).toBe('Hello');
  });

  it('repairs trailing commas via jsonrepair', () => {
    const input = '{"title": "Hello", "pages": [],}';
    const result = parseAiJson(input) as { title: string; pages: unknown[] };
    expect(result.title).toBe('Hello');
    expect(result.pages).toEqual([]);
  });

  it('repairs JSON with an unescaped double-quote inside a string value', () => {
    // Mimics the real Anthropic failure mode: the model writes an unescaped
    // quote inside a long string, breaking JSON.parse mid-property. This is
    // the case that motivated this helper — the previous regex-only fallback
    // would re-throw on this input.
    const input = '{"title": "Mira\'s Adventure", "description": "The wizard said "hello" to Mira and she laughed.", "pages": []}';
    expect(() => JSON.parse(input)).toThrow(); // sanity: native parse rejects it
    const result = parseAiJson(input) as { title: string; description: string };
    expect(result.title).toBe("Mira's Adventure");
    // jsonrepair makes a best-effort recovery; we just need a non-empty string.
    expect(typeof result.description).toBe('string');
    expect(result.description.length).toBeGreaterThan(0);
  });

  it('repairs the structure of a story-shaped payload with malformed pages', () => {
    // Full GeneratedStory shape with a trailing comma + missing closing brace
    // on the last page object — closer to what we'd see in a real long Claude
    // response that gets truncated or fumbles internal quoting.
    const input = `{
      "title": "The Brave Little Star",
      "description": "A story about courage.",
      "coverEmoji": "⭐",
      "coverColor": "#7c3aed",
      "coverDescription": "A glowing star against a deep sky.",
      "pages": [
        {"text": "Once upon a time,", "illustrationDescription": "a star",},
        {"text": "the end.", "illustrationDescription": "stars shining"
      ]
    }`;
    const result = parseAiJson(input) as {
      title: string;
      pages: { text: string; illustrationDescription: string }[];
    };
    expect(result.title).toBe('The Brave Little Star');
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1].text).toBe('the end.');
  });

  it('throws the canonical error when content has no JSON object', () => {
    expect(() => parseAiJson('I cannot generate that story.')).toThrow(
      'Failed to parse story from AI response',
    );
  });

  it('throws the canonical error when even jsonrepair cannot recover', () => {
    // A block that starts with { but is too mangled for repair to make sense
    // of — gibberish inside braces.
    const input = '{ : : : } extra garbage';
    expect(() => parseAiJson(input)).toThrow('Failed to parse story from AI response');
  });
});
