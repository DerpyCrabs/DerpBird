import { createConnection, type Socket } from 'node:net';

export interface BrowserEvent { method: string; params: Record<string, any> }
export interface BrowserConnection {
  request<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  subscribe(listener: (event: BrowserEvent) => void): () => void;
  close(): void;
}

/** Owner-only local IPC; commands and remote values use the engine's BiDi types. */
export class NativeConnection implements BrowserConnection {
  private nextId = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(event: BrowserEvent) => void>();
  private buffer = Buffer.alloc(0);
  private closed = false;
  private constructor(private socket: Socket) {
    socket.on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, typeof bytes === 'string' ? Buffer.from(bytes) : bytes]);
      if (this.buffer.length > 64 * 1024 * 1024) { this.fail(new Error('Browser response exceeds 64 MiB')); return; }
      for (;;) {
        const end = this.buffer.indexOf(10);
        if (end < 0) break;
        const line = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
        try {
          const packet = JSON.parse(line.toString('utf8'));
          if (packet.type === 'event') {
            for (const listener of this.listeners) listener(packet);
          } else {
            const pending = this.pending.get(packet.id);
            if (!pending) continue;
            this.pending.delete(packet.id); clearTimeout(pending.timer);
            if (packet.type === 'error') pending.reject(new Error(`${packet.error}: ${packet.message}`));
            else if (packet.type === 'success') pending.resolve(packet.result);
            else pending.reject(new Error('Invalid browser response'));
          }
        } catch (error) { this.fail(new Error(`Invalid browser packet: ${error}`)); return; }
      }
    });
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('Browser disconnected')));
  }
  static async connect(path: string): Promise<NativeConnection> {
    const socket = createConnection(path);
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { clearTimeout(timer); socket.destroy(); reject(error); };
      const timer = setTimeout(() => failed(new Error('Browser connection timed out')), 5000);
      socket.once('error', failed);
      socket.once('connect', () => { clearTimeout(timer); socket.off('error', failed); resolve(); });
    });
    return new NativeConnection(socket);
  }
  request<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Browser disconnected'));
    if (this.pending.size >= 64) return Promise.reject(new Error('Too many pending browser commands'));
    const id = ++this.nextId;
    const message = JSON.stringify({ id, method, params }) + '\n';
    if (Buffer.byteLength(message) > 16 * 1024 * 1024) return Promise.reject(new Error('Browser command exceeds 16 MiB'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 65_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(message, error => { if (error) this.fail(error); });
    });
  }
  subscribe(listener: (event: BrowserEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close() { this.fail(new Error('Browser connection closed')); }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.listeners.clear(); this.socket.destroy();
  }
}

export function remoteValue(value: any): any {
  switch (value?.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'array': return value.value?.map(remoteValue);
    case 'object': return value.value ? Object.fromEntries(value.value.map(([key, item]: [any, any]) => [typeof key === 'string' ? key : remoteValue(key), remoteValue(item)])) : {};
    case 'map': return value.value?.map(([key, item]: [any, any]) => [remoteValue(key), remoteValue(item)]);
    case 'set': return value.value?.map(remoteValue);
    case 'node': return { sharedId: value.sharedId, ...value.value };
    case 'bigint': return value.value;
    default: return value?.value ?? value;
  }
}

export function scriptResult(response: any): any {
  if (response.type === 'exception') throw new Error(response.exceptionDetails?.text ?? 'JavaScript exception');
  if (response.type !== 'success') throw new Error('Invalid script response');
  return remoteValue(response.result);
}
