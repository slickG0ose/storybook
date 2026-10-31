import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

// The storage seam for illustration bytes (ADR-025). Every read, write, list,
// and delete against public/illustrations goes through getStorage(); nothing
// else should import fs/promises for an illustration path.
//
// KEYS are the stored web path minus "/illustrations/": `<bookId>/page-4-v2.png`.
// Page.illustration_url values never change shape — the mapping from web path
// to bytes is the serving layer's job, not the database's.
//
// Backends, chosen by STORAGE_BACKEND (default `local`):
//   - local: today's exact fs/promises calls against server/public/illustrations.
//   - r2:    Cloudflare R2 over the S3 API. get/head/list FALL BACK TO LOCAL DISK
//            on a miss, because the fixture book ships committed PNGs inside the
//            deploy bundle that are never uploaded (ADR-025 §Why).

export interface StoredObject {
  key: string;
  lastModified: Date;
}

export interface StorageBackend {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Throws when the key is absent. */
  get(key: string): Promise<Buffer>;
  /** Null when the key is absent. */
  head(key: string): Promise<{ size: number; lastModified: Date } | null>;
  /** Every object whose key starts with `prefix`; '' lists everything. */
  list(prefix: string): Promise<StoredObject[]>;
  /**
   * Deletes every object whose key starts with `prefix`. Empty prefix is
   * refused. It is a PREFIX match: to delete one book, pass `<bookId>/` — a
   * bare `<bookId>` would also match any book id that begins with it.
   */
  remove(prefix: string): Promise<void>;
}

export const ILLUSTRATIONS_DIR = join(import.meta.dirname, '../../public/illustrations');

// ---------------------------------------------------------------------------
// Key validation — lives here and nowhere else. It is the path-traversal fence
// for the local backend and the key-shape guard for the admin orphan endpoint.
// ---------------------------------------------------------------------------

