import WebSocket from 'ws';

export interface RpcFrame {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class HermesTransportError extends Error {
  constructor(message: string, public readonly ambiguous = false) {
    super(message);
    this.name = 'HermesTransportError';
  }
}

export class HermesRpcError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'HermesRpcError';
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  method: string;
}

export interface RpcClientOptions {
  onEvent(frame: Record<string, unknown>): void;
  onRequest(frame: RpcFrame): void;
  onDisconnect(): void;
}

/** A small server-side subset of Hermes's peer JSON-RPC protocol. No prompt retry. */
export class HermesRpcClient {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private nextId = 0;
  private pending = new Map<string | number, Pending>();
  private closed = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private pinging = false;
  generation = 0;
  epoch?: string;

  constructor(private readonly url: () => string, private readonly options: RpcClientOptions) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new HermesTransportError('Hermes connection is closed.'));
    if (this.isOpen) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url(), { maxPayload: 8 * 1024 * 1024, handshakeTimeout: 15_000 });
      this.socket = socket;
      const fail = (): void => {
        if (!settled) {
          settled = true;
          reject(new HermesTransportError('Could not connect to the Hermes backend. Check the connection and authentication.'));
        }
      };
      socket.on('open', () => {
        this.generation += 1;
        settled = true;
        resolve();
      });
      socket.on('message', data => {
        let frame: RpcFrame;
        try {
          const parsed: unknown = JSON.parse(data.toString());
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
          frame = parsed as RpcFrame;
        } catch { return; }
        if (this.socket !== socket) return;
        if (frame.method === 'event' && frame.params) {
          if (frame.params.type === 'gateway.ready') {
            const payload = object(frame.params.payload);
            if (typeof payload.replay_epoch === 'string') this.epoch = payload.replay_epoch;
            if (payload.heartbeat === true) this.startHeartbeat(socket);
            // Announce only peer-request support; unknown request methods fail explicitly below.
            void this.request('client.capabilities', { server_requests: true }).catch(() => {});
          }
          this.options.onEvent(frame.params);
          return;
        }
        if (frame.method && frame.id !== undefined && frame.id !== null) {
          this.options.onRequest(frame);
          return;
        }
        if (frame.id === undefined || frame.id === null) return;
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        this.pending.delete(frame.id);
        clearTimeout(pending.timeout);
        if (frame.error) {
          pending.reject(new HermesRpcError(frame.error.code ?? -32603, 'Hermes refused the operation.'));
        } else pending.resolve(frame.result);
      });
      socket.on('error', fail);
      socket.on('close', () => {
        fail();
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.stopHeartbeat();
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new HermesTransportError('Connection lost. The operation outcome is unknown.', true));
        }
        this.pending.clear();
        this.options.onDisconnect();
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.socket !== socket || !this.isOpen || this.pinging) return;
      this.pinging = true;
      // Hermes advertises this cheap reader-thread method independently of a long agent turn.
      void this.request('ping', {}, 10_000).catch(() => {
        if (this.socket === socket) socket.terminate();
      }).finally(() => { this.pinging = false; });
    }, 15_000);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.pinging = false;
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.isOpen || !this.socket) return Promise.reject(new HermesTransportError('Hermes is not connected.'));
    const id = `hermes-extension-${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new HermesTransportError('Hermes did not acknowledge the operation. Its outcome is unknown.', true));
      }, timeoutMs);
      timeout.unref();
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timeout, method });
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), error => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new HermesTransportError('Could not confirm delivery to Hermes. The outcome is unknown.', true));
      });
    });
  }

  respond(id: string | number, result: Record<string, unknown>): void {
    if (!this.isOpen || !this.socket) throw new HermesTransportError('Reconnect before answering this question.');
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  rejectRequest(id: string | number, code = -32601): void {
    if (!this.isOpen || !this.socket) return;
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: 'This Hermes extension does not support that request.' } }));
  }

  dispose(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.socket?.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new HermesTransportError('Hermes connection is closed.', true));
    }
    this.pending.clear();
  }
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
