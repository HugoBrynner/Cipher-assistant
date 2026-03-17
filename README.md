# Cipher Assistent

Cipher Assistent is a minimal open-source bridge that lets a Telegram bot talk to GitHub Copilot Chat inside VS Code.

It is intentionally small:

- no OpenAI API layer
- no trading modules
- no project-specific logic
- no external model server
- just Telegram, a local Python bot, and a VS Code extension

The goal is simple: make it easy for other people to run a private Telegram-to-VS-Code assistant on their own machine.

## What it does

1. A user sends a message to a Telegram bot.
2. The Python bot receives the message.
3. The bot forwards the request to a local VS Code extension over `127.0.0.1`.
4. The extension opens Copilot Chat in VS Code and submits the prompt.
5. Copilot writes the final answer into a local response file.
6. The extension watches that file and sends the response back to the Python bot.
7. The Python bot sends the answer back to Telegram.

Everything stays local except the normal Telegram and Copilot services you already use.

## Architecture

```text
Telegram
   ↓
Python bot
   ↓ HTTP on localhost
VS Code extension
   ↓
GitHub Copilot Chat
   ↓ writes response file
VS Code file watcher
   ↓ HTTP on localhost
Python bot
   ↓
Telegram
```

## Project structure

```text
cipher-assistent/
├─ bot/
│  ├─ .env.example
│  ├─ bot.py
│  └─ requirements.txt
├─ extension/
│  ├─ .vscodeignore
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ src/
│     ├─ botClient.ts
│     ├─ copilotBridge.ts
│     ├─ extension.ts
│     ├─ fileWatcher.ts
│     ├─ httpServer.ts
│     └─ logger.ts
├─ .gitignore
└─ LICENSE
```

## Requirements

### On your machine

- Windows, macOS, or Linux
- Python 3.11+
- Node.js 18+
- VS Code 1.85+
- A Telegram bot token from BotFather
- GitHub Copilot and GitHub Copilot Chat enabled in VS Code

### VS Code extensions

Install these in VS Code:

- GitHub Copilot
- GitHub Copilot Chat

## Setup

## 1. Clone the repository

```bash
git clone <your-repo-url>
cd cipher-assistent
```

## 2. Configure the Telegram bot

Create `bot/.env` from the example file.

```bash
cp bot/.env.example bot/.env
```

Then fill in:

- `TELEGRAM_TOKEN`
- `ALLOWED_CHAT_IDS`
- optional port overrides if needed

## 3. Install Python dependencies

```bash
cd bot
python -m pip install -r requirements.txt
```

## 4. Install extension dependencies

```bash
cd ../extension
npm install
npm run compile
```

## 5. Open the repository in VS Code

Open the repository root in VS Code.

Then open the `extension` folder and run the extension in Extension Development Host mode if you want to package or debug it.

For a local workflow, you can also compile the extension and install it as a VSIX.

## Running the system

## Step 1. Start the Python bot

From the `bot` folder:

```bash
python bot.py
```

The bot starts:

- the Telegram polling loop
- a local callback server on `127.0.0.1`

## Step 2. Start the VS Code extension

When the extension activates, it starts a local HTTP server and begins watching the response file.

The extension exposes two commands:

- `Cipher Assistent: Start Bridge`
- `Cipher Assistent: Stop Bridge`

By default the bridge auto-starts when the extension activates.

## Step 3. Talk to your bot on Telegram

Send a normal text message to the Telegram bot.

If your chat ID is allowed, the message is forwarded into Copilot Chat and the answer comes back to Telegram.

## Configuration

### Python bot environment variables

| Variable | Required | Default | Description |
|---|---:|---|---|
| `TELEGRAM_TOKEN` | yes | - | Telegram bot token |
| `ALLOWED_CHAT_IDS` | yes | - | Comma-separated list of allowed chat IDs |
| `BOT_SERVER_PORT` | no | `4000` | Local callback server port used by the Python bot |
| `EXT_SERVER_PORT` | no | `3000` | Local HTTP port used by the VS Code extension |
| `REQUEST_TIMEOUT_SECONDS` | no | `600` | Max wait time for a Copilot answer |
| `TYPING_INTERVAL_SECONDS` | no | `4` | Telegram typing indicator refresh interval |
| `RESPONSE_FILE_PATH` | no | workspace-root `cipher_response.txt` | Explicit response file path override |

### VS Code settings

| Setting | Default | Description |
|---|---|---|
| `cipherAssistent.extensionServerPort` | `3000` | Port for the extension HTTP server |
| `cipherAssistent.botServerPort` | `4000` | Port for the Python bot callback server |
| `cipherAssistent.responseFilePath` | empty | Optional absolute override for the response file path |

## Security model

This project is intentionally local-first.

- The Python bot only binds to `127.0.0.1`
- The VS Code extension only binds to `127.0.0.1`
- Telegram access is restricted by `ALLOWED_CHAT_IDS`
- No OpenAI-compatible API server is included
- No project-specific secrets are part of the repository

Still, you should treat this as a personal local bridge and not as a hardened internet-facing service.

## Why this repository exists

The original system lived inside a much larger private workspace with trading modules, experiments, and extra bridges.

This repository strips all of that away and keeps only the reusable core:

- Telegram bot
- local callback server
- VS Code extension
- Copilot response file bridge

That makes it easier for others to understand, run, and adapt.

## Limitations

- It depends on GitHub Copilot Chat being available in VS Code
- It is designed for a single local machine workflow
- It does not include authentication beyond Telegram chat allow-listing
- It does not include conversation history storage
- It does not include model routing or provider abstraction

## Customization ideas

You can extend this starter with:

- per-user sessions
- chat history persistence
- slash commands
- file attachments
- approvals before sending prompts
- multi-workspace routing
- alternative response-file formats

## License

MIT
