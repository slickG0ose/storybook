export declare const POSTGRES_MIGRATIONS_DIR: string;
export declare function snapshotPathFor(migrationDir: string): string;
export declare function listMigrations(migrationsDir?: string): string[];
export declare function latestMigrationDir(migrationsDir?: string): string;
export declare function migrationFolderName(name: string, now?: Date): string;
export declare function prismaEnv(): NodeJS.ProcessEnv;
export declare function diffExitCode(
  fromSchema: string,
  toSchema: string,
): { status: number; stderr: string };
export declare function createMigration(opts: {
  name: string;
  migrationsDir?: string;
  schemaPath?: string;
  now?: Date;
}): { created: false; reason: string } | { created: true; dir: string; destructive: string[] };
