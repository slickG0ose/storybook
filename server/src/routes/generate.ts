import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/requireAuth';
import { STORY_MODEL, STORY_THINKING } from '../lib/models';
import { spendGate } from '../middleware/spendGate';
import { recordUsage, checkQuota } from '../services/spend';
import {
  generateCover,
  generateIllustration,
  collectRequiredPortraitRefs,
  isImageGenConfigured,
} from '../services/illustrations';
import { currentImagePin, ensureBookPinned } from '../services/imagePin';
import { parseAiJson } from '../services/parseAiJson';
import type { Request, Response } from 'express';
import type { Character, CharacterRole } from '../types';

type PreviewMode = 'quick' | 'cover' | 'full';
const VALID_PREVIEW_MODES: PreviewMode[] = ['quick', 'cover', 'full'];

interface GenerateRequestBody {
  theme: string;
  ageRange: string;
  additionalDetails?: string;
  characterName?: string;
  characters?: Character[];
  styleDescriptor?: string;
  styleReferenceUrl?: string;
  previewMode?: PreviewMode;
  pageCount?: number;
}

const MIN_PAGES = 3;
const MAX_PAGES = 15;
const DEFAULT_PAGES = 5;

function normalizePageCount(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_PAGES;
  const n = Math.round(raw);
  if (n < MIN_PAGES) return MIN_PAGES;
  if (n > MAX_PAGES) return MAX_PAGES;
  return n;
}

interface GeneratedStory {
  title: string;
  description: string;
  coverEmoji: string;
  coverColor: string;
  coverDescription: string;
  pages: {
    text: string;
    illustrationDescription: string;
  }[];
}

const VALID_ROLES: CharacterRole[] = ['primary', 'antagonist', 'supporting'];

function normalizeCharacters(body: GenerateRequestBody): Character[] {
  if (Array.isArray(body.characters) && body.characters.length > 0) {
    return body.characters
      .filter(c => c && typeof c.name === 'string' && c.name.trim() && VALID_ROLES.includes(c.role))
      .map(c => ({
        role: c.role,
        name: c.name.trim(),
        descriptor: c.descriptor?.trim() || undefined,
        relationship: c.relationship?.trim() || undefined,
      }));
  }
  if (body.characterName?.trim()) {
    return [{ role: 'primary', name: body.characterName.trim() }];
  }
  return [];
}

function formatCastForPrompt(characters: Character[]): string {
  const groups: Record<CharacterRole, Character[]> = { primary: [], antagonist: [], supporting: [] };
  for (const c of characters) groups[c.role].push(c);

  const lines: string[] = [];
  if (groups.primary.length > 0) {
    lines.push(`Primary character: ${groups.primary.map(formatCharacter).join('; ')}`);
  }
  if (groups.antagonist.length > 0) {
    lines.push(`Antagonist${groups.antagonist.length > 1 ? 's' : ''}: ${groups.antagonist.map(formatCharacter).join('; ')}`);
  }
  if (groups.supporting.length > 0) {
    lines.push(`Supporting cast: ${groups.supporting.map(formatCharacter).join('; ')}`);
  }
  return lines.join('\n');
}

function formatCharacter(c: Character): string {
  const parts = [c.name];
  if (c.relationship) parts.push(`(${c.relationship})`);
  if (c.descriptor) parts.push(`— ${c.descriptor}`);
  return parts.join(' ');
}

const router = Router();

