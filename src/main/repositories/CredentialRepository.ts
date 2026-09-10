import type Database from 'better-sqlite3';
import {
  CredentialDiagnosticMetadataSchema,
  type CredentialDiagnosticMetadata
} from '../../shared/schemas/diagnostics.schema';

export class DataCorruptionError extends Error {
  constructor(resourceName: string) {
    super(`Stored data for resource "${resourceName}" is corrupted or invalid.`);
    this.name = 'DataCorruptionError';
  }
}

interface CredentialDbRow {
  service_name: string;
  encrypted_credentials: Buffer;
  metadata: string | null;
  updated_at: string;
}

export interface CredentialRecord {
  serviceName: string;
  encryptedCredentials: Buffer;
  metadata: CredentialDiagnosticMetadata;
  updatedAt: string;
}

export class CredentialRepository {
  constructor(private readonly db: Database.Database) {}

  private parseMetadata(serviceName: string, rawJson: string | null): CredentialDiagnosticMetadata {
    if (!rawJson) {
      return {
        maskedHint: '••••••••',
        status: 'unknown'
      };
    }

    try {
      const parsed: unknown = JSON.parse(rawJson);
      const validation = CredentialDiagnosticMetadataSchema.safeParse(parsed);
      if (!validation.success) {
        throw new DataCorruptionError(serviceName);
      }
      return validation.data;
    } catch (err: unknown) {
      if (err instanceof DataCorruptionError) {
        throw err;
      }
      throw new DataCorruptionError(serviceName);
    }
  }

  saveCredential(serviceName: string, encryptedData: Buffer, metadata?: CredentialDiagnosticMetadata): void {
    let metadataStr: string | null = null;
    if (metadata) {
      const validMeta = CredentialDiagnosticMetadataSchema.parse(metadata);
      metadataStr = JSON.stringify(validMeta);
    }

    this.db.prepare(`
      INSERT INTO service_credentials (service_name, encrypted_credentials, metadata, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(service_name) DO UPDATE SET
        encrypted_credentials = excluded.encrypted_credentials,
        metadata = COALESCE(excluded.metadata, service_credentials.metadata),
        updated_at = datetime('now')
    `).run(serviceName, encryptedData, metadataStr);
  }

  getCredential(serviceName: string): CredentialRecord | null {
    const row = this.db.prepare(`
      SELECT service_name, encrypted_credentials, metadata, updated_at
      FROM service_credentials
      WHERE service_name = ?
    `).get(serviceName) as CredentialDbRow | undefined;

    if (!row) return null;

    return {
      serviceName: row.service_name,
      encryptedCredentials: row.encrypted_credentials,
      metadata: this.parseMetadata(row.service_name, row.metadata),
      updatedAt: row.updated_at
    };
  }

  getAllCredentials(): CredentialRecord[] {
    const rows = this.db.prepare(`
      SELECT service_name, encrypted_credentials, metadata, updated_at
      FROM service_credentials
      ORDER BY service_name ASC
    `).all() as CredentialDbRow[];

    return rows.map((row) => ({
      serviceName: row.service_name,
      encryptedCredentials: row.encrypted_credentials,
      metadata: this.parseMetadata(row.service_name, row.metadata),
      updatedAt: row.updated_at
    }));
  }

  updateMetadata(serviceName: string, metadata: CredentialDiagnosticMetadata): void {
    const validMeta = CredentialDiagnosticMetadataSchema.parse(metadata);
    const metadataStr = JSON.stringify(validMeta);

    this.db.prepare(`
      UPDATE service_credentials
      SET metadata = ?, updated_at = datetime('now')
      WHERE service_name = ?
    `).run(metadataStr, serviceName);
  }

  replaceEncryptedIfUnchanged(serviceName: string, expected: Buffer, replacement: Buffer): boolean {
    return this.db.prepare(`
      UPDATE service_credentials
      SET encrypted_credentials = ?, updated_at = datetime('now')
      WHERE service_name = ? AND encrypted_credentials = ?
    `).run(replacement, serviceName, expected).changes === 1;
  }

  updateMetadataIfUnchanged(
    serviceName: string,
    expected: Buffer,
    metadata: CredentialDiagnosticMetadata
  ): boolean {
    const validMeta = CredentialDiagnosticMetadataSchema.parse(metadata);
    const metadataStr = JSON.stringify(validMeta);
    return this.db.prepare(`
      UPDATE service_credentials
      SET metadata = ?, updated_at = datetime('now')
      WHERE service_name = ? AND encrypted_credentials = ?
    `).run(metadataStr, serviceName, expected).changes === 1;
  }

  delete(serviceName: string): boolean {
    const res = this.db.prepare(`
      DELETE FROM service_credentials
      WHERE service_name = ?
    `).run(serviceName);

    return res.changes > 0;
  }
}
