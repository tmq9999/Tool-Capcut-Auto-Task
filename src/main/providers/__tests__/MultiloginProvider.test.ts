import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { MultiloginProvider } from '../MultiloginProvider';
import { ProviderError } from '../ProviderError';
import type { HttpClient, HttpRequest, HttpResponse } from '../HttpClient';
import { ApiV3Launcher } from '../../services/capcut/launcher/ApiV3Launcher';

class FakeHttpClient implements HttpClient {
  public requests: HttpRequest[] = [];
  private queue: HttpResponse[] = [];

  enqueue(response: Partial<HttpResponse>): void {
    const status = response.status ?? 200;
    this.queue.push({
      status,
      ok: response.ok ?? (status >= 200 && status < 300),
      body: response.body ?? null,
      rawText: response.rawText ?? ''
    });
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('FakeHttpClient: no response enqueued');
    return next;
  }
}

const PLAIN_PASSWORD = 'S3cret-Passw0rd';
const MD5_PASSWORD = crypto.createHash('md5').update(PLAIN_PASSWORD).digest('hex');

function okTokens(token: string, refresh: string) {
  return { body: { status: { http_code: 200 }, data: { token, refresh_token: refresh } } };
}

describe('MultiloginProvider.signIn', () => {
  it('hashes the password with md5 and never transmits the plaintext', async () => {
    const http = new FakeHttpClient();
    http.enqueue(okTokens('jwt-1', 'refresh-1'));
    const provider = new MultiloginProvider(http);

    await provider.signIn('user@example.com', PLAIN_PASSWORD);

    const sent = http.requests[0];
    expect(sent.url).toBe('https://api.multilogin.com/user/signin');
    expect(sent.method).toBe('POST');
    expect(sent.json).toEqual({ email: 'user@example.com', password: MD5_PASSWORD });
    expect(JSON.stringify(sent)).not.toContain(PLAIN_PASSWORD);
  });

  it('returns both tokens from the data envelope', async () => {
    const http = new FakeHttpClient();
    http.enqueue(okTokens('jwt-1', 'refresh-1'));
    const provider = new MultiloginProvider(http);

    const tokens = await provider.signIn('user@example.com', PLAIN_PASSWORD);

    expect(tokens).toEqual({ token: 'jwt-1', refreshToken: 'refresh-1' });
  });

  it('maps a 401 response to an AUTH_ERROR provider error', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ status: 401, body: { status: { http_code: 401, message: 'wrong credentials' } } });
    const provider = new MultiloginProvider(http);

    await expect(provider.signIn('user@example.com', PLAIN_PASSWORD)).rejects.toMatchObject({
      code: 'AUTH_ERROR'
    });
  });

  it('rejects a 200 response whose payload is missing the tokens', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: { http_code: 200 }, data: {} } });
    const provider = new MultiloginProvider(http);

    await expect(provider.signIn('user@example.com', PLAIN_PASSWORD)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('MultiloginProvider.refreshTokens', () => {
  it('posts the email and refresh token and returns the rotated pair', async () => {
    const http = new FakeHttpClient();
    http.enqueue(okTokens('jwt-2', 'refresh-2'));
    const provider = new MultiloginProvider(http);

    const tokens = await provider.refreshTokens('user@example.com', 'refresh-1');

    expect(http.requests[0].url).toBe('https://api.multilogin.com/user/refresh_token');
    expect(http.requests[0].json).toEqual({ email: 'user@example.com', refresh_token: 'refresh-1' });
    expect(tokens).toEqual({ token: 'jwt-2', refreshToken: 'refresh-2' });
  });

  it('includes the workspace id only when one is supplied', async () => {
    const http = new FakeHttpClient();
    http.enqueue(okTokens('t', 'r'));
    const provider = new MultiloginProvider(http);

    await provider.refreshTokens('user@example.com', 'refresh-1', 'ws-1');

    expect(http.requests[0].json).toEqual({
      email: 'user@example.com',
      refresh_token: 'refresh-1',
      workspace_id: 'ws-1'
    });
  });
});

describe('MultiloginProvider quick profiles', () => {
  it('starts a headless quick profile on the local launcher', async () => {
    const http = new FakeHttpClient();
    // Shape returned by launcher 12.11.0: no port on the start response.
    http.enqueue({
      body: {
        status: { http_code: 200, message: 'Quick profile started successfully' },
        data: {
          browser_type: 'mimic',
          core_version: 151,
          id: '51590a68-a5c8-11f1-8304-10ffe099466c',
          is_quick: true
        }
      }
    });
    const provider = new MultiloginProvider(http);

    const profile = await provider.startQuickProfile('jwt-1', { isHeadless: true });

    const sent = http.requests[0];
    expect(sent.url).toBe('https://launcher.mlx.yt:45001/api/v3/profile/quick');
    expect(sent.headers?.Authorization).toBe('Bearer jwt-1');
    expect((sent.json as Record<string, unknown>).is_headless).toBe(true);
    expect(profile).toEqual({
      profileId: '51590a68-a5c8-11f1-8304-10ffe099466c',
      port: null,
      browserType: 'mimic'
    });
  });

  it('keeps the debug port when a launcher build does report one', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        status: { http_code: 200 },
        data: { id: 'd04aa438-d887-11ef', port: '55579', browser_type: 'mimic', is_quick: true }
      }
    });
    const provider = new MultiloginProvider(http);

    const profile = await provider.startQuickProfile('jwt-1', { isHeadless: true });

    expect(profile.port).toBe(55579);
  });

  it('still fails when the launcher returns no profile id', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: { http_code: 200 }, data: { browser_type: 'mimic' } } });
    const provider = new MultiloginProvider(http);

    await expect(provider.startQuickProfile('jwt-1', { isHeadless: false })).rejects.toBeInstanceOf(ProviderError);
  });

  it('forwards proxy connection details inside the parameters object', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: { http_code: 200 }, data: { id: 'p1', browser_type: 'mimic' } } });
    const provider = new MultiloginProvider(http);

    await provider.startQuickProfile('jwt-1', {
      isHeadless: false,
      proxy: { host: '1.2.3.4', port: 20001, type: 'http', username: 'u', password: 'p' }
    });

    const body = http.requests[0].json as { parameters: { proxy: Record<string, unknown> } };
    expect(body.parameters.proxy).toEqual({
      host: '1.2.3.4',
      port: 20001,
      type: 'http',
      username: 'u',
      password: 'p'
    });
  });
});