// requireAuth runs BEFORE the handler on purpose. This route bills the
// project's own Anthropic key (and, in cover/full preview modes, the image
// provider) — and it does so before it ever touches the database, so an
// anonymous request costs real money even when the DB is unreachable. It was
// previously ungated on a public deployment; see #5/#6 for the allowlist and
// spend-ceiling layers that sit on top of this gate.
router.post('/', requireAuth, spendGate('story'), async (req: Request, res: Response) => {
  const body = req.body as GenerateRequestBody;
  const { theme, ageRange, additionalDetails, styleDescriptor, styleReferenceUrl } = body;
  const previewMode: PreviewMode = body.previewMode && VALID_PREVIEW_MODES.includes(body.previewMode)
    ? body.previewMode
    : 'quick';
  const pageCount = normalizePageCount(body.pageCount);

  const characters = normalizeCharacters(body);
  const primary = characters.find(c => c.role === 'primary');

  if (!theme || !ageRange || !primary) {
    return res.status(400).json({ error: 'theme, ageRange, and at least one primary character are required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const client = new Anthropic({ apiKey });

    const prompt = `You are a beloved children's book author. Create a children's story with exactly ${pageCount} pages.

Theme: ${theme}
Target age range: ${ageRange}
${formatCastForPrompt(characters)}
${additionalDetails ? `Additional details: ${additionalDetails}` : ''}

Use every character listed above. The primary character is the protagonist. Antagonists provide conflict that gets resolved by the end. Supporting characters should appear at least once with their relationship to the primary character reflected in the story.

Pace the story across exactly ${pageCount} pages: page 1 introduces the world and primary character, the middle pages develop the conflict, and the final page resolves it. Longer stories can take more time on details and side beats; shorter stories should move quickly.

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "title": "The story title",
  "description": "A 1-2 sentence book description for the catalog",
  "coverEmoji": "A single emoji that represents this story",
  "coverColor": "A hex color that fits the story mood (choose from: #7c3aed, #0891b2, #dc2626, #16a34a, #f59e0b, #ec4899, #6366f1, #0d9488)",
  "coverDescription": "1-2 sentence vivid description of the cover scene (centered subject, room above for the title, captures the spirit of the story)",
  "pages": [
    {
      "text": "The story text for this page (2-4 sentences, age-appropriate language)",
      "illustrationDescription": "A detailed description of the illustration for this page"
    }
  ]
}

Make the story warm, engaging, and age-appropriate. Use vivid but simple language. Each page should advance the story and paint a picture. The story should have a satisfying, positive ending.`;

    const message = await client.messages.create({
      model: STORY_MODEL,
      // Sonnet 5 runs adaptive thinking when this is omitted, and max_tokens
      // caps thinking + response text together — omitting it would truncate
      // stories. See server/src/lib/models.ts.
      thinking: STORY_THINKING,
      max_tokens: Math.max(2000, pageCount * 500),
      messages: [{ role: 'user', content: prompt }],
    });

    const firstBlock = message.content[0];
    if (firstBlock.type !== 'text') {
      throw new Error('Unexpected response type from AI');
    }
    const content: string = firstBlock.text;

    const story = parseAiJson(content) as GeneratedStory;

    // requireAuth guarantees this is populated.
    const user = res.locals.user as { id: string; name: string; role?: string };
    const isAdmin = user.role === 'admin';

    // The story call has now completed, so charge it. Recorded after the fact
    // so a failed Claude call doesn't consume quota.
    await recordUsage(user.id, 'story');

    let book = await prisma.book.create({
      data: {
        title: story.title,
        author: user.name,
        description: story.description,
        theme,
        age_range: ageRange,
        cover_emoji: story.coverEmoji,
        cover_color: story.coverColor,
        price: 24.99,
        is_featured: false,
        is_user_created: true,
        // Always 'draft' now that the route requires auth. The old
        // `user ? 'draft' : 'published'` meant an anonymous generate landed
        // straight in the public catalog with no owner who could unpublish it.
        status: 'draft',
        version: 1,
        characters_json: JSON.stringify(characters),
        style_descriptor: styleDescriptor?.trim() || null,
        style_reference_url: styleReferenceUrl?.trim() || null,
        created_by: user.id,
        pages: {
          create: story.pages.map((page, i) => ({
            page_number: i + 1,
            text: page.text,
            illustration_description: page.illustrationDescription,
          })),
        },
        versions: {
          create: {
            version: 1,
            // Persist page_number explicitly so this snapshot matches the
            // BookVersionPageSchema wire shape. story.pages comes from Claude
            // without page_number — derive it from array index. Read sites
            // also synth from index as a fallback, but writing it here keeps
            // new snapshots forward-consistent.
            pages_json: JSON.stringify(
              story.pages.map((p, i) => ({
                page_number: i + 1,
                text: p.text,
                illustrationDescription: p.illustrationDescription,
              })),
            ),
          },
        },
      },
      include: { pages: { orderBy: { page_number: 'asc' } } },
    });

    // IV2 Phase 2: at creation time portraits don't exist yet (they're generated
    // later on the draft Cast panel), so this is empty here and the cover/page
    // generation stays on the byte-identical prompt-only path. Threaded for
    // consistency with /illustrate and so a re-illustrate after portraits exist
    // would pick them up. collectRequiredPortraitRefs returns [] -> undefined.
    const portraitRefs = collectRequiredPortraitRefs(characters);
    const referenceImages = portraitRefs.length > 0 ? portraitRefs : undefined;

    // A brand-new book has no art, so its pin is simply today's environment
    // default. It is written on the FIRST successful image (cover or page),
    // never at row-create time: the pin must describe art that exists, not an
    // intention. A book created with previewMode 'text' today and illustrated
    // months from now should pin to the provider that actually draws it — see
    // the "Pin at book-creation time" alternative in the spec, rejected for
    // exactly that reason.
    const pin = currentImagePin();
    let pinned = false;

    // Each image is a separate paid call, so each is separately gated. The
    // spendGate middleware only reserved the story; without these checks a
    // single previewMode:'full' request could blow past the ceiling by 16x.
    let quotaExhausted = false;

    if ((previewMode === 'cover' || previewMode === 'full') && isImageGenConfigured(pin.provider)) {
      const coverDecision = await checkQuota(user.id, 'cover', isAdmin, new Date(), pin.provider);
      if (!coverDecision.allowed) {
        quotaExhausted = true;
      } else {
      const coverUrl = await generateCover(
        book.id,
        story.title,
        story.coverDescription || story.description,
        styleDescriptor,
        characters,
        referenceImages,
        { pin },
      );
      if (coverUrl) {
        await recordUsage(user.id, 'cover', pin.provider);
        // Fold the pin into the update that persists the cover, so the returned
        // body carries the real pin rather than a stale null.
        book = await prisma.book.update({
          where: { id: book.id },
          data: { cover_url: coverUrl, image_provider: pin.provider, image_model: pin.model },
          include: { pages: { orderBy: { page_number: 'asc' } } },
        });
        pinned = true;
      }
      }
    }

    if (previewMode === 'full' && isImageGenConfigured(pin.provider) && !quotaExhausted) {
      for (const page of book.pages) {
        const pageDecision = await checkQuota(user.id, 'illustration', isAdmin, new Date(), pin.provider);
        if (!pageDecision.allowed) {
          // Partial result rather than a hard failure: the user keeps the
          // story and whatever images were generated. Surfaced via
          // quotaHitAfterPage below so the client can explain the gap.
          quotaExhausted = true;
          break;
        }
        const url = await generateIllustration(
          book.id,
          page.page_number,
          page.illustration_description,
          undefined,
          styleDescriptor,
          characters,
          referenceImages,
          { pin },
        );
        if (url) {
          await recordUsage(user.id, 'illustration', pin.provider);
          // First successful image for this book (the cover may have failed or
          // been skipped) — record what drew it. Idempotent, so the second page
          // through here is a no-op.
          if (!pinned) {
            await ensureBookPinned(book.id, pin);
            pinned = true;
          }
          await prisma.page.update({ where: { id: page.id }, data: { illustration_url: url } });
        }
      }
      const refreshed = await prisma.book.findUnique({
        where: { id: book.id },
        include: { pages: { orderBy: { page_number: 'asc' } } },
      });
      if (refreshed) book = refreshed;
    }

    res.json({ ...book, characters, ...(quotaExhausted ? { quotaExhausted: true } : {}) });
  } catch (err: unknown) {
    console.error('Generation error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to generate story. ' + message });
  }
});

export default router;
