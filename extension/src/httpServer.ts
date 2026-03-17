import * as http from 'http';
import type { Logger } from './logger';

export interface InjectPayload {
    readonly correlation_id: string;
    readonly prompt: string;
    readonly chat_id: number;
}

export type InjectHandler = (payload: InjectPayload) => Promise<void>;

export class ExtensionHttpServer {
    private server: http.Server | null = null;
    private readonly host = '127.0.0.1';
    private readonly port: number;
    private readonly logger: Logger;
    private readonly onInject: InjectHandler;

    constructor(port: number, logger: Logger, onInject: InjectHandler) {
        this.port = port;
        this.logger = logger;
        this.onInject = onInject;
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(this.handleRequest.bind(this));
            this.server.once('error', reject);
            this.server.listen(this.port, this.host, () => {
                this.logger.info('Extension HTTP server started', {
                    host: this.host,
                    port: this.port,
                });
                resolve();
            });
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }
            this.server.close(() => {
                this.logger.info('Extension HTTP server stopped');
                resolve();
            });
            this.server = null;
        });
    }

    private handleRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
        if (request.method !== 'POST' || request.url !== '/inject') {
            response.writeHead(404, { 'Content-Type': 'text/plain' });
            response.end('Not found');
            return;
        }

        const chunks: Buffer[] = [];

        request.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        request.on('end', () => {
            try {
                const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                if (!this.isValidPayload(raw)) {
                    response.writeHead(400, { 'Content-Type': 'text/plain' });
                    response.end('Invalid payload shape');
                    return;
                }

                response.writeHead(200, { 'Content-Type': 'text/plain' });
                response.end('OK');

                this.onInject(raw).catch((error: unknown) => {
                    this.logger.error('Inject handler failed', { error: String(error) });
                });
            } catch (error) {
                this.logger.error('Failed to parse request body', { error: String(error) });
                response.writeHead(400, { 'Content-Type': 'text/plain' });
                response.end('Invalid JSON');
            }
        });

        request.on('error', (error: Error) => {
            this.logger.error('Incoming request error', { error: error.message });
            if (!response.headersSent) {
                response.writeHead(500, { 'Content-Type': 'text/plain' });
                response.end('Internal server error');
            }
        });
    }

    private isValidPayload(raw: unknown): raw is InjectPayload {
        if (typeof raw !== 'object' || raw === null) {
            return false;
        }
        const payload = raw as Record<string, unknown>;
        return (
            typeof payload['correlation_id'] === 'string' &&
            typeof payload['prompt'] === 'string' &&
            typeof payload['chat_id'] === 'number'
        );
    }
}
