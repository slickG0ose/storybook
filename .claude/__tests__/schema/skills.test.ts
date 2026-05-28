import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { skillFiles } from '../helpers/paths';
import { readFrontmatter } from '../helpers/frontmatter';

describe('.claude/skills/*/SKILL.md — frontmatter schema', () => {
  const files = skillFiles();

  it('finds at least one skill file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has required frontmatter', (file) => {
    const { data, body } = readFrontmatter(file);

    expect(data.name, `${file}: missing "name"`).toBeDefined();
    expect(data.name, `${file}: "name" must be kebab-case`).toMatch(/^[a-z][a-z0-9-]*$/);

    expect(data.mode, `${file}: missing "mode"`).toBeDefined();
    expect(['agent', 'inline'], `${file}: "mode" must be agent | inline`).toContain(data.mode);

    expect(data.description, `${file}: missing "description"`).toBeDefined();
    expect(data.description!.length, `${file}: "description" must be non-trivial`).toBeGreaterThan(20);

    // argument-hint is OPTIONAL for skills. Convention is inconsistent:
    // - swab declares it as empty string ("")
    // - explain-code, research, mcp-analysis declare a real hint
    // - analyze-repos omits the field entirely
    // We accept all three forms; future cleanup may want to standardize.
    // No assertion here on purpose.

    expect(body.trim(), `${file}: body must have content beyond frontmatter`).not.toBe('');
  });

  it.each(files)('%s name field matches parent directory', (file) => {
    const { data } = readFrontmatter(file);
    const expected = path.basename(path.dirname(file));
    expect(data.name, `${file}: frontmatter name must match parent dir`).toBe(expected);
  });
});
