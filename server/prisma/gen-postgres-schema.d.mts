export declare const HEADER: string;
export declare const POSTGRES_SCHEMA_PATH: string;
export declare function toPostgresSchema(sqliteSchema: string): string;
export declare function writePostgresSchema(): Promise<string>;
