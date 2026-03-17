import * as vscode from 'vscode';
import type { Logger } from './logger';

export class CopilotBridge {
    private readonly logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async injectMessage(prompt: string): Promise<void> {
        this.logger.info('Injecting prompt into Copilot Chat');
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: prompt,
                isPartialQuery: false,
            });

            try {
                await vscode.commands.executeCommand('workbench.action.chat.submit');
            } catch (submitError) {
                this.logger.debug('chat.submit command unavailable or failed', {
                    error: String(submitError),
                });
            }

            this.logger.info('Prompt sent to Copilot Chat');
        } catch (error) {
            this.logger.error('Failed to inject prompt into Copilot Chat', {
                error: String(error),
            });
            throw error;
        }
    }
}
