import { spawnSync } from 'node:child_process';

export type HookResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/**
 * Spawn a hook script with the standard Claude Code hook protocol:
 * stdin receives JSON, exit code 0 = allow, exit code 2 = block.
 *
 * Uses `bash` from PATH — on Windows this resolves to Git Bash.
 */
export function runHook(
  scriptPath: string,
  toolInput: Record<string, unknown>,
  options: { source?: string; env?: Record<string, string> } = {},
): HookResult {
  const payload: Record<string, unknown> = { tool_input: toolInput };
  if (options.source !== undefined) payload.source = options.source;

  const result = spawnSync('bash', [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });

  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
