import type Database from 'better-sqlite3';
import { AppSettingsSchema, type AppSettingsDTO } from '../../shared/schemas/settings.schema';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings/default-settings';
import { DataCorruptionError } from './CredentialRepository';

interface SettingDbRow {
  key: string;
  value: string;
  updated_at: string;
}

export class SettingsRepository {
  private static readonly SETTINGS_KEY = 'app_settings';

  constructor(private readonly db: Database.Database) {}

  getAppSettings(): AppSettingsDTO | null {
    const row = this.db.prepare('SELECT key, value, updated_at FROM app_settings WHERE key = ?').get(SettingsRepository.SETTINGS_KEY) as SettingDbRow | undefined;
    if (!row) return null;

    try {
      const parsedJson: unknown = JSON.parse(row.value);
      if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
        throw new DataCorruptionError('app_settings');
      }

      const obj = parsedJson as Record<string, unknown>;
      // Older databases predate these blocks; fill them from defaults so an
      // upgrade never wipes the user's existing settings.
      const candidate = {
        ...obj,
        logs: obj.logs !== undefined ? obj.logs : DEFAULT_APP_SETTINGS.logs,
        automation: obj.automation !== undefined ? obj.automation : DEFAULT_APP_SETTINGS.automation,
        customEmail: obj.customEmail !== undefined ? obj.customEmail : DEFAULT_APP_SETTINGS.customEmail,
      };

      const validationResult = AppSettingsSchema.safeParse(candidate);
      if (!validationResult.success) {
        throw new DataCorruptionError('app_settings');
      }
      return validationResult.data;
    } catch (err: unknown) {
      if (err instanceof DataCorruptionError) {
        throw err;
      }
      throw new DataCorruptionError('app_settings');
    }
  }

  saveAppSettings(settings: AppSettingsDTO): void {
    const validated = AppSettingsSchema.parse(settings);
    const jsonStr = JSON.stringify(validated);

    this.db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `).run(SettingsRepository.SETTINGS_KEY, jsonStr);
  }
}
