export type LogStatus = 'DEBUG' | 'INFO' | 'WAITING' | 'SUCCESS' | 'ERROR' | 'WARN' | 'OK';

export interface RuntimeLog {
  id: string;
  time: string;
  email: string;
  step: string;
  status: LogStatus;
  message: string;
  streamSequence?: number;
}

export interface LogFilterState {
  searchQuery: string;
  levelFilter: string; // 'ALL' | 'DEBUG' | 'INFO' | 'SUCCESS' | 'WAITING' | 'ERROR'
  emailFilter: string;
  autoScroll: boolean;
  isPaused: boolean;
}
