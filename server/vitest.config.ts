import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/**
 * Run test files in a fixed, alphabetical order (#97).
 *
 * Vitest's default sequencer sorts files by their previously recorded durations,
 * read from the on-disk results cache. Those durations jitter by a few
 * milliseconds every run, so the file ORDER changes between runs — measured
 * directly: four consecutive runs of this suite produced three distinct orders.
 *
 * That is the mechanism behind the intermittent failures in #97. The suite has
 * cross-file state (one SQLite database, one `public/` directory, one process),
 * so the order files run in decides whether a given test sees clean state. A
 * varying order turns that into a coin flip, which is exactly the reported
 * symptom: about one run in ten fails, on a DIFFERENT test each time, and the
 * same file run on its own never fails at all (verified: 25/25 clean).
 *
 * Sorting by path does not by itself remove the cross-file coupling — it makes
 * the coupling DETERMINISTIC, so a failure reproduces on every run instead of one
 * in ten, and `git bisect` and CI re-runs mean something again. Do not swap this
 * back to duration-based ordering to shave seconds off the run; a gate that is
 * red at random teaches people to re-run CI until it is green.
 */
class AlphabeticalSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    sequence: { sequencer: AlphabeticalSequencer },
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 10000,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    globalSetup: ['src/__tests__/globalSetup.ts'],
    env: {
      DATABASE_URL: 'file:./test.db',
      NODE_ENV: 'test',
    },
  },
});