export function isValidKey(key: string): boolean {
  if (typeof key !== 'string' || key === '') return false;
  if (key.startsWith('/')) return false;
  if (key.includes('\\')) return false;
  if (key.includes('\0')) return false;
  if (key.includes('..')) return false;
  // A `.` segment resolves to its parent directory on disk: `./` would make
  // LocalStorage.remove() target the illustrations root itself.
  if (key.split('/').some(segment => segment === '.')) return false;
  return true;
}

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key)}`);
    this.name = 'InvalidStorageKeyError';
  }
}

export function assertValidKey(key: string): void {
  if (!isValidKey(key)) throw new InvalidStorageKeyError(key);
}

// list('') is legitimate (enumerate everything); every other prefix obeys the
// key rules.
function assertValidPrefix(prefix: string): void {
  if (prefix === '') return;
  assertValidKey(prefix);
}

function isMissingFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

// ---------------------------------------------------------------------------
// Local disk
// ---------------------------------------------------------------------------

// Containment fence, independent of isValidKey: every fs path below is
// resolve()d against the (resolve()d) root and must land strictly inside it.
// isValidKey already rejects every escape shape we know of; this still holds
// if that list ever regresses. The check is written out at each fs call rather
// than in a helper on purpose: CodeQL's js/path-injection only credits a
// startsWith guard in the same function as the sink, and a helper got the PR's
// CodeQL gate flagged (alerts 24-26, 28).
export class LocalStorage implements StorageBackend {
  private readonly root: string;

  constructor(root: string = ILLUSTRATIONS_DIR) {
    this.root = resolve(root);
  }

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    assertValidKey(key);
    const abs = resolve(this.root, key);
    if (!abs.startsWith(this.root + sep)) throw new InvalidStorageKeyError(key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }

  async get(key: string): Promise<Buffer> {
    assertValidKey(key);
    const abs = resolve(this.root, key);
    if (!abs.startsWith(this.root + sep)) throw new InvalidStorageKeyError(key);
    return readFile(abs);
  }

  async head(key: string): Promise<{ size: number; lastModified: Date } | null> {
    assertValidKey(key);
    const abs = resolve(this.root, key);
    if (!abs.startsWith(this.root + sep)) throw new InvalidStorageKeyError(key);
    try {
      const s = await stat(abs);
      if (!s.isFile()) return null;
      return { size: s.size, lastModified: s.mtime };
    } catch (err) {
      if (isMissingFsError(err)) return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    assertValidPrefix(prefix);
    // Walk from the deepest directory the prefix fully names, then filter by
    // the full prefix — so `abc/` walks abc/, and `abc/page-` walks abc/ too.
    const slash = prefix.lastIndexOf('/');
    const baseKey = slash === -1 ? '' : prefix.slice(0, slash + 1);
    const out: StoredObject[] = [];
    await this.walk(baseKey, out);
    return out.filter(o => o.key.startsWith(prefix));
  }

  // dirKey is '' (the root itself — the only place the root is reachable) or a
  // `<dir>/` key.
  private async walk(dirKey: string, out: StoredObject[]): Promise<void> {
    let dir = this.root;
    if (dirKey !== '') {
      const abs = resolve(this.root, dirKey);
      if (!abs.startsWith(this.root + sep)) throw new InvalidStorageKeyError(dirKey);
      dir = abs;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isMissingFsError(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const key = `${dirKey}${entry.name}`;
      if (entry.isDirectory()) {
        await this.walk(`${key}/`, out);
      } else if (entry.isFile()) {
        const abs = resolve(this.root, key);
        if (!abs.startsWith(this.root + sep)) throw new InvalidStorageKeyError(key);
        try {
          const s = await stat(abs);
          out.push({ key, lastModified: s.mtime });
        } catch (err) {
          // Deleted between readdir and stat — it is simply not there.
          if (!isMissingFsError(err)) throw err;
        }
      }
    }
  }

  async remove(prefix: string): Promise<void> {
    assertValidKey(prefix);
    if (prefix.endsWith('/')) {
      // Directory-shaped prefix (`<bookId>/`): drop the whole tree, including
      // the now-empty directory itself. Never the root: `startsWith(root + sep)`
      // is false for the root.
      const abs = resolve(this.root, prefix.slice(0, -1));
      if (!abs.startsWith(this.root + sep)) throw new InvalidStorageKeyError(prefix);
      await rm(abs, { recursive: true, force: true });
      return;
    }
    for (const obj of await this.list(prefix)) {
      const abs = resolve(this.root, obj.key);
      if (!abs.startsWith(this.root + sep)) throw new InvalidStorageKeyError(obj.key);
      await rm(abs, { force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Cloudflare R2 (S3 API)
// ---------------------------------------------------------------------------

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** No trailing slash. */
  publicBaseUrl: string;
}

const R2_REQUIRED_VARS = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BASE_URL',
] as const;

// Reads and validates the R2 env. Errors name the VARIABLE, never a value —
// this message can reach a log line, and R2_SECRET_ACCESS_KEY must not.
export function readR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const missing = R2_REQUIRED_VARS.filter(name => !env[name] || env[name]!.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `STORAGE_BACKEND=r2 requires ${missing.join(', ')} to be set (missing or blank).`,
    );
  }
  // Without a scheme every redirect Location becomes a relative path on our own
  // host and all R2 art 404s silently. Naming the var only, as above.
  if (!/^https:\/\//i.test(env.R2_PUBLIC_BASE_URL!.trim())) {
    throw new Error('R2_PUBLIC_BASE_URL must be an absolute https:// URL (e.g. https://pub-<hash>.r2.dev).');
  }
  return {
    accountId: env.R2_ACCOUNT_ID!.trim(),
    bucket: env.R2_BUCKET!.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
    publicBaseUrl: env.R2_PUBLIC_BASE_URL!.trim().replace(/\/+$/, ''),
  };
}

function isS3NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!e) return false;
  return (
    e.name === 'NotFound' ||
    e.name === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  );
}

export class R2Storage implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    config: R2Config,
    private readonly fallback: StorageBackend = new LocalStorage(),
  ) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new Error(`R2 returned an empty body for key ${key}`);
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (!isS3NotFound(err)) throw err;
    }
    // R2 miss -> local disk. If that misses too, its ENOENT propagates, which
    // is the same error the local backend throws.
    return this.fallback.get(key);
  }

  async head(key: string): Promise<{ size: number; lastModified: Date } | null> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: res.ContentLength ?? 0,
        lastModified: res.LastModified ?? new Date(0),
      };
    } catch (err) {
      if (!isS3NotFound(err)) throw err;
    }
    return this.fallback.head(key);
  }

  // Merges R2 with local disk, deduped by key, R2 winning. An R2 error is
  // thrown, never swallowed into [] — list() backs version numbering, and a
  // silent empty listing would make a regenerate overwrite v2 (ADR-027).
  async list(prefix: string): Promise<StoredObject[]> {
    assertValidPrefix(prefix);
    const remote = await this.listRemote(prefix);
    const byKey = new Map<string, StoredObject>();
    for (const obj of await this.fallback.list(prefix)) byKey.set(obj.key, obj);
    for (const obj of remote) byKey.set(obj.key, obj);
    return [...byKey.values()];
  }

  private async listRemote(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix || undefined,
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        out.push({ key: obj.Key, lastModified: obj.LastModified ?? new Date(0) });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  // Removes from BOTH sources. list() merges both, so leaving the local copy
  // behind would keep an "orphan" visible forever after an admin deleted it.
  async remove(prefix: string): Promise<void> {
    assertValidKey(prefix);
    const keys = (await this.listRemote(prefix)).map(o => o.key);
    // DeleteObjects accepts at most 1,000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
        }),
      );
    }
    await this.fallback.remove(prefix);
  }
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

export type StorageBackendName = 'local' | 'r2';

export function resolveBackendName(env: NodeJS.ProcessEnv = process.env): StorageBackendName {
  const raw = (env.STORAGE_BACKEND ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'local') return 'local';
  if (raw === 'r2') return 'r2';
  // Refuse rather than silently defaulting: a typo that quietly selects local
  // disk in production loses every image on the next spin-down.
  throw new Error(`STORAGE_BACKEND must be "local" or "r2" (got ${JSON.stringify(raw)}).`);
}

let memo: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (!memo) {
    memo = resolveBackendName() === 'r2' ? new R2Storage(readR2Config()) : new LocalStorage();
  }
  return memo;
}

/** Test-only: drop the memoized backend so the next getStorage() re-reads env. */
export function __resetStorageForTests(): void {
  memo = null;
}
