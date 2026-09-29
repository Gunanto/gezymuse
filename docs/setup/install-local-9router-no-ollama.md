---
title: Local laptop installation with 9Router and no Ollama
audience: [owner]
purpose: Reproducible installation guide for this Ubuntu laptop using 9Router as Muse's model gateway
updated: 2026-09-29
related: [../evaluations/product-messaging-audit-2026-09-29.md, ENV.md, remote-access.md]
---

# Install Muse on this laptop with 9Router and no Ollama

This is the installation path for the current laptop and checkout:

- repository: `/home/pgun/dev/gezy/gezymuse`
- Ubuntu Linux, 4 logical CPU threads, about 8 GB RAM, Intel HD Graphics 520
- Node.js `v22.23.2` and pnpm `10.18.0` already installed
- 9Router `0.5.55` already running on port `20128`
- no Ollama installation and no local model download
- optional Telegram bot after the basic Muse chat path works

The intended request path is:

```text
Muse -> http://127.0.0.1:20128/v1 -> 9Router -> selected upstream model
```

## Current installation state on this laptop

The installation described by this guide was completed on 2026-09-29:

- Muse CLI `0.3.0` is linked at `/home/pgun/.local/share/pnpm/muse`.
- The active model is `openai-compatible/cx/gpt-5.6-luna` through the local 9Router endpoint.
- The 9Router credential is stored in encrypted `~/.muse/models.json`; the non-secret settings
  are in `~/.config/muse/9router.env`, both with mode `600`.
- `gezymuse.service` is enabled as a user-level systemd service and serves the web application at
  `http://127.0.0.1:3030`.
- A live read-only chat successfully called `muse.tasks.list`, `muse.tasks.search`, and
  `muse.context.fetch` through 9Router.
- Ollama was not installed or started.
- Telegram remains optional and is not configured because it requires an owner-created bot token
  and one-time owner pairing.

This checkout also contains a local OpenAI-compatible adapter fix for Muse's dotted tool names.
9Router's Codex route accepts only letters, digits, underscores, and hyphens in function names,
while Muse uses names such as `muse.tasks`. The adapter now sends a safe temporary alias and maps
the returned call back to the original Muse name. Keep this change when updating or reinstalling
until the upstream Muse repository includes an equivalent fix.

Muse itself runs locally, but model prompts leave the laptop whenever 9Router routes them to a
remote provider. Telegram also requires network access. This setup therefore uses
`MUSE_LOCAL_ONLY=false`.

## What works without Ollama

| Capability | Expected status | Requirement or limitation |
|---|---|---|
| CLI and web chat | Yes | A working 9Router model with OpenAI-compatible chat completions |
| Agent tools, tasks, reminders, calendar and contacts | Yes | Choose a model that supports OpenAI-style tool calls |
| Telegram bot | Yes, after setup | Muse must remain running; Telegram polling and inbound replies must be enabled |
| Local notes, exact data and deterministic tools | Generally yes | Paths that do not require semantic embeddings remain available |
| Semantic notes search and RAG | No | Muse's current embedding path calls Ollama's `/api/embeddings` |
| Embedding-based recall, related knowledge and some reflection retrieval | No or degraded | These features need an embedder that this setup deliberately does not install |
| Local image understanding through the documented Gemma/Ollama path | No | Do not use the Ollama-specific image path in this setup |

9Router exposes an OpenAI-compatible embeddings endpoint, but this Muse revision does not wire its
semantic embedder to that endpoint. Supporting it requires a Muse code change. It would also send
the text being embedded to 9Router or its upstream provider.

## 1. Check 9Router before installing Muse

Open the 9Router dashboard:

```text
http://127.0.0.1:20128/dashboard
```

In the dashboard:

1. Confirm that at least one upstream provider is connected.
2. Copy or create a 9Router API key.
3. Record the exact model ID to use, for example `cc/claude-sonnet-4-6` or `auto`. The available
   IDs depend on the providers configured in 9Router; do not assume an example ID exists.
4. Prefer a model that explicitly supports tool calling. Plain chat compatibility alone is not
   enough for the full Muse agent loop.

Check the local process without exposing the API key:

```bash
curl -fsS http://127.0.0.1:20128/api/health
ss -ltnp | rg ':20128'
```

The health response should contain `"ok":true`. The current 9Router process listens on
`0.0.0.0:20128`. If no other device needs the gateway, stop it using its existing terminal or
tray control and restart it on loopback only:

