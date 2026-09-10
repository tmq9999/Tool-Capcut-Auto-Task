import { migration001 } from './001_initial_schema';
import { migration002 } from './002_provider_runtime';
import { migration003 } from './003_proxy_lease_ip_reuse';
import { migration004 } from './004_account_task_progress';
import { migration005 } from './005_purchased_email_reservations';
import { migration006 } from './006_account_task_receipts';
import { migration007 } from './007_account_unsettled_proofs';
import { migration008 } from './008_account_mutation_intents';
import { migration009 } from './009_unsettled_proofs_without_receipt';

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
  },
  {
    version: 6,
    name: '006_account_task_receipts',
    sql: migration006
  },
  {
    version: 7,
    name: '007_account_unsettled_proofs',
    sql: migration007
  },
  {
    version: 8,
    name: '008_account_mutation_intents',
    sql: migration008
  },
  {
    version: 9,
    name: '009_unsettled_proofs_without_receipt',
    sql: migration009
  }
];
