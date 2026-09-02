export type AccountStatus = 'active' | 'processing' | 'error' | 'disabled' | 'waiting' | 'done';

export interface Account {
  id: string;
  stt: number;
  email: string;
  password?: string;
  provider: string; // e.g. 'Gmail', 'Outlook', 'Yahoo', 'Proton'
  fullData?: string;
  proxy?: string;
  browserProfile?: string;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  credit?: number;
  subscription?: string;
}

export type ExportScope = 'all' | 'checked' | 'filtered';
export type ExportFormat = 'XLSX' | 'CSV' | 'TXT';

export interface AccountFilterState {
  searchQuery: string;
  statusFilter: string;
  dateFilter: string;
  providerFilter: string;
  browserFilter: string;
}