```bash
9router --host 127.0.0.1 --port 20128 --no-browser
```

Do not run a second copy on the same port. 9Router keeps its own state under `~/.9router`; preserve
that directory when changing how it starts.

Test authentication and obtain the model list without placing the key in shell history:

```bash
read -rsp '9Router API key: ' NINEROUTER_KEY; echo
curl -fsS --max-time 15 \
  -H "Authorization: Bearer ${NINEROUTER_KEY}" \
  http://127.0.0.1:20128/v1/models
unset NINEROUTER_KEY
```

Stop here if this returns `401`, times out, or does not list the intended model. Fix 9Router first;
Muse cannot compensate for a gateway that is not ready.

## 2. Make the source checkout installable

The Muse source installer deliberately requires:

- branch `main`
- a completely clean Git working tree

Check both:

```bash
cd /home/pgun/dev/gezy/gezymuse
git branch --show-current
git status --short
```

This checkout currently contains local documentation changes, including this guide and the product
audit. Preserve them before installation. The preferred option is to commit the documentation to
the local branch. If it should not become a commit, stash it including untracked files, run the
installer, and restore it afterward:

```bash
git stash push --include-untracked -m 'local Muse documentation before install'
# Run the installation commands in the next section.
git stash pop
```

Do not use `git clean`, `git reset --hard`, or discard the documentation just to satisfy the clean
checkout check.

## 3. Install Muse from this checkout

The required Node.js and pnpm versions are already present. Verify them, preview the installer, and
then install:

```bash
cd /home/pgun/dev/gezy/gezymuse
node --version
pnpm --version
pnpm install:muse -- --dry-run
pnpm install:muse
```

The installer initializes Git submodules, installs the locked dependencies, builds the workspace,
links the `muse` CLI globally, and checks its version. It can take several minutes and use noticeable
memory during the build. Close memory-heavy applications during this one-time step.

Before the installer initializes submodules, `pnpm check:doc-links` can report missing AttuneGraph
targets. Those repository links are supplied by the submodule and are unrelated to 9Router.

Verify the CLI:

```bash
command -v muse
muse --version
```

If `pnpm install:muse` reports that the pnpm global bin directory is missing, run:

```bash
pnpm setup
```

Then start a new terminal, return to the repository, and repeat the dry run and installation.

Do not run `muse setup local`; that command is the Ollama setup path. The generic `muse onboard`
flow also assumes the usual local-model path, so finish the 9Router configuration below first.

## 4. Configure the 9Router adapter

Create a file containing only non-secret settings:

```bash
install -d -m 700 ~/.config/muse
${EDITOR:-nano} ~/.config/muse/9router.env
```

Put this content in the file and replace `<EXACT_9ROUTER_MODEL_ID>`:

```bash
MUSE_MODEL_PROVIDER_ID=openai-compatible
MUSE_MODEL_BASE_URL=http://127.0.0.1:20128/v1
MUSE_MODEL=openai-compatible/<EXACT_9ROUTER_MODEL_ID>
MUSE_LOCAL_ONLY=false
MUSE_CREDENTIALS_ENCRYPT=true
```

Examples:

```bash
MUSE_MODEL=openai-compatible/cc/claude-sonnet-4-6
MUSE_MODEL=openai-compatible/auto
```

The `openai-compatible/` prefix is required. Muse removes the first path segment before sending
the request, so `openai-compatible/cc/claude-sonnet-4-6` reaches 9Router as
`cc/claude-sonnet-4-6`. Setting only `cc/claude-sonnet-4-6` would remove `cc/` and send the wrong
model ID.

Protect and load the file:

```bash
chmod 600 ~/.config/muse/9router.env
set -a
. ~/.config/muse/9router.env
set +a
```

To load these non-secret settings in future interactive shells, add this line once to `~/.bashrc`:

```bash
[ -r "$HOME/.config/muse/9router.env" ] && set -a && . "$HOME/.config/muse/9router.env" && set +a
```

### Store the 9Router API key encrypted

Do not put the API key in `9router.env`, `.bashrc`, this repository, shell command arguments, or a
service file. With the environment above loaded, run:

```bash
muse setup model
```

Choose **OpenAI** in the wizard and enter the **9Router API key** at the hidden prompt. This use of
the OpenAI entry is intentional: Muse's generic OpenAI-compatible adapter accepts `OPENAI_API_KEY`
as its fallback credential, while the explicit variables above keep the provider, endpoint and
model pointed at 9Router.

