import { describe, it, expect } from 'vitest';
import { FeedbackCreateRequestSchema, FEEDBACK_MESSAGE_MAX } from '@storybook/shared';

/**
 * Contract tests for the tester-feedback create request
 * (spec: .code-captain/specs/tester-feedback-widget/spec.md §"Schema / contract changes").
 *
 * The stored `route` is later rendered as an admin `<Link to>`, so the in-app-path
 * rule is a security boundary, not a nicety. `user_id` must never survive the parse:
 * the server takes identity from the session only.
 */

const valid = {
  category: 'bug',
  message: 'The page turn stutters on the last page.',
  route: '/',
  book_id: null,
  session_id: '3f2c1d9e-0000-4000-8000-000000000000',
  viewport_width: 393,
  viewport_height: 852,
  theme: 'dark',
  client_build: 'abc1234',
};

const parse = (overrides: Record<string, unknown>) =>
  FeedbackCreateRequestSchema.safeParse({ ...valid, ...overrides });

describe('FeedbackCreateRequestSchema', () => {
  it('accepts a complete valid report', () => {
    expect(parse({}).success).toBe(true);
  });

  describe('route (InAppRouteSchema)', () => {
    it.each(['/', '/book/abc?theater=1'])('accepts in-app path %j', (route) => {
      expect(parse({ route }).success).toBe(true);
    });

    it.each(['//evil.example', 'https://x', 'javascript:alert(1)', ''])(
      'rejects %j',
      (route) => {
        expect(parse({ route }).success).toBe(false);
      },
    );
  });

  describe('message', () => {
    it('trims surrounding whitespace', () => {
      const result = parse({ message: '   hello there  \n' });
      expect(result.success).toBe(true);
      expect(result.data?.message).toBe('hello there');
    });

    it('rejects a whitespace-only message', () => {
      expect(parse({ message: '   \n\t  ' }).success).toBe(false);
    });

    it('accepts exactly 2000 characters', () => {
      expect(FEEDBACK_MESSAGE_MAX).toBe(2000);
      expect(parse({ message: 'a'.repeat(2000) }).success).toBe(true);
    });

    it('rejects 2001 characters', () => {
      expect(parse({ message: 'a'.repeat(2001) }).success).toBe(false);
    });
  });

  describe('enums', () => {
    it('rejects a category outside the enum', () => {
      expect(parse({ category: 'complaint' }).success).toBe(false);
    });

    it('rejects a theme outside the enum', () => {
      expect(parse({ theme: 'sepia' }).success).toBe(false);
    });
  });

  it('strips unknown keys such as user_id', () => {
    const result = parse({ user_id: 'someone-else', is_admin: true });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('user_id');
    expect(result.data).not.toHaveProperty('is_admin');
    expect(result.data).toMatchObject({
      category: 'bug',
      route: '/',
      session_id: valid.session_id,
    });
  });
});
