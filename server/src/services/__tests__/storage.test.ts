import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock the S3 client: no network, no credentials. Each Command records its
// input; S3Client.send dispatches to a per-test handler.
const send = vi.fn();
const clientConfigs: unknown[] = [];

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      constructor(config: unknown) {
        clientConfigs.push(config);
      }
      send = send;
    },
    PutObjectCommand: class PutObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    HeadObjectCommand: class HeadObjectCommand extends Command {},
    ListObjectsV2Command: class ListObjectsV2Command extends Command {},
    DeleteObjectsCommand: class DeleteObjectsCommand extends Command {},
  };
});

const {
  LocalStorage,
  R2Storage,
  getStorage,
  __resetStorageForTests,
  assertValidKey,
  isValidKey,
  readR2Config,
  resolveBackendName,
  ILLUSTRATIONS_DIR,
} = await import('../storage');

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

function notFound(name = 'NotFound') {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
}

const R2_ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_BUCKET: 'storybook-art',
  R2_ACCESS_KEY_ID: 'AKIA-test',
  R2_SECRET_ACCESS_KEY: 'super-secret-value',
  R2_PUBLIC_BASE_URL: 'https://pub-abc.r2.dev/',
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'storage-test-'));
  send.mockReset();
  clientConfigs.length = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  __resetStorageForTests();
});

