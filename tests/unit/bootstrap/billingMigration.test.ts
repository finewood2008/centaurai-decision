import { describe, expect, it } from 'vitest';
import { CURRENT_DB_VERSION, initSchema } from '@/process/services/database/schema';
import { runMigrations } from '@/process/services/database/migrations';
import type { ISqliteDriver, IStatement } from '@/process/services/database/drivers/ISqliteDriver';

class MemoryStatement implements IStatement {
  constructor(
    private readonly db: MemoryDriver,
    private readonly sql: string
  ) {}

  get(): unknown {
    if (this.sql.includes('sqlite_master')) {
      return this.db.createdTables.has('billing_usage_events') ? { name: 'billing_usage_events' } : undefined;
    }
    return undefined;
  }

  all(): unknown[] {
    if (this.sql.startsWith('PRAGMA table_info')) return [];
    return [];
  }

  run(): { changes: number; lastInsertRowid: number } {
    this.db.exec(this.sql);
    return { changes: 1, lastInsertRowid: 1 };
  }
}

class MemoryDriver implements ISqliteDriver {
  createdTables = new Set<string>();
  createdIndexes = new Set<string>();
  version = 26;

  exec(sql: string): void {
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)) this.createdTables.add(match[1]);
    for (const match of sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)/g)) {
      this.createdIndexes.add(match[1]);
    }
    for (const match of sql.matchAll(/DROP TABLE IF EXISTS ([a-z_]+)/g)) this.createdTables.delete(match[1]);
  }

  prepare(sql: string): IStatement {
    return new MemoryStatement(this, sql);
  }

  pragma(sql: string, options?: { simple?: boolean }): unknown {
    if (sql === 'foreign_keys = OFF' || sql === 'foreign_keys = ON') return undefined;
    if (sql === 'foreign_key_check') return [];
    if (sql === 'user_version' && options?.simple) return this.version;
    const versionMatch = sql.match(/^user_version = (\d+)$/);
    if (versionMatch) this.version = Number(versionMatch[1]);
    return [];
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args) => fn(...args);
  }

  close(): void {}
}

describe('billing database schema', () => {
  it('does not create local billing tables for fresh databases', () => {
    const db = new MemoryDriver();

    initSchema(db);

    expect(db.createdTables.has('billing_usage_events')).toBe(false);
    expect(db.createdTables.has('billing_model_prices')).toBe(false);
    expect(db.createdTables.has('billing_usage_aggregates')).toBe(false);
    expect(db.createdTables.has('billing_settings')).toBe(false);
  });

  it('migration v28 removes local billing prototype tables', () => {
    const db = new MemoryDriver();
    db.createdTables.add('billing_usage_events');
    db.createdTables.add('billing_model_prices');
    db.createdTables.add('billing_usage_aggregates');
    db.createdTables.add('billing_settings');

    runMigrations(db, 27, 28);

    expect(CURRENT_DB_VERSION).toBe(28);
    expect(db.createdTables.has('billing_usage_events')).toBe(false);
    expect(db.createdTables.has('billing_model_prices')).toBe(false);
    expect(db.createdTables.has('billing_usage_aggregates')).toBe(false);
    expect(db.createdTables.has('billing_settings')).toBe(false);
  });
});
