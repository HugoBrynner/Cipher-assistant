import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BotClient } from './botClient';
import type { Logger } from './logger';

export class FileWatcher {
    private watcher: vscode.FileSystemWatcher | null = null;
    private readonly responseFilePath: string;
    private readonly logger: Logger;
    private readonly botClient: BotClient;
    private lastHash = '';
    private clearGeneration = 0;

    constructor(responseFilePath: string, logger: Logger, botClient: BotClient) {
        this.responseFilePath = responseFilePath;
        this.logger = logger;
        this.botClient = botClient;
    }

    start(): void {
        this.ensureFileExists();

        const directory = path.dirname(this.responseFilePath);
        const fileName = path.basename(this.responseFilePath);
        const pattern = new vscode.RelativePattern(vscode.Uri.file(directory), fileName);

        this.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, true);
        this.watcher.onDidCreate(() => {
            void this.handleChange();
        });
        this.watcher.onDidChange(() => {
            void this.handleChange();
        });

        this.logger.info('File watcher started', { path: this.responseFilePath });
        void this.handleChange();
    }

    stop(): void {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
            this.logger.info('File watcher stopped');
        }
    }

    private ensureFileExists(): void {
        try {
            if (!fs.existsSync(this.responseFilePath)) {
                fs.writeFileSync(this.responseFilePath, '', { encoding: 'utf-8' });
                this.logger.info('Response file created', { path: this.responseFilePath });
            }
        } catch (error) {
            this.logger.error('Failed to ensure response file exists', { error: String(error) });
        }
    }

    private async handleChange(): Promise<void> {
        const generationAtStart = this.clearGeneration;

        let content = '';
        try {
            content = fs.readFileSync(this.responseFilePath, { encoding: 'utf-8' });
        } catch (error) {
            this.logger.error('Failed to read response file', { error: String(error) });
            return;
        }

        const trimmed = content.trim();
        if (!trimmed) {
            return;
        }

        if (generationAtStart !== this.clearGeneration) {
            this.logger.debug('Skipping stale watcher event after file clear');
            return;
        }

        const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
        if (hash === this.lastHash) {
            return;
        }
        this.lastHash = hash;

        const parsed = this.parseContent(trimmed);
        if (!parsed) {
            this.logger.warn('Response file has unexpected format', {
                preview: trimmed.slice(0, 120),
            });
            return;
        }

        this.clearFile();

        try {
            await this.botClient.sendResponse(parsed);
        } catch (error) {
            this.logger.error('Failed to forward response to Python bot', {
                correlation_id: parsed.correlation_id,
                error: String(error),
            });
        }
    }

    private clearFile(): void {
        this.clearGeneration += 1;
        try {
            fs.writeFileSync(this.responseFilePath, '', { encoding: 'utf-8' });
        } catch (error) {
            this.logger.error('Failed to clear response file', { error: String(error) });
        }
    }

    private parseContent(content: string): { correlation_id: string; response: string } | null {
        const lines = content.split('\n');
        const correlationLine = lines.find((line) => line.startsWith('CORRELATION_ID:'));
        const responseIndex = lines.findIndex((line) => line.trim() === 'RESPONSE:');

        if (!correlationLine || responseIndex === -1) {
            return null;
        }

        const correlation_id = correlationLine.replace('CORRELATION_ID:', '').trim();
        const response = lines.slice(responseIndex + 1).join('\n').trim();

        if (!correlation_id || !response) {
            return null;
        }

        return { correlation_id, response };
    }
}
