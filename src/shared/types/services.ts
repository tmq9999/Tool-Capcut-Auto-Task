export interface ServiceStatus {
  multiloginConnected: boolean;
  gpmConnected: boolean;
  emailApiStatus: '200 OK' | 'Degraded' | 'Offline';
  activeProxies: string; // e.g. '4/4 Active'
  appVersion: string; // e.g. 'v2.4.0-stable'
}
