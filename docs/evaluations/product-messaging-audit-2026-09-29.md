---
title: Muse product and messaging audit
audience: [owner, product, developers]
purpose: Explain what Muse currently is, how it can be used, and whether Telegram or WhatsApp can serve as its bot interface
date: 2026-09-29
revision: 5188027103eb743ec700126dabd1fdd1d6634dce
---

# Muse product and messaging audit

## Executive assessment

Muse is a provider-neutral personal AI conductor for one owner and one private control plane. It
combines an LLM with local personal stores, grounded retrieval, continuity, guarded tools,
automations, and messaging channels. It is not designed as a shared team chatbot or a multi-tenant
SaaS backend.

The repository contains a usable personal-assistant product across CLI, web/API, scheduled jobs,
and messaging. Its strongest current uses are grounded answers over personal material, task and
calendar assistance, explicit continuity threads, and owner-controlled automations. The complete
Attunement experience—Shadow Muse, automatically surfaced Continuity Capsules, and mature Policy
Cards—remains partly built and must not be presented as finished.

Telegram support already exists in the runtime and is the shortest route to operating Muse as a
chat bot. The current checkout cannot be used immediately after cloning because it has not been
installed, its AttuneGraph submodule is not initialized, no model is configured, and no Telegram
bot token or owner pairing exists.

WhatsApp is architecturally feasible but is not currently implemented. A production integration
requires more than adding an HTTP adapter because the WhatsApp Business Platform's opt-in,
24-hour service window, message-template, webhook, and human-escalation rules must become
deterministic runtime policy.

## What Muse is

The repository's binding product brief defines Muse as a personal system for one user. The main
runtime keeps provider-specific model and messaging code at the edges while the core agent loop
remains provider-neutral.

The current product can be used for:

- conversational assistance through the CLI or local web console;
- answers grounded in personal notes and memory, with resolvable citations on supported grounded
  paths;
- local notes, tasks, reminders, contacts, calendar events, and conversation history;
- explicit continuity threads that preserve a stopping point, linked sources, a proposed next
  step, and an owner-recorded outcome;
- scheduled reminders, briefings, digests, proactive suggestions, and owner-controlled flows;
- guarded browser and tool actions with traces, checkpoints, approval gates, and bounded loops;
- read-only grounded recall for other agents through MCP; and
- messaging through Telegram, Discord, Slack, LINE, Matrix, local logs, and native desktop
  notifications.

The same agent runtime is shared by the CLI, web/API, messaging replies, and scheduled work. This
means a Telegram conversation is intended to retain the same model, memory, policy, and tool
boundaries as the other surfaces rather than becoming a separate lightweight bot.

## Current maturity and boundaries

The repository is in continuous development. The checkout audited here is on `main` at commit
`5188027103eb743ec700126dabd1fdd1d6634dce`, 72 commits after tag `v0.3.0`.

The practical maturity boundary is:

| Area | Assessment |
| --- | --- |
| Local personal stores, memory, and grounded recall | Implemented, with explicit limits around fast uncited chat |
| Tasks, notes, reminders, contacts, and calendar | Implemented across CLI and API surfaces |
| Explicit continuity threads and packs | Implemented end to end |
| CLI and local web console | Implemented |
| Guarded tools, traces, and approvals | Implemented and central to the architecture |
| Messaging providers | Implemented for Telegram, Discord, Slack, LINE, and Matrix, with provider-specific inbound mechanisms |
| Two-way channel conversation | Implemented in source but opt-in and operationally dependent on polling/webhook and reply flags |
| Shadow Muse and Policy Card closed loop | Partial; several automatic-learning and automatic-surfacing claims remain roadmap work |
| Multi-user or shared workspace operation | Outside the product design |

Personal data is file-backed by default. Local storage does not imply encrypted storage: memory,
episodes, action logs, contacts, and playbooks have opt-in encryption paths, while tasks, reminders,
and notes are not yet covered by that feature. Full-disk encryption remains relevant for a real
deployment.

