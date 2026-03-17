import * as vscode from 'vscode';

export interface LogEntry {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: Record<string, unknown>;
}

export class Logger {
    private readonly name: string;
    private readonly channel: vscode.OutputChannel;

    constructor(name: string, channel: vscode.OutputChannel) {
        this.name = name;
        this.channel = channel;
    }

    private emit(entry: LogEntry): void {
        const timestamp = new Date().toISOString();
        const details = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
        const line = `${timestamp} [${entry.level.toUpperCase().padEnd(5)}] ${this.name}: ${entry.message}${details}`;
        this.channel.appendLine(line);
        if (entry.level === 'error') {
            console.error(line);
        }
    }

    debug(message: string, data?: Record<string, unknown>): void {
        this.emit({ level: 'debug', message, data });
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.emit({ level: 'info', message, data });
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.emit({ level: 'warn', message, data });
    }

    error(message: string, data?: Record<string, unknown>): void {
        this.emit({ level: 'error', message, data });
    }
}
