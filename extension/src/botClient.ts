import * as http from 'http';
import type { Logger } from './logger';

export interface ResponsePayload {
    readonly correlation_id: string;
    readonly response: string;
}

export class BotClient {
    private readonly host = '127.0.0.1';
    private readonly port: number;
    private readonly logger: Logger;
    private readonly timeoutMs = 10000;

    constructor(port: number, logger: Logger) {
        this.port = port;
        this.logger = logger;
    }

    sendResponse(payload: ResponsePayload): Promise<void> {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify(payload);
            const request = http.request(
                {
                    hostname: this.host,
                    port: this.port,
                    path: '/response',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                    },
                },
                (response) => {
                    response.resume();
                    if (response.statusCode === 200) {
                        this.logger.info('Response forwarded to Python bot', {
                            correlation_id: payload.correlation_id,
                        });
                        resolve();
                        return;
                    }
                    reject(new Error(`Bot server returned HTTP ${response.statusCode ?? 'unknown'}`));
                }
            );

            request.setTimeout(this.timeoutMs, () => {
                request.destroy(new Error('Request to Python bot timed out'));
            });

            request.on('error', (error: Error) => {
                reject(error);
            });

            request.write(body);
            request.end();
        });
    }
}
