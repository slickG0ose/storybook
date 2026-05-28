import { readFileSync } from 'node:fs';

export type Frontmatter = { data: Record<string, string>; body: string };

const RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const LINE_RE = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;

export function parseFrontmatter(text: string): Frontmatter {
  const m = RE.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = LINE_RE.exec(line);
    if (!km) continue;
    let v = km[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    data[km[1]] = v;
  }
  return { data, body: m[2] };
}

export function readFrontmatter(path: string): Frontmatter {
  return parseFrontmatter(readFileSync(path, 'utf8'));
}
