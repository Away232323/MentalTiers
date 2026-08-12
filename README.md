# MentalTiers

Discord-Bot fuer die **Mental Minecraft Tierlist**.

## Modi

- Sword
- Axe
- SMP
- UHC
- Crystal
- Mace

## Tier-Reihenfolge

`HT1 > LT1 > HT2 > LT2 > HT3 > LT3 > HT4 > LT4 > HT5 > LT5`

## Erste Version

- `/profile [user]` - zeigt alle Tiers eines Spielers
- `/tier-set user mode tier` - Tier setzen (Tester/Admin)
- `/tier-remove user mode` - Tier entfernen (Tester/Admin)
- `/leaderboard` - globale Rangliste nach Tier-Punkten
- `/test-request mode minecraft-name` - Test anfordern
- `/queue [mode]` - offene Tests anzeigen
- `/test-claim user mode` - Test als Tester uebernehmen
- `/test-result user mode tier` - Testergebnis eintragen
- `/help` - Hilfe
- automatische Discord-Tierrollen, wenn der Bot `Manage Roles` besitzt
- lokale JSON-Speicherung in `data/database.json`

## Discord-Bot Variablen

Der Bot braucht spaeter folgende Secrets / Umgebungsvariablen:

- `DISCORD_TOKEN` - Discord Bot Token
- `CLIENT_ID` - Application ID
- `GUILD_ID` - ID deines MentalTiers Discord Servers

**Niemals den Discord Token in eine GitHub-Datei schreiben.**

## Start

```bash
npm install
npm start
```

Alles am Projekt kann ueber GitHub verwaltet werden. GitHub selbst haelt einen normalen Discord-Bot aber nicht dauerhaft 24/7 online; dafuer brauchen wir spaeter einen Host, auf dem nur dieses GitHub-Projekt gestartet wird.
