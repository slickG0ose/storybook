import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tester feedback widget (spec: .code-captain/specs/tester-feedback-widget/)
//
// POST /api/feedback        — a signed-in tester files one report.
// GET  /api/admin/feedback  — the admin triage list.
// PATCH /api/admin/feedback/:id — the admin moves a report along new → triaged → done.
//
// `user_id` is never part of the create request: the server takes it from the
// authenticated session only, and z.object() strips any unknown key a client sends.
// ---------------------------------------------------------------------------

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'praise', 'other'] as const;
export const FeedbackCategorySchema = z.enum(FEEDBACK_CATEGORIES);
export const FEEDBACK_STATUSES = ['new', 'triaged', 'done'] as const;
export const FeedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export const FEEDBACK_MESSAGE_MAX = 2000;
// Open question 3 (Nick, 2026-11-08: yes). The client keeps the last 5 window
// `error` / `unhandledrejection` messages. The server normalises rather than
// rejects: a noisy page must never cost the tester their report.
export const FEEDBACK_RECENT_ERRORS_MAX = 5;
export const FEEDBACK_RECENT_ERROR_CHARS = 300;

// In-app path only: must start with a single '/'. Rejects '//evil.example' and
// 'javascript:' so the admin <Link to={route}> cannot become an off-site jump.
const InAppRouteSchema = z.string().max(500).regex(/^\/(?!\/)/);

export const FeedbackCreateRequestSchema = z.object({
  category: FeedbackCategorySchema,
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX),
  route: InAppRouteSchema,
  book_id: z.string().max(64).nullable(),
  session_id: z.string().min(1).max(64), // lenient on purpose: a hint, never a reason to reject
  viewport_width: z.number().int().min(0).max(10000),
  viewport_height: z.number().int().min(0).max(10000),
  theme: z.enum(['light', 'dark']),
  client_build: z.string().max(64).nullable(),
  recent_errors: z
    .array(z.string().max(5000))
    .max(50)
    .default([])
    .transform((errs) =>
      errs.slice(-FEEDBACK_RECENT_ERRORS_MAX).map((e) => e.slice(0, FEEDBACK_RECENT_ERROR_CHARS)),
    ),
});
export const FeedbackCreateResponseSchema = z.object({
  id: z.string(),
  status: FeedbackStatusSchema,
  created_at: z.string(),
});

export const AdminFeedbackItemSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_email: z.string(),
  user_name: z.string(),
  session_id: z.string(),
  category: FeedbackCategorySchema,
  message: z.string(),
  route: z.string(),
  book_id: z.string().nullable(),
  book_title: z.string().nullable(),
  user_agent: z.string().nullable(),
  viewport_width: z.number(),
  viewport_height: z.number(),
  theme: z.enum(['light', 'dark']),
  client_build: z.string().nullable(),
  server_build: z.string().nullable(),
  recent_errors: z.array(z.string()),
  status: FeedbackStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export const AdminFeedbackListResponseSchema = z.array(AdminFeedbackItemSchema);
export const AdminFeedbackListQuerySchema = z.object({
  status: FeedbackStatusSchema.optional(),
  user_id: z.string().max(64).optional(),
});
export const AdminFeedbackStatusRequestSchema = z.object({ status: FeedbackStatusSchema });
export const AdminFeedbackStatusResponseSchema = AdminFeedbackItemSchema;

export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;
export type FeedbackCreateRequest = z.infer<typeof FeedbackCreateRequestSchema>;
export type FeedbackCreateResponse = z.infer<typeof FeedbackCreateResponseSchema>;
export type AdminFeedbackItem = z.infer<typeof AdminFeedbackItemSchema>;
export type AdminFeedbackListResponse = z.infer<typeof AdminFeedbackListResponseSchema>;
export type AdminFeedbackListQuery = z.infer<typeof AdminFeedbackListQuerySchema>;
export type AdminFeedbackStatusRequest = z.infer<typeof AdminFeedbackStatusRequestSchema>;
export type AdminFeedbackStatusResponse = z.infer<typeof AdminFeedbackStatusResponseSchema>;
