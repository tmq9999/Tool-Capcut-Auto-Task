import { Buffer } from 'node:buffer';
import type { NativeHttpHeader } from './nativeHttpContext';

export type CycleTlsFrame =
  | { requestId: string; method: 'response'; status: number; finalUrl: string; headers: NativeHttpHeader[] }
  | { requestId: string; method: 'data'; data: Buffer }
  | { requestId: string; method: 'error'; status: number }
  | { requestId: string; method: 'end' };

class Reader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  u16(): number {
    this.require(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  string16(): string {
    return this.bytes(this.u16()).toString('utf8');
  }

  bytes(length: number): Buffer {
    this.require(length);
    const value = Buffer.from(this.buffer.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  done(): boolean {
    return this.offset === this.buffer.length;
  }

  private require(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
      throw new Error('CYCLETLS_PROTOCOL_INVALID');
    }
  }
}

export function parseCycleTlsFrame(input: Buffer | ArrayBuffer | ArrayBufferView): CycleTlsFrame {
  try {
    const buffer = Buffer.isBuffer(input)
      ? input
      : input instanceof ArrayBuffer
        ? Buffer.from(input)
        : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const reader = new Reader(buffer);
    const requestId = reader.string16();
    const method = reader.string16();
    let frame: CycleTlsFrame;
    if (method === 'response') {
      const status = reader.u16();
      const finalUrl = reader.string16();
      const headers: NativeHttpHeader[] = [];
      const headerCount = reader.u16();
      for (let headerIndex = 0; headerIndex < headerCount; headerIndex += 1) {
        const name = reader.string16();
        const valueCount = reader.u16();
        for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
          headers.push({ name, value: reader.string16() });
        }
      }
      frame = { requestId, method, status, finalUrl, headers };
    } else if (method === 'data') {
      frame = { requestId, method, data: reader.bytes(reader.u32()) };
    } else if (method === 'error') {
      const status = reader.u16();
      reader.string16();
      frame = { requestId, method, status };
    } else if (method === 'end') {
      frame = { requestId, method };
    } else {
      throw new Error('CYCLETLS_PROTOCOL_INVALID');
    }
    if (!reader.done()) throw new Error('CYCLETLS_PROTOCOL_INVALID');
    return frame;
  } catch {
    throw new Error('CYCLETLS_PROTOCOL_INVALID');
  }
}