`MUSE_CREDENTIALS_ENCRYPT=true` causes the wizard to write an encrypted `~/.muse/models.json`
instead of a plaintext credential file. On this laptop, without an explicit `MUSE_MEMORY_KEY`, the
encryption key is derived from the current Linux username, home directory and hostname. Renaming
the machine, changing the username, or moving the file to another computer can make it unreadable;
create a fresh 9Router key on the new machine instead of copying this credential store.

Confirm that the file is encrypted without printing its contents:

```bash
stat -c '%a %n' ~/.muse/models.json
node -e 'const x=require(process.env.HOME+"/.muse/models.json"); console.log(x.algorithm ?? "NOT ENCRYPTED")'
```

Expected results are mode `600` and `aes-256-gcm`.

## 5. Run the first smoke test

Start with chat only so an unrelated tool or embedding path cannot hide basic model connectivity:

```bash
set -a
. ~/.config/muse/9router.env
set +a

muse chat --local --no-tools 'Reply with exactly: Muse via 9Router works.'
```

Then inspect setup health:

```bash
muse setup
muse doctor
```

An Ollama or embedding warning is expected in this installation. On Linux, `muse doctor` also
reports the resident daemon as failed because Muse only implements native resident-daemon
registration for macOS; it cannot recognize the custom user-level systemd service used below.
Verify that service with `systemctl --user is-active gezymuse.service`, `muse serve --status`, and
the `/health` endpoint instead. The endpoint can report `network-unverified` while the API itself
is healthy; the live chat test is the network/model proof for this setup. A 9Router authentication
failure, unknown model, or chat-completions error is not expected and must be fixed before
continuing.

Run a second chat with tools enabled:

```bash
muse chat --local 'List my current tasks. Do not create, edit, or delete anything.'
```

This checks that the selected upstream model can handle the OpenAI-compatible tool schema. If plain
chat works but this request fails around tool calls, select a different 9Router model with explicit
tool-calling support.

## 6. Start the web application

Run Muse in the foreground first:

```bash
set -a
. ~/.config/muse/9router.env
set +a
muse serve
```

In another terminal:

```bash
muse serve --status
curl -fsS http://127.0.0.1:3030/health
```

Open `http://127.0.0.1:3030` in the laptop browser. Keep the server bound to loopback unless remote
access has been configured deliberately. The repository's [remote-access guide](remote-access.md)
uses Tailscale when phone access to the web UI is needed.

## 7. Optional: connect a Telegram bot

Telegram is supported, but it is not active immediately after Muse installation. Complete the
basic chat and web smoke tests first.

1. Create a bot through Telegram's `@BotFather` and copy its token.
2. Load the 9Router environment and run the messaging wizard:

   ```bash
   set -a
   . ~/.config/muse/9router.env
   set +a
   muse setup messaging
   ```

3. Select **Telegram** and enter the token at the hidden prompt. Because
   `MUSE_CREDENTIALS_ENCRYPT=true` is loaded, the messaging credential store is encrypted at rest.
4. Add these non-secret settings to `~/.config/muse/9router.env`:

   ```bash
   MUSE_TELEGRAM_POLL_ENABLED=true
   MUSE_INBOUND_REPLY_ENABLED=true
   MUSE_TELEGRAM_BOT_USERNAME=gezyt_bot
   MUSE_TELEGRAM_ALLOWED_USER_IDS=6468143001
   ```

   For a Telegram group, enable the group explicitly and allow only its exact
   chat ID. For the configured AI Enthusiasts Hub group, add:

   ```bash
   MUSE_CHANNEL_GROUP_ENABLED=true
   MUSE_CHANNEL_ALLOWED_CHATS=telegram:-1003743752144
   ```

   Telegram Forum messages carry a topic ID; this revision preserves that ID
   so Muse sends the acknowledgement and final answer back into the same
   topic. A group remains shared context and never becomes the private owner
   chat. In that group Muse stays silent unless the message mentions
   `@gezyt_bot` or replies to a bot message. Private Telegram DMs do not need
   a mention or reply. `MUSE_TELEGRAM_ALLOWED_USER_IDS` is the numeric Telegram
   user ID from the paired owner account. In a shared chat, messages from any
   other account are consumed silently even when they mention or reply to the bot.

5. Reload the file and restart `muse serve`:

   ```bash
   set -a
   . ~/.config/muse/9router.env
   set +a
   muse serve
   ```

