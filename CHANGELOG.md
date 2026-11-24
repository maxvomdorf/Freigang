# Changelog

## 1.3.1
- Fix: the first-run screen showed the "notifications" step as a thin vertical bar (its CSS class clashed with the timeline marker).

## 1.3.0
- Automatic deploy: every push to `main` runs the tests on GitHub and then deploys to Cloudflare (`.github/workflows/deploy.yml`). `npm run deploy` still works by hand.

## 1.2.1
- Changing the note of a cat that is already out no longer weakens the earlier push: it keeps the "beide draußen" warning and the high urgency.

## 1.2.0
- Short note on a cat's status: quick chips "In Begleitung" and "Nur kurz draußen", or your own text (up to 40 characters). Set it before the tap, or change it while the cat is announced or out. The neighbour sees it on the card and in the push message; a later change replaces the earlier notification quietly.
- The note carries over from "In 15 Min" to "Jetzt raus", shows on incidents in the log and has its own CSV column.
- No database migration needed (uses the existing `events.note` column). Older phones keep working and simply do not show the note.

## 1.1.0
- `npm run deploy` is now safe for updates: it finds your database, fills in your email, applies new database migrations and deploys. `wrangler.jsonc` stays a clean template.
- The app shows its version in Einstellungen and reloads itself once when the server has a newer version.

## 1.0.0
- First version: status for Ilford and Bonnie, push messages, conflict guard, weekly plan (also overnight), admin log.
