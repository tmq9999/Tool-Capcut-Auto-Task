export type BrowserProvider = 'GPM Login' | 'GoLogin' | 'Multilogin' | 'Camoufox' | 'Patchright';

export interface GpmConfig {
  port: string;
}

export interface GoLoginConfig {
  apiKey: string;
}

export interface MultiloginConfig {
  email: string;
  password?: string;
}

export interface ModuleStatus {
  installed: boolean;
  version: string;
}

export interface BrowserSettings {
  provider: BrowserProvider;
  gpm: GpmConfig;
  gologin: GoLoginConfig;
  multilogin: MultiloginConfig;
  camoufox: ModuleStatus;
  patchright: ModuleStatus;
}

export interface EmailProviderSettings {
  gmail94ApiKey: string;
  dongVanFbApiKey: string;
}

export type ExportFieldName =
  | 'Email'
  | 'Password CapCut'
  | 'Email Data'
  | 'Credit'
  | 'Subscription'
  | 'Create At'
  | 'Proxy'
  | 'Browser/Profile'
  | 'Status'
  | 'Notes';

export interface ExportSettings {
  defaultFormat: 'TXT' | 'CSV' | 'XLSX';
  checkedFields: ExportFieldName[];
  availableFields: ExportFieldName[];
}

export interface GeneralSettings {
  theme: 'Dark' | 'Light';
  language: 'Tiếng Việt' | 'English';
  autoSaveConfig: boolean;
  sessionRestore: boolean;
}

export interface AppSettings {
  general: GeneralSettings;
  browser: BrowserSettings;
  emailProvider: EmailProviderSettings;
  exportConfig: ExportSettings;
}
