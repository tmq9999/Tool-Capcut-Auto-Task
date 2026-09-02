import { describe, it, expect } from 'vitest';
import { FetchHttpClient } from '../HttpClient';
import { CustomDomainMailProvider } from '../CustomDomainMailProvider';
import { generateMailUsernames, buildCustomDomainAddress } from '../../services/mailUsername';
import { readEnv, report } from './liveEnv';

/** Reads the operator's own catch-all domain. No key, no cost, read-only. */
const http = new FetchHttpClient();

describe('Custom domain mail (live)', () => {
  const baseUrl = readEnv('CUSTOM_MAIL_API_BASE_URL') ?? 'http://103.116.38.76:3000';
  const domain = readEnv('CUSTOM_MAIL_DOMAIN') ?? 'oldevlk.com';

  it('reads the sample mailbox from the real service', async () => {
    const provider = new CustomDomainMailProvider(http);
    const address = 'toibisidamatroi19090@' + domain;

    const inbox = await provider.listInbox(baseUrl, address);

    report('Hop thu mau', address + ' -> count ' + inbox.count);
    expect(inbox.address).toBe(address);
    expect(Array.isArray(inbox.emails)).toBe(true);
  }, 60_000);

  it('answers with an empty inbox for a freshly generated address', async () => {
    const provider = new CustomDomainMailProvider(http);
    const [username] = generateMailUsernames(1);
    const address = buildCustomDomainAddress(username, domain);

    const inbox = await provider.listInbox(baseUrl, address);

    report('Dia chi vua sinh', address + ' -> count ' + inbox.count);
    expect(inbox.address).toBe(address);
    expect(inbox.count).toBe(0);
    expect(inbox.emails).toEqual([]);
  }, 60_000);

  it('returns null for a mailbox with no CapCut code yet', async () => {
    const provider = new CustomDomainMailProvider(http);
    const [username] = generateMailUsernames(1);
    const address = buildCustomDomainAddress(username, domain);

    await expect(provider.readOtp(baseUrl, address)).resolves.toBeNull();
    report('Doc OTP hop thu trong', 'null - dung');
  }, 60_000);

  it('generates addresses that the service accepts verbatim', async () => {
    const provider = new CustomDomainMailProvider(http);
    const usernames = generateMailUsernames(3);

    for (const username of usernames) {
      const address = buildCustomDomainAddress(username, domain);
      const inbox = await provider.listInbox(baseUrl, address);
      expect(inbox.address).toBe(address);
    }

    report('3 dia chi tu sinh', usernames.join(', '));
  }, 120_000);
});
