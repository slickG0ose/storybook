import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../db/prisma';
import { getAuthUser } from './auth';
import { generateCover, generateIllustration } from '../services/illustrations';
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

router.post('/', async (req: Request, res: Response) => {
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
      model: 'claude-sonnet-4-6',
      max_tokens: Math.max(2000, pageCount * 500),
      messages: [{ role: 'user', content: prompt }],
    });

    const firstBlock = message.content[0];
    if (firstBlock.type !== 'text') {
      throw new Error('Unexpected response type from AI');
    }
    const content: string = firstBlock.text;

    const story = parseAiJson(content) as GeneratedStory;

    const user = await getAuthUser(req);

    let book = await prisma.book.create({
      data: {
        title: story.title,
        author: user ? user.name : 'AI Storybook',
        description: story.description,
        theme,
        age_range: ageRange,
        cover_emoji: story.coverEmoji,
        cover_color: story.coverColor,
        price: 24.99,
        is_featured: false,
        is_user_created: true,
        status: user ? 'draft' : 'published',
        version: 1,
        characters_json: JSON.stringify(characters),
        style_descriptor: styleDescriptor?.trim() || null,
        style_reference_url: styleReferenceUrl?.trim() || null,
        created_by: user?.id ?? null,
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

    if ((previewMode === 'cover' || previewMode === 'full') && process.env.OPENAI_API_KEY) {
      const coverUrl = await generateCover(
        book.id,
        story.title,
        story.coverDescription || story.description,
        styleDescriptor,
        characters,
      );
      if (coverUrl) {
        book = await prisma.book.update({
          where: { id: book.id },
          data: { cover_url: coverUrl },
          include: { pages: { orderBy: { page_number: 'asc' } } },
        });
      }
    }

    if (previewMode === 'full' && process.env.OPENAI_API_KEY) {
      for (const page of book.pages) {
        const url = await generateIllustration(
          book.id,
          page.page_number,
          page.illustration_description,
          undefined,
          styleDescriptor,
          characters,
        );
        if (url) {
          await prisma.page.update({ where: { id: page.id }, data: { illustration_url: url } });
        }
      }
      const refreshed = await prisma.book.findUnique({
        where: { id: book.id },
        include: { pages: { orderBy: { page_number: 'asc' } } },
      });
      if (refreshed) book = refreshed;
    }

    res.json({ ...book, characters });
  } catch (err: unknown) {
    console.error('Generation error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to generate story. ' + message });
  }
});

export default router;