6. In a second terminal, verify the provider and obtain a one-time pairing code:

   ```bash
   set -a
   . ~/.config/muse/9router.env
   set +a
   muse messaging providers --local
   muse messaging pairing-code telegram
   ```

7. Send that exact pairing code to the bot from the private Telegram account that will own it.
   Pairing prevents the first stranger who finds the bot from claiming it.
8. Send a normal message to the bot and watch the `muse serve` terminal for polling or model errors.

The bot works only while all three components are available: Internet access, 9Router, and
`muse serve`. Do not run multiple Telegram pollers for the same bot token; Telegram will report a
conflicting `getUpdates` request.

### Keep Muse running after the foreground test

On Linux, `muse serve --install` is not implemented. After the foreground setup works, a user-level
systemd service can keep Muse running. First print the real executable path:

```bash
command -v muse
```

Create `~/.config/systemd/user/gezymuse.service` and replace
`<ABSOLUTE_PATH_FROM_COMMAND_V_MUSE>` with that exact output:

```ini
[Unit]
Description=GezyMuse personal assistant
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/muse/9router.env
ExecStart=<ABSOLUTE_PATH_FROM_COMMAND_V_MUSE> serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Then enable it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now gezymuse.service
systemctl --user status gezymuse.service
journalctl --user -u gezymuse.service -n 100 --no-pager
```

9Router must also be running before Muse needs a model response. Keep using 9Router's existing
startup method, preferably bound to `127.0.0.1`.

## 8. Laptop-specific operating notes

- Do not install Ollama or download a local LLM for this setup. The laptop has about 8 GB RAM and
  previously showed unacceptable resource use even with a small Ollama model.
- Let 9Router's upstream provider do inference. 9Router itself remains a lightweight local gateway.
- Leave optional background review, browser automation, multi-agent work and heavy indexing off
  until basic chat and Telegram are stable.
- For the lightest interactive path, use `muse chat --local --no-tools`; enable tools only when they
  are needed.
- During the initial build, close browsers, Docker workloads and other memory-heavy programs. The
  build is temporary; normal Muse operation should be lighter because no model weights are loaded.
- Check pressure with `free -h` and `ps -eo pid,comm,rss,%mem --sort=-rss | head`.
- Prompts, selected personal context and tool schemas may be sent through 9Router to its configured
  upstream. Review that provider's retention and pricing policy before adding sensitive notes.
- `MUSE_LOCAL_ONLY=false` is necessary for this route and for Telegram. A loopback 9Router URL does
  not make the upstream inference local.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Installer rejects the checkout | Branch is not `main` or Git status is dirty | Preserve local files in a commit or stash, then rerun the dry run |
| `pnpm setup` or global link fails | pnpm global bin is not configured | Run `pnpm setup`, open a new terminal, and retry |
| `401 Unauthorized` from `/v1/models` or Muse | Wrong, missing or revoked 9Router key | Create/copy a valid key in the dashboard, then rerun encrypted `muse setup model` |
| `404` for chat completions | Base URL is wrong | Use exactly `http://127.0.0.1:20128/v1`; Muse appends `/chat/completions` |
| Unknown model or model not found | Wrong prefix or stale 9Router model ID | Query `/v1/models` and set `MUSE_MODEL=openai-compatible/<exact-id>` |
| Plain chat works but agent tools fail | Selected model does not implement compatible tool calls | Switch to a 9Router model that advertises OpenAI-style tool calling |
| Notes search mentions Ollama or embeddings | Current semantic embedder is Ollama-specific | Accept the limitation and avoid semantic/RAG commands; ordinary chat still uses 9Router |
| Telegram provider exists but does not receive messages | Polling disabled, Muse stopped, or another poller owns the token | Enable both flags, keep one `muse serve` running, and inspect its log |
| Telegram receives but does not answer | Inbound reply disabled, owner not paired, or model request failed | Enable inbound replies, pair the owner, then check 9Router and Muse logs |
| Encrypted credential file cannot be opened | Username, home path or hostname changed | Restore the original host identity or create new provider/bot keys and rerun setup |

## Update and remove

Updates use the same clean-`main` requirement:

```bash
cd /home/pgun/dev/gezy/gezymuse
git status --short
muse update
```

Remove only the globally linked CLI with:

```bash
pnpm --global remove @muse/cli
```

That command does not remove the source checkout, 9Router, or data under `~/.muse`.
