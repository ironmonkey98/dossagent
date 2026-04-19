import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// 使用文件位置而非 process.cwd()，避免从其他目录启动时路径错误
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { logger } from './logger.js';
import {
  Channel,
  NewMessage,
  OnChatMetadata,
  OnInboundMessage,
} from './types.js';
import { readEnvFile } from './env.js';
import { storeChatMetadata } from './db.js';

export const API_JID = 'api@nanoclaw';
export const API_GROUP_FOLDER = 'api';

const envConfig = readEnvFile(['LLM_API_URL', 'LLM_API_KEY', 'LLM_MODEL']);
const LLM_API_URL = process.env.LLM_API_URL || envConfig.LLM_API_URL || '';
const LLM_API_KEY = process.env.LLM_API_KEY || envConfig.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || envConfig.LLM_MODEL || 'glm-4';

const API_PORT = parseInt(process.env.API_PORT || '3080', 10);
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '9080', 10);
const API_KEY = process.env.NANOCLAW_API_KEY || '';
const REQUEST_TIMEOUT_MS = 120_000;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// In-memory conversation history per session (keyed by session id in cookie/header)
const chatHistory: ChatMessage[] = [];

async function callLLM(userMessage: string): Promise<string> {
  chatHistory.push({ role: 'user', content: userMessage });

  const body = JSON.stringify({
    model: LLM_MODEL,
    messages: chatHistory,
    max_tokens: 4096,
    temperature: 0.7,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(LLM_API_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const reply: string =
            json.choices?.[0]?.message?.content ??
            json.error?.message ??
            '（无响应）';
          chatHistory.push({ role: 'assistant', content: reply });
          resolve(reply);
        } catch {
          reject(new Error('LLM response parse error: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

interface PendingRequest {
  chunks: string[];
  resolve: (chunks: string[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApiChannel implements Channel {
  readonly name = 'api';
  private _connected = false;
  // FIFO queue: each HTTP request gets a slot; agent chunks go to queue[0]
  private queue: PendingRequest[] = [];
  private onMessageFn: OnInboundMessage | null = null;

  constructor(opts: {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredGroups: () => Record<string, unknown>;
  }) {
    this.onMessageFn = opts.onMessage;
  }

  async connect(): Promise<void> {
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    for (const req of this.queue) {
      clearTimeout(req.timer);
      req.resolve(req.chunks);
    }
    this.queue = [];
  }

  isConnected(): boolean {
    return this._connected;
  }

  ownsJid(jid: string): boolean {
    return jid === API_JID;
  }

  async sendMessage(_jid: string, text: string): Promise<void> {
    if (this.queue.length > 0) {
      this.queue[0].chunks.push(text);
    }
  }

  /** Called by processGroupMessages after the agent finishes for API_JID */
  notifyDone(): void {
    const req = this.queue.shift();
    if (req) {
      clearTimeout(req.timer);
      req.resolve(req.chunks);
    }
  }

  /** Injects a message and waits for the agent response */
  async processRequest(content: string): Promise<string[]> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((r) => r.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        logger.warn('API request timed out');
        resolve([]);
      }, REQUEST_TIMEOUT_MS);

      this.queue.push({ chunks: [], resolve, timer });

      // Ensure chat record exists before storing messages (FK constraint)
      storeChatMetadata(API_JID, new Date().toISOString(), 'API', 'api', false);

      const msg: NewMessage = {
        id: randomUUID(),
        chat_jid: API_JID,
        sender: 'api-user',
        sender_name: 'API User',
        content,
        timestamp: new Date().toISOString(),
        is_from_me: true,
      };

      this.onMessageFn?.(API_JID, msg);
    });
  }

  startHttpServer(): void {
    const server = http.createServer(async (req, res) => {
      // CORS headers — allow frontend (port 8080) to call this API
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const send = (status: number, body: object) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      // Bearer token auth (skipped when NANOCLAW_API_KEY is not set)
      if (API_KEY) {
        const auth = (req.headers['authorization'] as string | undefined) ?? '';
        if (auth !== `Bearer ${API_KEY}`) {
          send(401, { error: 'Unauthorized' });
          return;
        }
      }

      // GET /api/health
      if (req.method === 'GET' && req.url === '/api/health') {
        send(200, { status: 'ok' });
        return;
      }

      // POST /api/message  →  { message: string }  →  { response: string, chunks: string[] }
      if (req.method === 'POST' && req.url === '/api/message') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          try {
            const data: unknown = JSON.parse(body);
            if (
              !data ||
              typeof data !== 'object' ||
              !('message' in data) ||
              typeof (data as Record<string, unknown>).message !== 'string'
            ) {
              send(400, { error: '`message` string field required' });
              return;
            }
            const message = (data as { message: string }).message;
            const chunks = await this.processRequest(message);
            send(200, { response: chunks.join('\n\n'), chunks });
          } catch (err: unknown) {
            logger.error({ err }, 'API handler error');
            send(500, { error: String(err) });
          }
        });
        return;
      }

      send(404, { error: 'Not found' });
    });

    server.listen(API_PORT, '127.0.0.1', () => {
      logger.info({ port: API_PORT }, 'API HTTP server listening');
    });

    this.startFrontendServer();
  }

  private startFrontendServer(): void {
    const frontendDir = path.resolve(__dirname, '..', 'frontend');
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    const staticServer = http.createServer((req, res) => {
      const urlPath =
        req.url === '/' ? '/index.html' : (req.url ?? '/index.html');
      const filePath = path.join(frontendDir, urlPath.split('?')[0]);

      // Prevent path traversal
      if (!filePath.startsWith(frontendDir)) {
        res.writeHead(403);
        res.end();
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'text/plain' });
        res.end(data);
      });
    });

    staticServer.listen(FRONTEND_PORT, '0.0.0.0', () => {
      logger.info({ port: FRONTEND_PORT }, 'Frontend static server listening');
    });
  }
}
