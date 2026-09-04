export type AccountStatus = 'active' | 'processing' | 'error' | 'disabled' | 'waiting' | 'done';

export interface Account {
  id: string;
  stt: number;
  email: string;
  /**
   * Mật khẩu CapCut — CỘT #2 của bản xuất (AGENTS §21). Đây là thứ lưới Accounts
   * hiện ở cột "Password CapCut"; giá trị thật không bao giờ rời main process nên
   * ở đây chỉ có dấu che hoặc chuỗi người dùng vừa nhập.
   */
  password?: string;
  /** Mật khẩu hộp thư (§15 `email_password_encrypted`), tách khỏi mật khẩu CapCut. */
  emailPassword?: string;
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