`MUSE_LOCAL_ONLY=true` is a strict egress posture. It blocks remote model and remote messaging
providers in code. A deployment may use Ollama as its local model and Telegram as its remote chat
transport, but it must leave strict local-only mode disabled because Telegram necessarily sends
data to Telegram's servers.

## State of this local checkout

The following observations apply to `/home/pgun/dev/gezy/gezymuse` at the audit date:

| Check | Result | Consequence |
| --- | --- | --- |
| Git branch | Clean `main`, tracking `origin/main` | Source is ready for setup work |
| Node.js | `v22.23.2` | Meets the base `>=22.12` requirement |
| pnpm | `10.18.0` | Matches the workspace's pnpm 10 expectation |
| Dependencies | `node_modules` absent | CLI, API, build, and tests cannot run yet |
| AttuneGraph | Git submodule uninitialized | The workspace source graph is incomplete until initialized |
| Muse CLI | Not installed on `PATH` | `muse` commands are not currently available |
| Ollama | Not installed on `PATH` | The documented default local-model path is unavailable |
| Muse configuration | No `~/.config/muse/config.json` | No default model or CLI configuration exists |
| Muse data | No `~/.muse` directory | No personal stores, messaging credentials, or owner pairing exist |
| Muse services | No Muse API or Ollama service detected | No channel can currently receive or answer messages |

This is therefore a source checkout, not a running installation.

Two documentation-drift findings are visible:

1. `README.md` says the AttuneGraph submodule is pinned to `4298c13`, while the audited Git tree
   records gitlink `c9f5ce969df3dce65ca118570fb4b7e5653a430f`.
2. Some CLI messaging descriptions still list the older provider/inbound scope even though the
   registry and API source contain Matrix plus later inbound implementations. The runtime source
   and tests should be treated as authoritative until those strings are reconciled.

No dependency installation, build, or runtime test was performed for this audit. Conclusions about
shipped behavior come from repository contracts, source wiring, and existing tests; this audit
does not claim a live end-to-end pass on this machine.

## Can Muse be used directly as a Telegram bot?

### Product answer

Yes. Telegram is already a first-class provider. The source includes:

- Bot API message sending with link previews disabled;
- long polling through `getUpdates` with a durable offset;
- a persisted inbound inbox;
- direct-message versus shared-chat scope classification;
- typing indicators and registered `/new`, `/status`, `/model`, and `/help` commands;
- a one-time owner pairing code rather than adopting the first sender;
- per-channel conversation history;
- the full inbound agent run and reply path;
- a fail-closed approval path for risky tools; and
- polling and inbound-reply runtime flags exposed by the API settings surface.

### Operational answer for this checkout

No, not immediately. Cloning the repository alone does not start a bot. The minimum path is:

1. Complete the source checkout and install Muse:

   ```bash
   cd /home/pgun/dev/gezy/gezymuse
   git submodule update --init --recursive
   corepack enable
   pnpm install:muse
   ```

2. Configure a working model. For the documented local path, install and start Ollama, pull both a
   chat model and the embedding model, then run:

   ```bash
   muse setup local
   ```

   A configured cloud provider can be used instead, but then the chosen provider receives the
   relevant model context.

