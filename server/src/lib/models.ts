/**
 * Claude model selection — one pin, one place.
 *
 * ## Why this is pinned and not auto-resolved
 *
 * There is no floating "latest Sonnet" alias. Model IDs are exact strings
 * (`claude-sonnet-5`, `claude-sonnet-4-6`); `claude-sonnet-latest` does not
 * exist and requesting it 404s.
 *
 * Resolving the newest Sonnet at runtime via the Models API *is* possible, and
 * it is deliberately not what we do. A model that changes under a running
 * deployment ships untested behavior on its own schedule, invalidates prompt
 * caches mid-conversation, and turns a provider release into a production
 * incident nobody deployed.
 *
 * Sonnet 5 is itself the argument: it runs adaptive thinking when `thinking`
 * is omitted, where Sonnet 4.6 ran without it. An auto-upgrade would have
 * silently started spending thinking tokens against a `max_tokens` that caps
 * thinking and response text *together* — quietly truncating stories
 * mid-generation. That is exactly the class of failure a pin prevents and a
 * resolver invites.
 *
 * So: pinned here, upgraded on purpose. Changing the model is a one-line edit
 * plus a test run, which is the amount of ceremony a model swap deserves.
 * `checkForNewerModel()` below reports newer options at startup so the pin
 * stays a decision rather than an oversight.
 */
import Anthropic from '@anthropic-ai/sdk';

/** The model used for story generation and revision. */
export const STORY_MODEL = 'claude-sonnet-5';

/**
 * Story generation asks for structured JSON from a well-specified prompt —
 * there is no multi-step reasoning to do, and thinking tokens would count
 * against the same `max_tokens` budget the story itself needs. Sonnet 5
 * enables adaptive thinking when this is omitted, so it must be explicit.
 */
export const STORY_THINKING = { type: 'disabled' } as const;

/**
 * Log a notice when a newer Sonnet is available. Advisory only — it never
 * changes the model in use. Best-effort: any failure is swallowed, because a
 * version check must not be able to break story generation.
 */
export async function checkForNewerModel(client: Anthropic): Promise<void> {
  try {
    const models = await client.models.list();
    const newer = models.data
      .map(m => m.id)
      .filter(id => id.startsWith('claude-sonnet-') && id > STORY_MODEL);

    if (newer.length > 0) {
      console.log(
        `[models] Newer Sonnet available: ${newer.join(', ')}. ` +
          `Currently pinned to ${STORY_MODEL}. Upgrading is a deliberate change — ` +
          `see server/src/lib/models.ts.`,
      );
    }
  } catch {
    // Advisory only; never surface as an error.
  }
}