describe('MultiloginProvider stop and version', () => {
  it('stops one profile by id', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: { http_code: 200 } } });
    const provider = new MultiloginProvider(http);

    await provider.stopProfile('jwt-1', 'profile-9');

    expect(http.requests[0].method).toBe('GET');
    expect(http.requests[0].url).toBe('https://launcher.mlx.yt:45001/api/v1/profile/stop/p/profile-9');
  });

  it('treats a launcher error envelope carrying transport 200 as a failure', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: { status: { http_code: 500, error_code: 'LAUNCHER_DOWN', message: 'agent not running' } }
    });
    const provider = new MultiloginProvider(http);

    await expect(provider.startQuickProfile('jwt-1', { isHeadless: false })).rejects.toBeInstanceOf(ProviderError);
  });

  it('exposes no stop-all helper, so a run can never kill another profile', () => {
    const provider = new MultiloginProvider(new FakeHttpClient());
    expect((provider as unknown as Record<string, unknown>).stopAllQuickProfiles).toBeUndefined();
  });

  it('reads the debug port of a running quick profile from the statuses map', async () => {
    const http = new FakeHttpClient();
    // Shape returned by launcher 12.11.0: states keyed by profile id, and the
    // port only appears once the browser has finished booting.
    http.enqueue({
      body: {
        status: { http_code: 200 },
        data: {
          active_counter: 2,
          states: {
            '7dbaae9a-a5c8-11f1': {
              browser_type: 'mimic',
              is_quick: true,
              message: '62648',
              name: 'reliable_catherine',
              port: 62648,
              profile_id: '7dbaae9a-a5c8-11f1',
              status: 'browser_running'
            },
            '51590a68-a5c8-11f1': {
              browser_type: 'mimic',
              is_quick: true,
              message: '',
              name: 'modest_laura',
              profile_id: '51590a68-a5c8-11f1',
              status: 'browser_running'
            }
          }
        }
      }
    });
    const provider = new MultiloginProvider(http);

    const statuses = await provider.getQuickProfileStatuses('jwt-1');

    expect(http.requests[0].url).toBe('https://launcher.mlx.yt:45001/api/v1/profile/quick/statuses');
    expect(statuses).toEqual([
      { profileId: '7dbaae9a-a5c8-11f1', status: 'browser_running', port: 62648, browserType: 'mimic' },
      { profileId: '51590a68-a5c8-11f1', status: 'browser_running', port: null, browserType: 'mimic' }
    ]);
  });

  it('falls back to the message field when it carries the port', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        status: { http_code: 200 },
        data: {
          active_counter: 1,
          states: {
            'p1': { browser_type: 'mimic', message: '57165', profile_id: 'p1', status: 'browser_running' }
          }
        }
      }
    });
    const provider = new MultiloginProvider(http);

    const statuses = await provider.getQuickProfileStatuses('jwt-1');

    expect(statuses[0].port).toBe(57165);
  });

  it('returns an empty list when no quick profile is running', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: { http_code: 200 }, data: { active_counter: 0, states: {} } } });
    const provider = new MultiloginProvider(http);

    await expect(provider.getQuickProfileStatuses('jwt-1')).resolves.toEqual([]);
  });

  it('does not confirm stop from missing states', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: { http_code: 200 }, data: {} } });
    http.enqueue({ body: { status: { http_code: 200 }, data: {} } });
    const launcher = new ApiV3Launcher(
      { getAccessToken: async () => 'DEMO' },
      new MultiloginProvider(http)
    );
    await expect(launcher.stop('profile-DEMO')).rejects.toMatchObject({
      diagnostic: { phase: 'confirm-status' }
    });
    expect(http.requests).toHaveLength(2);
  });

  it('rejects malformed states payloads with ProviderError NETWORK_ERROR', async () => {
    const malformedBodies = [
      { status: { http_code: 200 }, data: {} },
      { status: { http_code: 200 }, data: { states: null } },
      { status: { http_code: 200 }, data: { states: [] } },
      { status: { http_code: 200 }, data: { states: 'running' } },
      { status: { http_code: 200 }, data: { states: { 'p-1': null } } },
      { status: { http_code: 200 }, data: { states: { 'p-1': 'bad-row' } } },
      { status: { http_code: 200 }, data: { states: { '': { profile_id: '' } } } },
      { status: { http_code: 200 }, data: { states: { 'p-1': { profile_id: 'p-2' } } } },
      { status: { http_code: 200 }, data: { states: { 'p-1': { profile_id: '' } } } },
      { status: { http_code: 200 }, data: { states: { 'p-1': { status: '' } } } },
      { status: { http_code: 200 }, data: { states: { 'p-1': { status: 123 } } } }
    ];

    for (const body of malformedBodies) {
      const http = new FakeHttpClient();
      http.enqueue({ body });
      const provider = new MultiloginProvider(http);
      await expect(provider.getQuickProfileStatuses('jwt-1')).rejects.toMatchObject({
        name: 'ProviderError',
        code: 'NETWORK_ERROR',
        message: 'Multilogin trả về trạng thái profile không hợp lệ.',
        serviceName: 'multilogin'
      });
    }
  });

  it('allows valid empty states and maps valid entries correctly', async () => {
    const http = new FakeHttpClient();
    http.enqueue({
      body: {
        status: { http_code: 200 },
        data: {
          states: {
            'p-1': { profile_id: 'p-1', status: 'stopped' },
            'p-2': { status: 'custom_status', port: 12345, browser_type: 'stealth' },
            'p-3': {}
          }
        }
      }
    });
    const provider = new MultiloginProvider(http);

    const statuses = await provider.getQuickProfileStatuses('jwt-1');
    expect(statuses).toEqual([
      { profileId: 'p-1', status: 'stopped', port: null, browserType: 'mimic' },
      { profileId: 'p-2', status: 'custom_status', port: 12345, browserType: 'stealth' },
      { profileId: 'p-3', status: 'unknown', port: null, browserType: 'mimic' }
    ]);
  });

  it('reads the launcher version for connectivity checks', async () => {
    const http = new FakeHttpClient();
    http.enqueue({ body: { status: { http_code: 200 }, data: { version: '1.11.1', env: 'prod' } } });
    const provider = new MultiloginProvider(http);

    await expect(provider.getLauncherVersion()).resolves.toBe('1.11.1');
    expect(http.requests[0].url).toBe('https://launcher.mlx.yt:45001/api/v1/version');
  });
});
