# MentalTiers

MentalTiers is a **0€ serverless Discord tierlist system** for Minecraft.

The live version is inside `worker/` and is designed for **Cloudflare Workers + Cloudflare D1**. No Minecraft verification server and no 24/7 VPS are required.

## What it does

1. Player opens `#verify-account`.
2. Player presses **Verify Account**.
3. Player enters a Minecraft Java username.
4. MentalTiers stores the linked Minecraft name and gives **Mental Verified**.
5. The private tier-testing category becomes visible.
6. Each gamemode has its own waitlist channel.
7. Tester opens a queue with `/queue-open`.
8. Players press **Join Queue**.
9. Every queue has a maximum of **20 players**.
10. Tester uses `/queue-next` to take player #1.
11. Tester enters the result with `/result`.
12. MentalTiers stores the tier and automatically gives the matching Discord role.

> Current free verification checks/links the Minecraft Java username. It does **not yet prove ownership of the Microsoft/Minecraft account**. A Microsoft ownership login can be added later without changing the queue system.

## Modes

- Sword
- Speed
- Pot
- NethOP
- OG Vanilla
- SMP
- Mace
- Crystal
- Axe
- UHC

## Tiers

`HT1 > LT1 > HT2 > LT2 > HT3 > LT3 > HT4 > LT4 > HT5 > LT5`

## Commands

### Everyone

- `/profile [user]`
- `/leaderboard`
- `/help`

### Mental Tester / Admin

- `/queue-open mode`
- `/queue-close mode`
- `/queue-next mode`
- `/result user mode tier`

### Admin

- `/setup`

`/setup` automatically creates:

- `Mental Verified` role
- `Mental Tester` role
- `#verify-account`
- private `🏆 TIER TESTING` category
- all 10 waitlist channels
- verification panel
- queue panels with Join / Leave / View buttons

## Queue system

Each queue has a maximum of **20 players** and one persistent panel.

Buttons:

- **Join Queue**
- **Leave Queue**
- **View Queue**

The panel updates when the queue opens/closes or players join/leave.

## 0€ hosting

The production code is in:

`worker/`

It uses:

- Cloudflare Workers for Discord interactions
- Cloudflare D1 for users, queues, tiers and history
- Discord HTTP Interactions, so no permanent WebSocket process is needed
- GitHub for all source code

## Cloudflare variables

The Worker needs these variables/secrets:

- `DISCORD_PUBLIC_KEY`
- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `SETUP_SECRET`

It also needs one D1 binding named exactly:

`DB`

**Never put the Discord bot token into a GitHub file.**

## Deployment

Cloudflare can import the GitHub repository directly. Set the project root directory to:

`worker`

After deployment, use:

`https://YOUR-WORKER.workers.dev/interactions`

as the Discord **Interactions Endpoint URL**.

Then register the Slash Commands once with:

`https://YOUR-WORKER.workers.dev/register?key=YOUR_SETUP_SECRET`

After the commands appear in Discord, run `/setup` as a Discord administrator.

## Old prototype

The old Node/Gateway bot and Minecraft verification-server prototype may still exist in older project history, but the intended live build is now the `worker/` version.