3. Create a Telegram bot with
   [BotFather](https://core.telegram.org/bots/tutorial) and keep the bot token secret.

4. Store the bot token through the interactive setup:

   ```bash
   muse setup messaging
   ```

   Select Telegram and enter the BotFather token. The wizard stores it in
   `~/.muse/messaging.json` with owner-only file permissions. `MUSE_TELEGRAM_BOT_TOKEN` is the
   environment-based alternative.

5. Enable Telegram ingestion and channel replies before starting the server:

   ```bash
   export MUSE_TELEGRAM_POLL_ENABLED=true
   export MUSE_INBOUND_REPLY_ENABLED=true
   muse serve
   ```

   The server must remain running because Telegram inbound delivery currently uses Bot API long
   polling. These flags can also be managed through the authenticated web settings surface.

6. In another terminal, obtain the one-time owner pairing code:

   ```bash
   muse messaging pairing-code telegram
   ```

   Send that exact code to the bot from the owner's private Telegram chat. Until pairing succeeds,
   an arbitrary first sender must not become the owner.

7. Verify the installation and channel status:

   ```bash
   muse doctor
   muse setup
   muse messaging providers --local
   muse serve --status
   ```

After these steps, a private message sent to the Telegram bot should enter the persisted inbox,
run through Muse's agent runtime, and receive a reply. This requires a live model and a continually
running Muse server; the token alone only enables transport.

### Telegram deployment cautions

- Use a private owner DM for the first deployment. Shared or group chat is assigned a more
  conservative scope and must not silently inherit private-owner authority.
- Keep `MUSE_LOCAL_ONLY` unset or false. Strict local-only mode intentionally refuses Telegram.
- A local Ollama model keeps model inference local, but messages and replies still pass through
  Telegram infrastructure.
- Do not place the bot token in the repository or a plaintext project config file. Use the existing
  credential store or an injected environment secret.
- Normal replies to the paired owner are supported. Any action that sends content to another
  person remains draft-first and requires confirmation of the exact content.
- Grounding guarantees apply to the supported grounded paths. Fast conversational replies do not
  have universal citation coverage.

## Can Muse become a WhatsApp bot?

Yes, but there is no WhatsApp provider in the current source. References to WhatsApp occur in
competitive or backlog material rather than in the active messaging registry.

The recommended integration is the official WhatsApp Business Platform Cloud API. Meta's official
API collection defines outbound messaging through
`POST /{Phone-Number-ID}/messages`, using an access token with the
`whatsapp_business_messaging` permission. Incoming messages and delivery-state changes arrive as
webhooks:

- [Meta WhatsApp Cloud API messages collection](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc)
- [Meta webhook payload reference](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference)
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)

The integration would need:

1. a `WhatsAppProvider` implementing Muse's shared messaging contract;
2. access-token, phone-number-ID, app-secret, and webhook-verification credential handling;
3. webhook verification plus signed inbound webhook processing;
4. idempotent persistence for inbound messages and delivery receipts;
5. owner pairing and a stable WhatsApp identity normalization rule;
6. registry, setup API, CLI, web Integration page, and diagnostic wiring;
7. explicit URL-preview suppression in every text reply;
8. tracking of the 24-hour customer-service window;
9. approved-template support for proactive or delayed messages outside that window; and
10. tests proving denial, timeout, ambiguous recipient, invalid signature, duplicate webhook, and
    absent or expired messaging consent cause no unintended external effect.

WhatsApp policy currently requires recipient opt-in. Free-form replies are permitted within the
24-hour service window opened or reset by a user message; outside that window, business-initiated
messages must use approved templates. Automation also requires a prompt and direct path to human
escalation. Muse's reminder and proactive-notification features therefore cannot simply reuse the
free-form `send` path for WhatsApp without enforcing those rules.

The inbound webhook also needs a publicly reachable HTTPS endpoint. Muse binds its server to
loopback by default, and its documented Tailscale remote access is private to a tailnet. A
production WhatsApp deployment would expose only the verified webhook boundary through a secure
public reverse proxy or tunnel while keeping the rest of the control plane private.

Unofficial WhatsApp Web session automation is not recommended as the primary implementation. It
would add session fragility and account-policy risk while bypassing the explicit webhook,
credential, consent, and delivery contracts the existing messaging architecture is designed to
enforce.

## Recommended adoption path

Use Telegram first to validate whether Muse's personal memory, continuity, model quality, latency,
and approval experience are useful in daily operation. This requires configuration but no product
code changes. It also exercises nearly the same internal path a future WhatsApp provider would
use.

Add WhatsApp only after that owner-chat workflow is satisfactory. Treat the first WhatsApp slice
as private inbound text to the paired owner plus replies within an open service window. Template
messages, proactive delivery, media, group behavior, and third-party destinations should remain
outside that first slice until their policy and failure paths have dedicated deterministic gates.
