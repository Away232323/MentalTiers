# MentalTiers

MentalTiers is a Discord + Minecraft tier-testing system inspired by large public tierlist servers.

## Flow

1. Player opens `#verify-account` on Discord.
2. Player presses **Verify Account** and enters the Minecraft IGN.
3. MentalTiers generates a private 6-character verification code.
4. Player joins the configured verification Minecraft server.
5. Player runs `/confirm CODE` in Minecraft.
6. The Paper plugin sends the real Minecraft username + code to the MentalTiers bot.
7. Discord automatically gives the **Mental Verified** role.
8. The player's waitlist channels become visible.
9. If a tester opens a queue, the player can press **Join Queue**.
10. Every mode/region queue has a maximum of **20 players**.

One Minecraft account can only be linked to one Discord account.

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

## Discord commands

### Everyone

- `/profile [user]`
- `/leaderboard`
- `/help`

### Tester / Admin

- `/queue-open mode [region]`
- `/queue-close mode [region]`
- `/queue-next mode [region]`
- `/test-result user mode tier`
- `/tier-set user mode tier`
- `/tier-remove user mode`

### Admin

- `/setup` - automatically creates roles, verification panel and waitlist channels
- `/queue-clear mode [region]`
- `/verify-reset user`

## Queue buttons

Each waitlist channel has one persistent status panel:

- **Join Queue** - only enabled while the queue is open
- **Leave Queue**
- **View Queue**

The panel updates automatically when a player joins/leaves, when a tester opens/closes the queue and when `/queue-next` is used.

## Discord bot environment variables

Required:

- `DISCORD_TOKEN` - Discord bot token
- `GUILD_ID` - MentalTiers Discord server ID
- `VERIFY_SERVER_IP` - IP shown to players during verification
- `VERIFY_API_SECRET` - private random secret shared with the Paper verify plugin

Optional:

- `PORT` / `VERIFY_API_PORT` - HTTP verification API port, default `8787`
- `TEST_COOLDOWN_DAYS` - default `7`
- `ENABLED_REGIONS` - comma separated, default `eu`; valid: `eu,na,au,as`

Never commit the Discord token or API secret to GitHub files.

## Minecraft verification plugin

Source: `minecraft-plugin/`

The plugin is for Paper 1.21.6 and provides:

`/confirm <6-character-code>`

After GitHub Actions builds it, upload `MentalTiersVerify.jar` to the verification server's `plugins` folder.

Then edit:

`plugins/MentalTiersVerify/config.yml`

Set:

- `api-url` to the public MentalTiers bot endpoint ending in `/api/confirm`
- `api-secret` to exactly the same value as `VERIFY_API_SECRET`

## Automatic GitHub builds

- `MentalTiers Check` checks the Discord bot JavaScript.
- `Build MentalTiersVerify` compiles the Minecraft `.jar` using Java 21 and Maven entirely on GitHub.

No local IDE, Maven, Node.js or Java installation is required for editing/building the project through GitHub.

GitHub stores and builds the project, but a Discord bot still needs a continuously running process when the final system goes live.
