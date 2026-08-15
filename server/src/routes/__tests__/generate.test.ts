import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase } from '../../__tests__/setup';

// Mock the Anthropic SDK the same way books.test.ts does. The point of most
// assertions below is that mockCreate is NEVER reached — an unauthenticated
// caller must not be able to spend the project's API budget.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  }
  return { default: MockAnthropic };
});

// Stub illustrations so cover/full preview modes can't reach a paid image API.
vi.mock('../../services/illustrations', async () => {
  const actual = await vi.importActual<typeof import('../../services/illustrations')>(
    '../../services/illustrations',
  );
  return {
    ...actual,
    generateCover: vi.fn(),
    generateIllustration: vi.fn(),
    isImageGenConfigured: () => false,
  };
});

const VALID_BODY = {
  theme: 'space',
  ageRange: '5-7',
  characterName: 'Luna',
};

async function createUserAndGetToken(app: Express): Promise<string> {
  const res = await request(app).post('/api/auth/register').send({
    email: `gen-${Date.now()}@example.com`,
    name: 'Gen Tester',
    password: 'test-password',
  });
  return res.body.token as string;
}

describe('POST /api/generate — auth gate', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
    mockCreate.mockReset();
    // The handler 500s on a missing key before it ever constructs the client.
    // Stub one so the authed case actually exercises the path past the gate —
    // the SDK itself is mocked, so nothing leaves the process.
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).post('/api/generate').send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Not authenticated');
  });

  it('does NOT call the Anthropic API when unauthenticated', async () => {
    // The regression this pins: the handler used to call Claude before
    // touching the DB, so an anonymous request cost real money even when the
    // database was down. The gate must short-circuit before any paid call.
    await request(app).post('/api/generate').send(VALID_BODY);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not spend on a full-book request from an anonymous caller', async () => {
    // previewMode 'full' with a high pageCount is the most expensive shape the
    // route accepts — cover plus one image per page on top of the story call.
    await request(app)
      .post('/api/generate')
      .send({ ...VALID_BODY, previewMode: 'full', pageCount: 15 });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a malformed Bearer token with 401', async () => {
    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('lets an authenticated caller through the gate', async () => {
    // Proves the gate isn't simply blocking everyone. We assert the request
    // gets PAST auth — validation of the body happens after, so a 401 here
    // would mean the gate is wrong; anything else means it passed.
    const token = await createUserAndGetToken(app);
    mockCreate.mockRejectedValueOnce(new Error('stop before real work'));

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('still validates the body for authenticated callers', async () => {
    const token = await createUserAndGetToken(app);

    const res = await request(app)
      .post('/api/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'space' }); // missing ageRange + character

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
