import { defineConfig } from 'vitest/config';

// Root vitest config — runs the .claude/ harness test suite only.
// Server, client, and e2e tests stay scoped to their workspace dirs
// (see CLAUDE.md "Testing" section). The harness suite validates the
// shape and behavior of .claude/agents, commands, skills, hooks, and
// settings.json.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['.claude/__tests__/**/*.test.ts'],
    testTimeout: 10000,
  },
});
