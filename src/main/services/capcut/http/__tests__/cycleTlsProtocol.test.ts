import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseCycleTlsFrame } from '../cycleTlsProtocol';

function string16(value: string): Buffer {
  const data = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length);
  return Buffer.concat([length, data]);
}

function frame(requestId: string, method: string, payload = Buffer.alloc(0)): Buffer {
  return Buffer.concat([string16(requestId), string16(method), payload]);
}

describe('CycleTLS binary protocol parser', () => {
  it('preserves repeated response header rows', () => {
    const status = Buffer.alloc(2);
    status.writeUInt16BE(200);
    const headerCount = Buffer.alloc(2);
    headerCount.writeUInt16BE(2);
    const twoValues = Buffer.alloc(2);
    twoValues.writeUInt16BE(2);
    const oneValue = Buffer.alloc(2);
    oneValue.writeUInt16BE(1);
    const parsed = parseCycleTlsFrame(frame('opaque-id', 'response', Buffer.concat([
      status,
      string16('http://127.0.0.1/final'),
      headerCount,
      string16('Set-Cookie'), twoValues, string16('a=1'), string16('b=2'),
      string16('Content-Type'), oneValue, string16('text/plain')
    ])));

    expect(parsed).toEqual({
      requestId: 'opaque-id',
      method: 'response',
      status: 200,
      finalUrl: 'http://127.0.0.1/final',
      headers: [
        { name: 'Set-Cookie', value: 'a=1' },
        { name: 'Set-Cookie', value: 'b=2' },
        { name: 'Content-Type', value: 'text/plain' }
      ]
    });
  });

  it('returns arbitrary data bytes without text conversion', () => {
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x41]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    expect(parseCycleTlsFrame(frame('id', 'data', Buffer.concat([length, bytes])))).toEqual({
      requestId: 'id',
      method: 'data',
      data: bytes
    });
  });

  it.each([
    ['truncated string', Buffer.from([0x00, 0x04, 0x61])],
    ['truncated data', frame('id', 'data', Buffer.from([0, 0, 0, 3, 1]))],
    ['unknown method', frame('id', 'mystery')],
    ['trailing bytes', frame('id', 'end', Buffer.from([1]))]
  ])('rejects %s with a sanitized error', (_name, input) => {
    expect(() => parseCycleTlsFrame(input)).toThrow('CYCLETLS_PROTOCOL_INVALID');
  });

  it('does not expose a native error URL or token', () => {
    const status = Buffer.alloc(2);
    status.writeUInt16BE(502);
    const nativeMessage = 'failed https://example.test/?token=secret-value';
    const parsed = parseCycleTlsFrame(frame('opaque-id', 'error', Buffer.concat([status, string16(nativeMessage)])));

    expect(parsed).toEqual({ requestId: 'opaque-id', method: 'error', status: 502 });
    expect(JSON.stringify(parsed)).not.toContain('example.test');
    expect(JSON.stringify(parsed)).not.toContain('secret-value');
  });
});
