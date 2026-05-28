import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { agentFiles } from '../helpers/paths';
import { readFrontmatter } from '../helpers/frontmatter';

describe('.claude/agents/*.md — frontmatter schema', () => {
  const files = agentFiles();

  it('finds at least one agent file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has required frontmatter', (file) => {
    const { data, body } = readFrontmatter(file);

    expect(data.name, `${file}: missing "name" in frontmatter`).toBeDefined();
    expect(data.name, `${file}: "name" must be kebab-case`).toMatch(/^[a-z][a-z0-9-]*$/);

    expect(data.description, `${file}: missing "description"`).toBeDefined();
    expect(data.description!.length, `${file}: "description" must be non-trivial`).toBeGreaterThan(20);

    expect(body.trim(), `${file}: body must have content beyond frontmatter`).not.toBe('');
  });

  it.each(files)('%s name field matches filename', (file) => {
    const { data } = readFrontmatter(file);
    const expected = path.basename(file, '.md');
    expect(data.name, `${file}: frontmatter name must match filename`).toBe(expected);
  });
});
