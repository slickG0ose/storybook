import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  FeedbackCreateRequestSchema,
  FeedbackCreateResponseSchema,
  type FeedbackCreateRequest,
} from '@storybook/shared';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/requireAuth';
import { rateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';

/**
 * Tester feedback (#157, spec .code-captain/specs/tester-feedback-widget/).
 *
 * One route: a signed-in tester files one report. The admin list and status routes
 * live under /api/admin/feedback in routes/admin.ts, behind adminGate.
 *
 * Middleware order is load-bearing: requireAuth → rateLimit → validate → handler.
 * rateLimit keys on res.locals.user, so it must follow requireAuth, and it runs
 * before validate on purpose — malformed bodies count toward the limit, so a caller
 * cannot probe validation errors at unlimited speed.
 *
 * No spend gate: nothing here is paid. The rate limit exists because every call
 * writes a DB row.
 */
const router = Router();

export const FEEDBACK_RATE_LIMIT = {
  max: 10,
  windowMs: 10 * 60 * 1000,
  bucket: 'feedback',
} as const;

const USER_AGENT_MAX = 512;

router.post(
  '/',
  requireAuth,
  rateLimit({
    ...FEEDBACK_RATE_LIMIT,
    message: "You've sent a lot of feedback in a few minutes. Try again shortly.",
  }),
  validate({
    name: 'POST /api/feedback',
    request: FeedbackCreateRequestSchema,
    response: FeedbackCreateResponseSchema,
  }),
  async (req: Request, res: Response) => {
    const body = req.body as FeedbackCreateRequest;
    // user_id comes from the token only. The schema strips any user_id in the body.
    const user = res.locals.user as { id: string };

    // Context must never be the reason a report fails: an unknown book id is
    // stored as null rather than rejected (and would otherwise trip the FK).
    let bookId: string | null = null;
    if (body.book_id) {
      const book = await prisma.book.findUnique({
        where: { id: body.book_id },
        select: { id: true },
      });
      bookId = book ? book.id : null;
    }

    const created = await prisma.feedback.create({
      data: {
        user_id: user.id,
        session_id: body.session_id,
        category: body.category,
        message: body.message,
        route: body.route,
        book_id: bookId,
        user_agent: req.get('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
        viewport_width: body.viewport_width,
        viewport_height: body.viewport_height,
        theme: body.theme,
        client_build: body.client_build,
        server_build: process.env.RENDER_GIT_COMMIT ?? null,
        // Already normalised to ≤5 × 300 chars by the shared schema. Null when
        // empty, so rows without errors read the same as rows written before the
        // column existed; the admin reader parses null back to [].
        recent_errors_json:
          body.recent_errors.length > 0 ? JSON.stringify(body.recent_errors) : null,
      },
    });

    res.status(201).json({
      id: created.id,
      status: created.status,
      created_at: created.created_at.toISOString(),
    });
  },
);

export default router;
