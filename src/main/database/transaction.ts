import type Database from 'better-sqlite3';

export interface ITransactionRunner {
  run<T>(fn: () => T): T;
}

export class DatabaseTransactionRunner implements ITransactionRunner {
  constructor(private readonly db: Database.Database) {}

  run<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
