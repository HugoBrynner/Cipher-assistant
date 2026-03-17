import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BotClient } from './botClient';
import { CopilotBridge } from './copilotBridge';
import { FileWatcher } from './fileWatcher';
import { ExtensionHttpServer } from './httpServer';
import type { InjectPayload } from './httpServer';
import { Logger } from './logger';

const OUTPUT_CHANNEL_NAME = 'Cipher Assistent';

let outputChannel: vscode.OutputChannel | undefined;
let logger: Logger | undefined;
let httpServer: ExtensionHttpServer | undefined;
let fileWatcher: FileWatcher | undefined;

function getLogger(): Logger {
    if (!logger) {
        throw new Error('Logger not initialized');
    }
    return logger;
}

function getResponseFilePath(): string {
    const envOverride = process.env.RESPONSE_FILE_PATH;
    if (envOverride && envOverride.trim()) {
        return envOverride.trim();
    }

    const config = vscode.workspace.getConfiguration('cipherAssistent');
    const configuredPath = config.get<string>('responseFilePath', '').trim();
    if (configuredPath) {
        return configuredPath;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return path.join(folders[0].uri.fsPath, 'cipher_response.txt');
    }

    return path.join(os.tmpdir(), 'cipher_response.txt');
}

function getConfig(): { extensionPort: number; botPort: number } {
    const config = vscode.workspace.getConfiguration('cipherAssistent');
    const envExtensionPort = Number(process.env.EXT_SERVER_PORT || '');
    const envBotPort = Number(process.env.BOT_SERVER_PORT || '');

    return {
        extensionPort:
            Number.isFinite(envExtensionPort) && envExtensionPort > 0
                ? envExtensionPort
                : config.get<number>('extensionServerPort', 3000),
        botPort:
            Number.isFinite(envBotPort) && envBotPort > 0
                ? envBotPort
                : config.get<number>('botServerPort', 4000),
    };
}

async function startBridge(context: vscode.ExtensionContext): Promise<void> {
    if (httpServer) {
        vscode.window.showWarningMessage('Cipher Assistent bridge is already running.');
        return;
    }

    const log = getLogger();
    const { extensionPort, botPort } = getConfig();
    const responseFilePath = getResponseFilePath();

    const botClient = new BotClient(botPort, log);
    const copilotBridge = new CopilotBridge(log);

    const onInject = async (payload: InjectPayload): Promise<void> => {
        log.info('Inject request received', { correlation_id: payload.correlation_id });
        await copilotBridge.injectMessage(payload.prompt);
    };

    httpServer = new ExtensionHttpServer(extensionPort, log, onInject);
    await httpServer.start();

    fileWatcher = new FileWatcher(responseFilePath, log, botClient);
    fileWatcher.start();

    context.subscriptions.push({
        dispose: () => {
            void stopBridge();
        },
    });

    vscode.window.showInformationMessage(
        `Cipher Assistent bridge started on port ${extensionPort}`
    );
}

async function stopBridge(): Promise<void> {
    if (fileWatcher) {
        fileWatcher.stop();
        fileWatcher = undefined;
    }

    if (httpServer) {
        await httpServer.stop();
        httpServer = undefined;
    }

    logger?.info('Cipher Assistent bridge stopped');
}

export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    logger = new Logger('cipher-assistent', outputChannel);
    logger.info('Cipher Assistent extension activated');

    const startCommand = vscode.commands.registerCommand('cipherAssistent.startBridge', () => {
        startBridge(context).catch((error: unknown) => {
            getLogger().error('Failed to start bridge', { error: String(error) });
            vscode.window.showErrorMessage(`Cipher Assistent failed to start: ${String(error)}`);
        });
    });

    const stopCommand = vscode.commands.registerCommand('cipherAssistent.stopBridge', () => {
        stopBridge().catch((error: unknown) => {
            getLogger().error('Failed to stop bridge', { error: String(error) });
        });
    });

    context.subscriptions.push(outputChannel, startCommand, stopCommand);

    startBridge(context).catch((error: unknown) => {
        getLogger().error('Auto-start failed', { error: String(error) });
    });
}

export function deactivate(): Thenable<void> {
    return stopBridge();
}
