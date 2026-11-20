# Freigang

A small installable web app for two neighbours who share one problem: Ilford and Bonnie must not be outside at the same time.

- Everyone sees the status of **both** cats (inside / leaving soon / outside).
- Everyone switches **only their own** cat, with one tap. The other person gets a push message every time.
- "Leaving in 15 min" warns the neighbour before the door opens. If the other cat is already out, the app asks first: wait for a message, or go anyway (recorded as an override).
- A weekly plan with reminders shows overlaps before they happen.
- The admin (Maxime) gets a log: overlaps, daily bands, a time-of-day heatmap, notes per incident, CSV export.

The UI is German. Runs on Cloudflare (Worker + D1 database + a cron trigger), free plan is enough. No tracking, no third-party requests, fonts are self-hosted.

## Deploy (once, about 5 minutes, needs a computer)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm run setup
```

`npm run setup` logs you in, asks for your email address (Apple and Google insist on a real contact address in push messages; nobody else sees it), creates the database, deploys, uploads the secrets, checks that the app is online and prints **two personal links**, one for Maxime and one for Kathrin. It is safe to run again: it reuses the database and the codes.

Your codes and keys are saved in `.secrets.json` (never commit or share it). `npm run links` prints the links again.

If you have no workers.dev address yet, Cloudflare asks you to pick a subdomain during the first deploy. Follow the prompt.

## Updating (every later change)

Updates are small and never touch your data: new database columns are only ever added, never renamed or removed.

```sh
git pull                 # or unzip the new version over this folder; .secrets.json stays
npm install              # only needed when package.json changed
npm run deploy           # finds your database, applies new migrations, deploys
```

`npm run deploy` fills in your own database id and email (from `.secrets.json`) while deploying. `wrangler.jsonc` stays a clean template, so an update can never overwrite your values or ship the placeholders. If it cannot find your email it asks once and remembers it.

Afterwards open **Einstellungen** in the app: it shows the version. Open apps reload themselves once when the server has a newer version, so nobody has to do anything on the phones.

**Going back:** `git checkout v1.1.0` (any tag from `git tag`), then `npm run deploy`. This rolls the code back, not the database; that is why migrations are additive, so older code keeps working with newer tables.

**On a new computer:** clone the repo, copy your `.secrets.json` into the folder, `npm install`, `npm run deploy`.

## Install on the phones

**iPhone** (needs iOS 16.4 or newer; push only works for the installed app)

1. Open the personal link in **Safari**.
2. Share button, then **Zum Home-Bildschirm**.
3. Open Freigang from the home screen. An installed iPhone app has its own storage, so it asks for the code once more. In Safari the first screen has a "Code kopieren" button; paste it in the installed app.
4. Tap **Benachrichtigungen erlauben**.

**Android** (Chrome): open the link, menu, **App installieren**. The link logs in by itself; then allow notifications.

Tip: send each link in a private message. Anyone with the link can switch that person's cat.

## Daily use

| Screen | What it does |
| --- | --- |
| Jetzt | Status banner, your cat with the big button and an optional note ("In Begleitung", "Nur kurz draußen" or your own text, up to 40 characters), the other cat read-only with its note, today's timeline |
| Plan | Weekly slots per cat (any time of day, may run past midnight), reminder 15 min before, overlap warning |
| Protokoll | Admin only: KPIs, day bands, heatmap, incidents with notes, CSV export, 7 or 30 days |
| Settings (top right) | Notifications on/off, test message, sign out |

Messages are sent when the other cat goes out or comes in, when someone announces "in 15 min" (or cancels), when both are out, and when someone you wait for is back. Reminders and nudges ("time is up", "still outside after 3 h") pause during quiet hours.

## Settings you may want to change

In `wrangler.jsonc` under `vars` (this is the one place where your own edits belong; commit them), then `npm run deploy`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TIMEZONE` | `Europe/Berlin` | Used for the plan, the day bands and the quiet hours |
| `QUIET_START` / `QUIET_END` | `0` / `0` | No quiet hours: reminders and nudges also arrive at night. Set e.g. `22` / `6` to silence reminders and nudges in that window (status messages about the other cat are never silenced). |
| `STALE_HOURS` | `5` | "Still outside?" nudge after this many hours, repeated every multiple |

## Lost phone, link leaked, new device

```sh
npm run links -- --rotate kathrin    # or maxime
```

The old code stops working immediately; the command prints the new link. On a new phone just use the link again. Signing out in the app also removes that phone from push messages.

## If `npm run setup` does not work for you

Do the same by hand:

```sh
npx wrangler login
npx wrangler d1 create freigang          # copy the database_id into wrangler.jsonc
npx wrangler d1 migrations apply freigang --remote
npm run keys                             # prints four values
npx wrangler secret put TOKEN_MAXIME     # paste the value, repeat for the other three:
                                         # TOKEN_KATHRIN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK
```

Put your real email into `VAPID_SUBJECT` in `wrangler.jsonc` (`mailto:you@example.com`), run `npx wrangler deploy` (not `npm run deploy`, which uses its own generated config), and open `https://freigang.<your-subdomain>.workers.dev/#k=<TOKEN_MAXIME>`.

## Develop and test locally

```sh
npm run setup:local      # test codes in .dev.vars and a local database
npm run dev              # http://localhost:8787
npm test                 # in a second terminal, while "npm run dev" runs
```

The test talks to the running Worker and plays both people: authentication, status changes, the conflict guard on the server, waiting, backdating, the weekly plan, admin-only routes, the log maths, all cron nudges, and Web Push. Push messages are caught by a mock push service that decrypts them (RFC 8291) and verifies the VAPID signature, so the encryption and headers are checked against the standard rather than against the code itself.

**Not covered by any test here:** real delivery through Apple's and Google's push services. Check it once on the real phones with Settings, "Testnachricht".

## Limits of the free plan

- 100,000 requests a day. An open app asks for updates every 15 seconds; two phones used all day stay far below that. The cron trigger adds 1,440 a day.
- Free Workers get 10 ms of CPU per request. Encrypting and signing a push message takes a fraction of that, but if the logs ever show "exceeded CPU" errors, the Workers Paid plan (about 5 USD a month) lifts the limit.
- Cloudflare's D1 free allowance is far larger than this app needs: a few dozen rows written a day, and every poll reads only a handful of rows through indexes (migration `0002_indexes.sql`).

## Layout

```
src/        Worker: api.js (routes, status rules), cron.js (reminders), push.js + webpush.js (Web Push), stats.js (log maths)
public/     The app: index.html, app.js, style.css, sw.js (offline + push), manifest, icons, cat art, fonts
migrations/ Database schema
scripts/    setup, links, keys
test/       Integration test with a mock push service
```

Fonts: Fraunces and DM Sans, SIL Open Font License (`public/fonts/LICENSE-*.txt`).
