from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import uuid
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web
from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(Path(__file__).with_name('.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('cipher.bot')


def require_env(name: str) -> str:
    value = os.getenv(name, '').strip()
    if not value:
        raise EnvironmentError(f"Required environment variable '{name}' is not set.")
    return value


TELEGRAM_TOKEN = require_env('TELEGRAM_TOKEN')
ALLOWED_CHAT_IDS = frozenset(
    int(value.strip())
    for value in require_env('ALLOWED_CHAT_IDS').split(',')
    if value.strip()
)
BOT_SERVER_HOST = '127.0.0.1'
BOT_SERVER_PORT = int(os.getenv('BOT_SERVER_PORT', '4000'))
EXT_SERVER_HOST = '127.0.0.1'
EXT_SERVER_PORT = int(os.getenv('EXT_SERVER_PORT', '3000'))
REQUEST_TIMEOUT_SECONDS = float(os.getenv('REQUEST_TIMEOUT_SECONDS', '600'))
TYPING_INTERVAL_SECONDS = float(os.getenv('TYPING_INTERVAL_SECONDS', '4'))
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0
RETRY_MAX_DELAY = 30.0

_pending: dict[str, asyncio.Future[str]] = {}


def get_response_file_path() -> str:
    override = os.getenv('RESPONSE_FILE_PATH', '').strip()
    if override:
        return override
    return str(ROOT_DIR / 'cipher_response.txt')


def build_prompt(correlation_id: str, user_message: str, response_file_path: str) -> str:
    return (
        f'{user_message}\n\n'
        '---\n'
        'AGENT INSTRUCTION (mandatory — you MUST follow this exactly):\n'
        'You are replying to a Telegram user through a local VS Code bridge. '
        'When your answer is complete, overwrite the file at the path below with '
        'EXACTLY the following format and nothing else:\n\n'
        f'  File: {response_file_path}\n\n'
        '  Content:\n'
        f'  CORRELATION_ID: {correlation_id}\n'
        '  RESPONSE:\n'
        '  <your complete answer>\n\n'
        'Rules:\n'
        '- Overwrite the file completely (do NOT append).\n'
        '- Include the CORRELATION_ID line and the RESPONSE: header exactly as shown.\n'
        '- Do not add any text before CORRELATION_ID.'
    )


async def send_to_extension(
    session: aiohttp.ClientSession,
    correlation_id: str,
    prompt: str,
    chat_id: int,
) -> None:
    url = f'http://{EXT_SERVER_HOST}:{EXT_SERVER_PORT}/inject'
    payload: dict[str, Any] = {
        'correlation_id': correlation_id,
        'prompt': prompt,
        'chat_id': chat_id,
    }

    last_error: Exception = RuntimeError('Unknown error')
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with session.post(url, json=payload, timeout=timeout) as response:
                if response.status == 200:
                    log.info('Prompt forwarded to extension', extra={'correlation_id': correlation_id})
                    return
                last_error = RuntimeError(f'Extension returned HTTP {response.status}')
        except Exception as exc:
            last_error = exc
            log.warning('Failed to reach extension', extra={'attempt': attempt, 'error': str(exc)})

        if attempt < MAX_RETRIES:
            delay = min(RETRY_BASE_DELAY * (2 ** (attempt - 1)), RETRY_MAX_DELAY)
            await asyncio.sleep(delay)

    raise RuntimeError(f'Extension unreachable after {MAX_RETRIES} attempts: {last_error}')


async def dispatch_prompt_and_wait(correlation_id: str, prompt: str, chat_id: int) -> str:
    loop = asyncio.get_event_loop()
    future: asyncio.Future[str] = loop.create_future()
    _pending[correlation_id] = future

    try:
        async with aiohttp.ClientSession() as session:
            await send_to_extension(session, correlation_id, prompt, chat_id)
        return await asyncio.wait_for(future, timeout=REQUEST_TIMEOUT_SECONDS)
    finally:
        _pending.pop(correlation_id, None)


async def typing_loop(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
        except Exception as exc:
            log.debug('Failed to send typing action', extra={'error': str(exc)})

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=TYPING_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue


async def handle_response(request: web.Request) -> web.Response:
    try:
        data: dict[str, Any] = await request.json()
        correlation_id = str(data['correlation_id'])
        response_text = str(data['response'])
    except Exception as exc:
        return web.Response(status=400, text=f'Bad request: {exc}')

    future = _pending.get(correlation_id)
    if future is None:
        return web.Response(status=404, text='Unknown correlation_id')

    if not future.done():
        future.set_result(response_text)
    return web.Response(status=200, text='OK')


async def handle_health(_: web.Request) -> web.Response:
    return web.json_response(
        {
            'ok': True,
            'bot_port': BOT_SERVER_PORT,
            'extension_port': EXT_SERVER_PORT,
            'response_file_path': get_response_file_path(),
        }
    )


def build_web_app() -> web.Application:
    app = web.Application()
    app.router.add_get('/health', handle_health)
    app.router.add_post('/response', handle_response)
    return app


async def on_start(update: Update, _: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_chat is None:
        return

    if update.effective_chat.id not in ALLOWED_CHAT_IDS:
        await update.message.reply_text('Unauthorized.')
        return

    await update.message.reply_text(
        'Cipher Assistent is online. Send a message and I will forward it to VS Code.'
    )


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_chat is None:
        return

    chat_id = update.effective_chat.id
    if chat_id not in ALLOWED_CHAT_IDS:
        await update.message.reply_text('Unauthorized.')
        return

    user_text = (update.message.text or '').strip()
    if not user_text:
        await update.message.reply_text('Empty message ignored.')
        return

    correlation_id = str(uuid.uuid4())
    prompt = build_prompt(correlation_id, user_text, get_response_file_path())

    typing_stop_event = asyncio.Event()
    typing_task = asyncio.create_task(typing_loop(context, chat_id, typing_stop_event))

    try:
        response_text = await dispatch_prompt_and_wait(correlation_id, prompt, chat_id)
        await update.message.reply_text(response_text)
    except RuntimeError as exc:
        await update.message.reply_text(f'Could not reach the VS Code extension: {exc}')
    except asyncio.TimeoutError:
        await update.message.reply_text('Request timed out while waiting for Copilot.')
    except Exception as exc:
        log.exception('Unexpected error while handling Telegram message')
        await update.message.reply_text(f'Internal error: {exc}')
    finally:
        typing_stop_event.set()
        typing_task.cancel()
        try:
            await typing_task
        except asyncio.CancelledError:
            pass


async def main() -> None:
    log.info('Starting Cipher Assistent bot')

    web_app = build_web_app()
    runner = web.AppRunner(web_app)
    await runner.setup()
    site = web.TCPSite(runner, BOT_SERVER_HOST, BOT_SERVER_PORT)
    await site.start()

    telegram_app = Application.builder().token(TELEGRAM_TOKEN).build()
    telegram_app.add_handler(CommandHandler('start', on_start))
    telegram_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))

    stop_event = asyncio.Event()

    def on_shutdown_signal() -> None:
        log.info('Shutdown signal received')
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, on_shutdown_signal)
        except NotImplementedError:
            signal.signal(sig, lambda *_: on_shutdown_signal())

    async with telegram_app:
        await telegram_app.start()
        await telegram_app.updater.start_polling(allowed_updates=Update.ALL_TYPES)
        log.info('Telegram polling started')
        await stop_event.wait()
        await telegram_app.updater.stop()
        await telegram_app.stop()

    await runner.cleanup()
    log.info('Cipher Assistent bot stopped')


if __name__ == '__main__':
    asyncio.run(main())
