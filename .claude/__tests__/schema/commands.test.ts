import { describe, expect, it } from 'vitest';
import { commandFiles } from '../helpers/paths';
import { readFrontmatter } from '../helpers/frontmatter';

describe('.claude/commands/*.md — frontmatter schema', () => {
  const files = commandFiles();

  it('finds at least one command file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has required frontmatter', (file) => {
    const { data, body } = readFrontmatter(file);

    expect(data.description, `${file}: missing "description"`).toBeDefined();
    expect(data.description!.length, `${file}: "description" must be non-trivial`).toBeGreaterThan(20);

    // argument-hint is optional, but when present must be non-empty
    if ('argument-hint' in data) {
      expect(
        data['argument-hint']!.length,
        `${file}: empty argument-hint must be omitted, not blank`,
      ).toBeGreaterThan(0);
    }

    expect(body.trim(), `${file}: body must have content beyond frontmatter`).not.toBe('');
  });

  it.each(files)('%s does not declare an agent-only "name" or "mode" field', (file) => {
    const { data } = readFrontmatter(file);
    expect(data.name, `${file}: commands do not use "name" (that's for agents/skills)`).toBeUndefined();
    expect(data.mode, `${file}: commands do not use "mode" (that's for skills)`).toBeUndefined();
  });
});