describe('key validation', () => {
  it('accepts the stored-path shape', () => {
    expect(isValidKey('b2fa23cf/page-4-v2.png')).toBe(true);
    expect(isValidKey('b2fa23cf/')).toBe(true);
  });

  it.each(['../etc/passwd', 'abc/../../x', '..', '/abs/path.png', 'a\\b.png', 'a\0b', '', '.', './', 'a/./b.png'])(
    'rejects %j',
    key => {
      expect(isValidKey(key)).toBe(false);
      expect(() => assertValidKey(key)).toThrow(/Invalid storage key/);
    },
  );

  it('every backend operation refuses an invalid key before touching storage', async () => {
    const local = new LocalStorage(root);
    await expect(local.get('../secret')).rejects.toThrow(/Invalid storage key/);
    await expect(local.put('/abs.png', Buffer.from('x'), 'image/png')).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(local.remove('')).rejects.toThrow(/Invalid storage key/);

    const r2 = new R2Storage(readR2Config(R2_ENV), local);
    await expect(r2.head('a\\b')).rejects.toThrow(/Invalid storage key/);
    await expect(r2.list('../')).rejects.toThrow(/Invalid storage key/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('LocalStorage', () => {
  it('put writes the bytes under <root>/<key>, creating the book directory', async () => {
    const local = new LocalStorage(root);
    await local.put('book1/page-1.png', Buffer.from('png-bytes'), 'image/png');
    expect(await readFile(join(root, 'book1/page-1.png'), 'utf8')).toBe('png-bytes');
    expect((await local.get('book1/page-1.png')).toString()).toBe('png-bytes');
  });

  it('get throws when absent', async () => {
    await expect(new LocalStorage(root).get('book1/nope.png')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('head returns size + mtime, and null for a missing key or a directory', async () => {
    const local = new LocalStorage(root);
    await local.put('book1/page-1.png', Buffer.from('12345'), 'image/png');
    const when = new Date('2025-01-02T03:04:05Z');
    await utimes(join(root, 'book1/page-1.png'), when, when);

    expect(await local.head('book1/page-1.png')).toEqual({ size: 5, lastModified: when });
    expect(await local.head('book1/missing.png')).toBeNull();
    expect(await local.head('nobook/missing.png')).toBeNull();
    expect(await local.head('book1')).toBeNull();
  });

  it('list returns keys with lastModified equal to the file mtime', async () => {
    const local = new LocalStorage(root);
    await local.put('book1/page-1.png', Buffer.from('a'), 'image/png');
    await local.put('book1/page-1-v2.png', Buffer.from('b'), 'image/png');
    await local.put('book2/page-1.png', Buffer.from('c'), 'image/png');
    const when = new Date('2024-06-01T00:00:00Z');
    await utimes(join(root, 'book1/page-1.png'), when, when);

    const book1 = await local.list('book1/');
    expect(book1.map(o => o.key).sort()).toEqual(['book1/page-1-v2.png', 'book1/page-1.png']);
    const first = book1.find(o => o.key === 'book1/page-1.png')!;
    expect(first.lastModified.getTime()).toBe(when.getTime());

    expect((await local.list('')).map(o => o.key).sort()).toEqual([
      'book1/page-1-v2.png',
      'book1/page-1.png',
      'book2/page-1.png',
    ]);
    expect((await local.list('book1/page-1-')).map(o => o.key)).toEqual(['book1/page-1-v2.png']);
  });

  it('list of a missing prefix or missing root is empty, not an error', async () => {
    expect(await new LocalStorage(root).list('ghost/')).toEqual([]);
    expect(await new LocalStorage(join(root, 'does-not-exist')).list('')).toEqual([]);
  });

  it('remove of a directory prefix drops the tree; a file prefix drops only matches', async () => {
    const local = new LocalStorage(root);
    await local.put('book1/page-1.png', Buffer.from('a'), 'image/png');
    await local.put('book1/page-2.png', Buffer.from('b'), 'image/png');
    await local.put('book10/page-1.png', Buffer.from('c'), 'image/png');

    await local.remove('book1/page-1');
    expect((await local.list('book1/')).map(o => o.key)).toEqual(['book1/page-2.png']);

    await local.remove('book1/');
    await expect(stat(join(root, 'book1'))).rejects.toMatchObject({ code: 'ENOENT' });
    // A sibling whose id shares the prefix is untouched.
    expect(await local.head('book10/page-1.png')).not.toBeNull();
  });
});

describe('R2 config', () => {
  it('names every missing variable and never echoes a value', () => {
    const env = { ...R2_ENV, R2_BUCKET: '', R2_ACCESS_KEY_ID: undefined };
    let message = '';
    try {
      readR2Config(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('R2_BUCKET');
    expect(message).toContain('R2_ACCESS_KEY_ID');
    expect(message).not.toContain('R2_SECRET_ACCESS_KEY');
    expect(message).not.toContain(R2_ENV.R2_SECRET_ACCESS_KEY);
    expect(message).not.toContain(R2_ENV.R2_ACCOUNT_ID);
  });

  it('strips a trailing slash from the public base URL', () => {
    expect(readR2Config(R2_ENV).publicBaseUrl).toBe('https://pub-abc.r2.dev');
  });

  it('builds the client against the account endpoint in region auto', () => {
    new R2Storage(readR2Config(R2_ENV), new LocalStorage(root));
    expect(clientConfigs[0]).toMatchObject({
      region: 'auto',
      endpoint: 'https://acct123.r2.cloudflarestorage.com',
      credentials: { accessKeyId: 'AKIA-test', secretAccessKey: 'super-secret-value' },
    });
  });
});

describe('R2Storage', () => {
  function r2() {
    return new R2Storage(readR2Config(R2_ENV), new LocalStorage(root));
  }
  const lastCmd = () => send.mock.calls.at(-1)![0] as Cmd;

  it('put sends the key verbatim (no /illustrations/ prefix) with the content type', async () => {
    send.mockResolvedValue({});
    await r2().put('book1/page-4-v2.png', Buffer.from('x'), 'image/png');
    const cmd = lastCmd();
    expect(cmd.constructor.name).toBe('PutObjectCommand');
    expect(cmd.input).toMatchObject({
      Bucket: 'storybook-art',
      Key: 'book1/page-4-v2.png',
      ContentType: 'image/png',
    });
  });

  it('get returns R2 bytes on a hit', async () => {
    send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('remote')) },
    });
    expect((await r2().get('book1/page-1.png')).toString()).toBe('remote');
    expect(lastCmd().input).toMatchObject({ Bucket: 'storybook-art', Key: 'book1/page-1.png' });
  });

  it('get falls back to local disk on an R2 miss', async () => {
    await new LocalStorage(root).put('book1/page-1.png', Buffer.from('local'), 'image/png');
    send.mockRejectedValue(notFound('NoSuchKey'));
    expect((await r2().get('book1/page-1.png')).toString()).toBe('local');
  });

  it('get throws when absent from both', async () => {
    send.mockRejectedValue(notFound('NoSuchKey'));
    await expect(r2().get('book1/page-1.png')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('get propagates a non-404 R2 error instead of masking it with local', async () => {
    await new LocalStorage(root).put('book1/page-1.png', Buffer.from('local'), 'image/png');
    send.mockRejectedValue(Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }));
    await expect(r2().get('book1/page-1.png')).rejects.toThrow('boom');
  });

  it('head returns R2 metadata on a hit', async () => {
    const when = new Date('2026-01-01T00:00:00Z');
    send.mockResolvedValue({ ContentLength: 42, LastModified: when });
    expect(await r2().head('book1/page-1.png')).toEqual({ size: 42, lastModified: when });
    expect(lastCmd().constructor.name).toBe('HeadObjectCommand');
  });

  it('head returns null (does not throw) on a 404 missing from both', async () => {
    send.mockRejectedValue(notFound());
    await expect(r2().head('book1/page-1.png')).resolves.toBeNull();
  });

  it('head falls back to local disk on an R2 miss', async () => {
    await new LocalStorage(root).put('book1/page-1.png', Buffer.from('abc'), 'image/png');
    send.mockRejectedValue(notFound());
    expect(await r2().head('book1/page-1.png')).toMatchObject({ size: 3 });
  });

  it('list merges R2 and local, deduped by key with R2 winning, and pages', async () => {
    const local = new LocalStorage(root);
    await local.put('book1/page-1.png', Buffer.from('a'), 'image/png'); // also in R2
    await local.put('book1/page-2.png', Buffer.from('b'), 'image/png'); // local only

    const r2When = new Date('2026-03-03T00:00:00Z');
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'book1/page-1.png', LastModified: r2When }],
        IsTruncated: true,
        NextContinuationToken: 'tok',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'book1/page-1-v2.png', LastModified: r2When }],
        IsTruncated: false,
      });

    const result = await r2().list('book1/');
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'storybook-art', Prefix: 'book1/' });
    expect(send.mock.calls[1][0].input).toMatchObject({ ContinuationToken: 'tok' });

    const byKey = Object.fromEntries(result.map(o => [o.key, o.lastModified]));
    expect(Object.keys(byKey).sort()).toEqual([
      'book1/page-1-v2.png',
      'book1/page-1.png',
      'book1/page-2.png',
    ]);
    expect(byKey['book1/page-1.png'].getTime()).toBe(r2When.getTime());
  });

  it('list propagates an R2 error rather than returning a silent []', async () => {
    send.mockRejectedValue(new Error('network down'));
    await expect(r2().list('book1/')).rejects.toThrow('network down');
  });

  it('remove deletes the R2 keys under the prefix and the local copy', async () => {
    await new LocalStorage(root).put('book1/page-1.png', Buffer.from('a'), 'image/png');
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'book1/page-1.png' }, { Key: 'book1/page-2.png' }] })
      .mockResolvedValueOnce({});

    await r2().remove('book1/');
    const del = send.mock.calls[1][0] as Cmd;
    expect(del.constructor.name).toBe('DeleteObjectsCommand');
    expect(del.input).toMatchObject({
      Bucket: 'storybook-art',
      Delete: { Objects: [{ Key: 'book1/page-1.png' }, { Key: 'book1/page-2.png' }] },
    });
    await expect(stat(join(root, 'book1'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('getStorage', () => {
  it('defaults to the local backend at public/illustrations with no env set', async () => {
    vi.stubEnv('STORAGE_BACKEND', '');
    expect(resolveBackendName()).toBe('local');
    const storage = getStorage();
    expect(storage).toBeInstanceOf(LocalStorage);
    expect(getStorage()).toBe(storage); // memoized

    // Round-trips through the real directory every existing test uses.
    const key = `storage-test-${Date.now()}/probe.png`;
    try {
      await storage.put(key, Buffer.from('probe'), 'image/png');
      expect(await readFile(join(ILLUSTRATIONS_DIR, key), 'utf8')).toBe('probe');
    } finally {
      await storage.remove(`${key.split('/')[0]}/`);
    }
  });

  it('selects R2 when STORAGE_BACKEND=r2, after a reset', () => {
    expect(getStorage()).toBeInstanceOf(LocalStorage);
    for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('STORAGE_BACKEND', 'r2');
    __resetStorageForTests();
    expect(getStorage()).toBeInstanceOf(R2Storage);
  });

  it('fails loudly on R2 with missing config, naming the variable', () => {
    vi.stubEnv('STORAGE_BACKEND', 'r2');
    for (const k of Object.keys(R2_ENV)) vi.stubEnv(k, '');
    expect(() => getStorage()).toThrow(/R2_ACCOUNT_ID/);
  });

  it('rejects an unknown backend name instead of silently using local', () => {
    vi.stubEnv('STORAGE_BACKEND', 's3');
    expect(() => getStorage()).toThrow(/STORAGE_BACKEND/);
  });
});
