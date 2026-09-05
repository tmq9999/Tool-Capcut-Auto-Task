import { migration001 } from './001_initial_schema';
import { migration002 } from './002_provider_runtime';
import { migration003 } from './003_proxy_lease_ip_reuse';
import { migration004 } from './004_account_task_progress';
import { migration005 } from './005_purchased_email_reservations';

export interface MigrationItem {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationItem[] = [
  {
    version: 1,
    name: '001_initial_schema',
    sql: migration001
  },
  {
    version: 2,
    name: '002_provider_runtime',
    sql: migration002
  },
  {
    version: 3,
    name: '003_proxy_lease_ip_reuse',
    sql: migration003
  },
  {
    version: 4,
    name: '004_account_task_progress',
    sql: migration004
  },
  {
    version: 5,
    name: '005_purchased_email_reservations',
    sql: migration005
  }
];
