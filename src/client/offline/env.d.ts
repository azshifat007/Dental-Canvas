// Ambient declarations for the offline-mode imports that TypeScript can't
// resolve on its own.

/// <reference types="vite/client" />

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "virtual:offline-shell-assets" {
  /** Build-time precache manifest: index.html + hashed asset paths. */
  export const OFFLINE_SHELL_ASSETS: string[];
}

declare module "sql.js" {
  export interface SqlJsStatement {
    bind(values: unknown[]): boolean;
    step(): boolean;
    get(): unknown[];
    getColumnNames(): string[];
    free(): boolean;
    getAsObject(): Record<string, unknown>;
  }

  export interface SqlJsDatabase {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    getRowsModified(): number;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string, prefix?: string) => string;
    wasmBinary?: Uint8Array;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
