/**
 * Seed-book art generator (spec: seed-book-illustrations).
 *
 *   cd server && npx tsx scripts/generate-seed-art.ts [--spend] [--max-images N]
 *     [--redo <id>:<slot>]... [--compress-only] [--only <id>]...
 *
 * Without --spend this is a DRY RUN: it prints the plan and the cost and exits.
 * No network, no writes, no DB. With --spend it calls Fal (FAL_KEY, read from
 * server/.env or the repo-root .env by src/loadEnv.ts, or from the shell).
 * Spend metering (checkQuota/recordUsage) is deliberately not used: this is an
 * offline owner-run script with its own hard caps (spec §Spend gates).
 */
import '../src/loadEnv';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { rm, writeFile } from 'fs/promises';
import { CANONICAL_BOOKS, SEED_ART_PIN, SEED_BOOK_IDS, type SeedBookId } from '../src/seed/canonicalBooks';
import {
  SEED_ART_ABSOLUTE_MAX_IMAGES,
  SEED_ART_MANIFEST_PATH,
  cachePngPath,
  committedJpegPath,
  compressFromCache,
  mergeManifest,
  modelForJob,
  planCostCents,
  planSeedArt,
  runSeedArt,
  slotName,
  stagedPortraitPath,
  type SeedArtJob,
  type SeedArtManifestEntry,
  type SeedArtSlot,
} from '../src/seed/seedArt';
import { getImageGenerator, isImageGenConfigured } from '../src/services/illustrations';

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const out = { spend: false, compressOnly: false, maxImages: undefined as number | undefined, redo: [] as string[], only: [] as SeedBookId[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === '--spend') out.spend = true;
    else if (a === '--compress-only') out.compressOnly = true;
    else if (a === '--max-images') {
      const n = Number(next());
      if (!Number.isInteger(n) || n < 0) fail('--max-images must be a non-negative integer');
      out.maxImages = n;
    } else if (a === '--redo') out.redo.push(next());
    else if (a === '--only') {
      const id = next();
      if (!(SEED_BOOK_IDS as readonly string[]).includes(id)) fail(`--only: unknown book id "${id}"`);
      out.only.push(id as SeedBookId);
    } else fail(`unknown argument "${a}"`);
  }
  for (const r of out.redo) {
    const [id, slot] = r.split(':');
    if (!(SEED_BOOK_IDS as readonly string[]).includes(id) || !/^(cover|page-[1-5]|portrait-\d+)$/.test(slot ?? '')) {
      fail(`--redo "${r}" must look like <book-id>:<cover|page-N|portrait-100N>`);
    }
  }
  return out;
}

function sipsOrFail(): void {
  const r = spawnSync('sips', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.error('ERROR: `sips` was not found. Convert with the fallback instead (nothing is installed for you):');
    console.error('  npx -y sharp-cli -i server/.seed-art/<id>/<slot>.png -o server/public/illustrations/<id>/ -f jpeg --quality 82');
    process.exit(1);
  }
}

function sips(args: string[]): void {
  const r = spawnSync('sips', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sips failed: ${r.stderr || r.stdout}`);
}

const toJpeg = async (png: string, jpg: string) =>
  sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '--resampleHeightWidthMax', '1024', png, '--out', jpg]);
const toPng = async (jpg: string, png: string) => sips(['-s', 'format', 'png', jpg, '--out', png]);

function readManifest(): SeedArtManifestEntry[] {
  return existsSync(SEED_ART_MANIFEST_PATH)
    ? (JSON.parse(readFileSync(SEED_ART_MANIFEST_PATH, 'utf8')) as SeedArtManifestEntry[])
    : [];
}
const writeManifest = (entries: SeedArtManifestEntry[]) =>
  writeFile(SEED_ART_MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n');

function redoSlot(name: string): SeedArtSlot {
  if (name === 'cover') return { kind: 'cover' };
  const [kind, n] = name.split('-');
  return kind === 'page' ? { kind: 'page', page: Number(n) } : { kind: 'portrait', characterIndex: Number(n) - 1000 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const backend = process.env.STORAGE_BACKEND?.trim();
  if (backend && backend.toLowerCase() !== 'local') {
    fail(`STORAGE_BACKEND is "${backend}". This script writes to local disk only; unset it or set it to "local".`);
  }

  if (args.compressOnly) {
    sipsOrFail();
    const { converted, entries } = await compressFromCache(CANONICAL_BOOKS, readManifest(), { toJpeg });
    await writeManifest(entries);
    console.log(`Compressed ${converted} cached PNG(s) to JPEG. $0 spent.`);
    return;
  }

  const jobs = planSeedArt(CANONICAL_BOOKS, existsSync, { redo: args.redo, only: args.only.length ? args.only : undefined });
  const maxImages = args.maxImages ?? jobs.length;

  if (jobs.length > maxImages) fail(`${jobs.length} images planned but --max-images is ${maxImages}.`);
  if (jobs.length > SEED_ART_ABSOLUTE_MAX_IMAGES) {
    fail(`${jobs.length} images planned, above the hard cap of ${SEED_ART_ABSOLUTE_MAX_IMAGES}.`);
  }
  if (args.spend && !isImageGenConfigured('fal')) {
    fail('FAL_KEY is missing or blank. Set it in server/.env (or the shell) before using --spend.');
  }

  console.log(`${args.spend ? 'SPEND RUN' : 'DRY RUN'}: ${jobs.length} jobs`);
  for (const j of jobs) {
    console.log(`  ${j.bookId.padEnd(24)} ${slotName(j.slot).padEnd(14)} ${modelForJob(j)}  refs=${j.references.length}`);
  }
  const cents = planCostCents(jobs);
  console.log(`${jobs.length} images x 4c = $${(cents / 100).toFixed(2)}`);

  if (!args.spend) {
    console.log('Dry run only: no network, no writes. Re-run with --spend to generate.');
    return;
  }
  if (jobs.length === 0) {
    console.log('Nothing to generate.');
    return;
  }

  sipsOrFail();

  // A redo discards both the cache and the committed JPEG first, then the
  // planner's job (already in the list) regenerates it.
  for (const r of args.redo) {
    const [id, name] = r.split(':');
    const slot = redoSlot(name);
    await rm(cachePngPath(id, slot), { force: true });
    await rm(committedJpegPath(id, slot), { force: true });
    if (slot.kind === 'portrait') {
      await rm(stagedPortraitPath(id, slot.characterIndex), { force: true });
      console.warn(`WARNING: ${id} pages were drawn against the previous portrait; redo them too if they drift.`);
    }
  }

  const generator = getImageGenerator(SEED_ART_PIN);
  let manifest = readManifest();
  const done = await runSeedArt(jobs as SeedArtJob[], {
    generate: (prompt, references) => generator.generate(prompt, { referenceImages: references }),
    toJpeg,
    toPng,
    maxImages,
    onEntry: async (entry) => {
      manifest = mergeManifest(manifest, [entry]);
      await writeManifest(manifest);
      console.log(`  done ${entry.file} (${entry.bytes} bytes)`);
    },
  });
  console.log(`Generated ${done.length}/${jobs.length} image(s). Manifest: ${SEED_ART_MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
