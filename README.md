# Freigang

Eine kleine installierbare Web-App für zwei Nachbarhaushalte mit demselben Problem: Ilford und Bonnie dürfen nicht gleichzeitig draußen sein.

- Beide sehen den Status **beider** Katzen (drinnen / geht gleich raus / draußen).
- Jeder schaltet **nur die eigene** Katze, mit einem Tipp. Die Gegenseite bekommt jedes Mal eine Push-Nachricht, der eigene Haushalt auf Wunsch auch.
- Pro Katze können mehrere Personen mitmachen, jede mit einem eigenen Link: Maxime und Janin (Ilford), Kathrin, Linus, Oskar und Anna-Lena (Bonnie). Wer auf der anderen Seite steht, wird immer als Kathrin (für Ilfords Seite) oder Maxime (für Bonnies Seite) angezeigt.
- „In 15 Min“ warnt den Nachbarn, bevor die Tür aufgeht. Ist die andere Katze schon draußen, fragt die App vorher nach: warten und benachrichtigt werden, oder trotzdem raus (wird als Override festgehalten).
- Ein Wochenplan mit Erinnerungen zeigt Überschneidungen, bevor sie passieren.
- Die Admins (Maxime und Janin) bekommen ein Protokoll: Überschneidungen, Tagesbänder über 24 Stunden, eine Uhrzeiten-Heatmap, Notizen zu jedem Vorfall und CSV-Export.

Die Oberfläche ist deutsch. Die App läuft auf Cloudflare (Worker, D1-Datenbank und ein Cron-Trigger), der kostenlose Tarif reicht. Kein Tracking, keine Anfragen an Dritte, die Schriften liegen selbst gehostet bei.

## Einrichten (einmalig, etwa 5 Minuten, am Computer)

Du brauchst ein kostenloses [Cloudflare-Konto](https://dash.cloudflare.com/sign-up) und [Node.js](https://nodejs.org) ab Version 20.

```sh
npm install
npm run setup
```

`npm run setup` meldet dich bei Cloudflare an, fragt nach deiner Mailadresse (Apple und Google verlangen in Push-Nachrichten eine echte Kontaktadresse, sonst sieht sie niemand), legt die Datenbank an, deployt, lädt die Geheimnisse hoch, prüft, ob die App erreichbar ist, und druckt **die persönlichen Links**: einen pro Person. Du kannst es gefahrlos erneut ausführen: Datenbank und Codes werden wiederverwendet.

Deine Codes und Schlüssel liegen in `.secrets.json` (niemals committen oder weitergeben). `npm run links` druckt die Links noch einmal. Setzt du die Account-ID einmal mit `$env:CLOUDFLARE_ACCOUNT_ID`, merkt sich das Projekt sie in `.secrets.json` und du musst sie nicht in jedem neuen PowerShell-Fenster wieder setzen.

Gibt es noch keine workers.dev-Adresse, fragt Cloudflare beim ersten Deploy nach einem Subdomain-Namen. Folge einfach der Abfrage.

**Wenn etwas hakt (Windows):**

- *„Die Ausführung von Skripts ist deaktiviert“* beim Aufruf von `npm`: einmalig `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` in PowerShell ausführen, oder statt PowerShell die Eingabeaufforderung (`cmd`) benutzen.
- *„Failed to automatically retrieve account IDs“*: die Account-ID selbst mitgeben, `$env:CLOUDFLARE_ACCOUNT_ID="DEINE-ID"` in PowerShell, dann `npm run setup` erneut starten. Die ID steht in der Adresszeile des Cloudflare-Dashboards direkt nach `dash.cloudflare.com/`.
- Fragt Wrangler „Would you like Wrangler to add it on your behalf?“, antworte mit **n**. Das Setup trägt die Datenbank selbst ein.

## Aktualisieren (jede spätere Änderung)

Updates sind klein und fassen deine Daten nie an: Neue Datenbankspalten werden nur hinzugefügt, nie umbenannt oder entfernt.

**Mit GitHub (empfohlen):** Änderungen committen und pushen, den Rest erledigt der automatische Deploy (siehe unten).

```sh
git add -A
git commit -m "Beschreibung der Änderung"
git push
```

**Von Hand**, ohne GitHub:

```sh
git pull                 # oder die neue Version über diesen Ordner entpacken; .secrets.json bleibt
npm install              # nur nötig, wenn sich package.json geändert hat
npm run deploy           # findet deine Datenbank, wendet neue Migrationen an, deployt
```

`npm run deploy` setzt beim Deployen deine eigene Datenbank-ID und Mailadresse (aus `.secrets.json`) ein. `wrangler.jsonc` bleibt eine saubere Vorlage, ein Update kann also deine Werte nie überschreiben oder Platzhalter ausliefern. Findet es deine Mailadresse nicht, fragt es einmal nach und merkt sie sich.

Öffne danach in der App die **Einstellungen**: Dort steht die Version. Geöffnete Apps laden sich einmal von selbst neu, sobald der Server eine neuere Version hat. Auf den Handys muss also niemand etwas tun.

**Zurückgehen:** `git checkout v1.1.0` (jeder Tag ab v1.1.0, siehe `git tag`), dann `npm run deploy`. Das setzt den Code zurück, nicht die Datenbank. Deshalb sind Migrationen nur additiv: Älterer Code funktioniert weiter mit neueren Tabellen.

**Auf einem neuen Computer:** Repo klonen, deine `.secrets.json` in den Ordner kopieren, `npm install`, `npm run deploy`.

## Automatischer Deploy (GitHub)

Damit geht jeder Push auf `main` von selbst live: GitHub führt die Tests aus, deployt dann nach Cloudflare, und die Handys laden sich neu. Du musst pro Update nichts tun. Einmalige Einrichtung:

1. **Cloudflare-API-Token:** dash.cloudflare.com → My Profile → API Tokens → Create Token → Create Custom Token. Berechtigungen: *Account · Workers Scripts · Edit*, *Account · D1 · Edit*, *Account · Account Settings · Read*. Account Resources: dein Konto. Den Token einmalig kopieren.
2. **Account-ID:** dash.cloudflare.com → Workers & Pages → „Account ID“ in der rechten Spalte (oder in der Adresszeile).
3. **GitHub-Secrets:** im Repo unter Settings → Secrets and variables → Actions → New repository secret. Drei Stück anlegen: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FREIGANG_EMAIL` (deine echte Mailadresse, dient als Kontakt für Push).
4. Auf `main` pushen oder den Workflow im Tab Actions von Hand starten. Der erste Deploy nach dem einmaligen `npm run setup` braucht nichts weiter.

Schlägt der Workflow fehl, zeigt der Tab Actions den Schritt und die Meldung. Ein fehlgeschlagener Test stoppt den Deploy, die Handys behalten dann die letzte funktionierende Version.

Das Repo sollte **privat** bleiben. Geheimnisse liegen nicht darin (`.secrets.json` steht in der `.gitignore`, die Tokens liegen in den GitHub-Secrets), aber es gibt keinen Grund, den Code öffentlich zu machen.

## Personen im Haushalt

Die Liste der Personen steht in `src/util.js` (`PEOPLE`): Name, zu welcher Katze sie gehören, und der Name ihres Zugangs-Secrets. Alle haben dieselben Rechte an ihrer Katze (schalten, Hinweis setzen, Plan bearbeiten) und sehen beide Katzen. Das Protokoll sehen nur Maxime und Janin (die beiden Admins; die Liste steht mit `admin: true` in `PEOPLE`).

**Neue Person hinzufügen:**

1. In `src/util.js` bei `PEOPLE` eine Zeile ergänzen (Name, `cat`, `secret: 'TOKEN_NAME'`), committen und pushen. Der automatische Deploy bringt die Änderung live.
2. Auf deinem Computer im Projektordner `npm run links` ausführen. Das erzeugt Codes nur für Personen ohne Code, lädt sie hoch und druckt alle Links. Bestehende Codes bleiben unverändert.
3. Den neuen Link privat verschicken. Die Person richtet das Handy ein wie unter „Auf den Handys installieren“.

Bis `npm run links` gelaufen ist, kann sich eine neue Person nicht anmelden. Schaden entsteht dadurch nicht.

**Meldungen beim Rauslassen:** Wenn Janin Ilford rauslässt oder reinholt, bekommen Kathrin, Linus, Oskar und Anna-Lena immer eine Nachricht. Maxime bekommt sie auch, mit dem Zusatz „(von Janin)“. Wer das nicht möchte, schaltet es in den **Einstellungen** unter „Meldungen beim Rauslassen“ aus (gilt nur für die eigene Person). Erinnerungen („Gleich: Ilford darf raus“), „Auf geht’s“ und „Noch draußen?“ gehen immer an alle, die sich um diese Katze kümmern.

## Auf den Handys installieren

**iPhone** (ab iOS 16.4; Push funktioniert nur in der installierten App)

1. Den persönlichen Link in **Safari** öffnen.
2. Teilen-Symbol, dann **Zum Home-Bildschirm**.
3. Freigang vom Home-Bildschirm öffnen. Die installierte iPhone-App hat einen eigenen Speicher und fragt deshalb noch einmal nach dem Code. In Safari gibt es auf dem ersten Bildschirm den Knopf „Code kopieren“; füge den Code in der installierten App ein.
4. **Benachrichtigungen erlauben** antippen.

**Android** (Chrome): Link öffnen, Menü, **App installieren**. Der Link meldet von selbst an; danach Benachrichtigungen erlauben.

Tipp: Schick jeden Link in einer privaten Nachricht. Wer den Link hat, kann die Katze dieser Person schalten.

## Täglicher Gebrauch

| Ansicht | Was sie macht |
| --- | --- |
| Jetzt | Statusbanner, deine Katze mit dem großen Knopf und einem optionalen Hinweis („In Begleitung“, „Nur kurz draußen“ oder eigener Text bis 40 Zeichen), die andere Katze nur lesbar mit ihrem Hinweis, der Verlauf von heute (0 bis 24 Uhr) |
| Plan | Wochenfenster pro Katze (zu jeder Uhrzeit, auch über Mitternacht), Erinnerung 15 Min vorher, Hinweis bei Überschneidung |
| Füttern | Nur für Bonnies Haushalt (Kathrin, Linus, Oskar, Anna-Lena): Knopf „Bonnie füttern“ trägt Uhrzeit und Name ein, darunter die Liste der letzten 7 Tage nach Tagen. Wurde Bonnie in der letzten Stunde schon gefüttert, erscheint ein Hinweis, und es fragt vor dem Eintragen nach. Vergessene Fütterungen trägt man über „Früher gefüttert? Zeit anpassen“ nach (Schnellwahl oder genaue Uhrzeit, bis 24 Stunden zurück); sie stehen in der Liste mit „nachgetragen“. Den eigenen Eintrag kann man 10 Minuten lang mit „Rückgängig“ zurücknehmen, gezählt ab dem Moment des Eintragens. Ilfords Haushalt sieht diese Ansicht nie und bekommt nie eine Meldung dazu |
| Protokoll | Nur für die Admins (Maxime, Janin): Kennzahlen, Tagesbänder, Heatmap, Vorfälle mit Notizen, CSV-Export, 7 oder 30 Tage |
| Einstellungen (oben rechts) | Benachrichtigungen an/aus, Testnachricht, Meldungen beim Rauslassen an/aus, Meldungen beim Füttern an/aus (nur Bonnies Haushalt), Abmelden |

Wer Bonnie füttert, löst eine Nachricht an den Rest von Bonnies Haushalt aus („Bonnie wurde gefüttert – Linus um 08:12 Uhr“), außer bei denen, die „Meldungen beim Füttern“ ausgeschaltet haben. Bei einem Nachtrag steht „(nachgetragen)“ dabei. Nimmt jemand den Eintrag zurück, ersetzt eine Korrektur die Nachricht.

Nachrichten gibt es, wenn die andere Katze rausgeht oder reinkommt, wenn jemand „In 15 Min“ ankündigt (oder zurücknimmt), wenn beide draußen sind und wenn die Katze, auf die du wartest, wieder drin ist. Erinnerungen und Anstöße („Auf geht’s“, „Noch draußen?“ nach 5 Std) kommen standardmäßig auch nachts. Ruhezeiten lassen sich einstellen (siehe unten).

## Einstellungen, die du ändern kannst

In `wrangler.jsonc` unter `vars` (das ist der eine Ort für eigene Änderungen; committen), danach pushen oder `npm run deploy`:

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `TIMEZONE` | `Europe/Berlin` | Gilt für den Plan, die Tagesbänder und die Ruhezeiten |
| `QUIET_START` / `QUIET_END` | `0` / `0` | Keine Ruhezeiten: Erinnerungen und Anstöße kommen auch nachts. Mit z. B. `22` / `6` schweigen sie in diesem Zeitraum (Statusmeldungen über die andere Katze werden nie unterdrückt). |
| `STALE_HOURS` | `5` | „Noch draußen?“ nach so vielen Stunden, danach bei jedem Vielfachen erneut |

## Handy verloren, Link weitergegeben, neues Gerät

```sh
npm run links -- --rotate kathrin    # oder maxime, janin, linus, oskar, annalena
```

Der alte Code funktioniert sofort nicht mehr, der Befehl druckt den neuen Link. Auf einem neuen Handy benutzt du einfach den Link noch einmal. Wer sich in der App abmeldet, wird auch aus den Push-Nachrichten dieses Handys entfernt.

## Wenn `npm run setup` bei dir nicht klappt

Dasselbe von Hand:

```sh
npx wrangler login
npx wrangler d1 create freigang          # database_id in wrangler.jsonc eintragen
npx wrangler d1 migrations apply freigang --remote
npm run keys                             # druckt alle Werte
npx wrangler secret put TOKEN_MAXIME     # Wert einfügen, dasselbe für alle anderen Werte:
                                         # TOKEN_JANIN, TOKEN_KATHRIN, TOKEN_LINUS, TOKEN_OSKAR,
                                         # TOKEN_ANNALENA, VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK
```

Trag deine echte Mailadresse bei `VAPID_SUBJECT` in `wrangler.jsonc` ein (`mailto:du@example.com`), führe `npx wrangler deploy` aus (nicht `npm run deploy`, das nutzt eine eigene erzeugte Konfiguration) und öffne `https://freigang.<deine-subdomain>.workers.dev/#k=<TOKEN_MAXIME>`.

## Lokal entwickeln und testen

```sh
npm run setup:local      # Testcodes in .dev.vars und eine lokale Datenbank
npm run dev              # http://localhost:8787
npm test                 # in einem zweiten Terminal, während "npm run dev" läuft
```

Der Test spricht mit dem laufenden Worker und spielt alle Personen: Anmeldung, Statuswechsel, die Konfliktsperre auf dem Server, Warten, Rückdatieren, den Wochenplan, Admin-only-Routen, die Protokoll-Rechnung, alle Cron-Anstöße und Web Push. Push-Nachrichten fängt ein Mock-Pushdienst ab, der sie wie ein Browser entschlüsselt (RFC 8291) und die VAPID-Signatur prüft. Verschlüsselung und Header werden also gegen den Standard geprüft und nicht gegen den eigenen Code.

**Von keinem Test hier abgedeckt:** die echte Zustellung über die Push-Dienste von Apple und Google. Prüf sie einmal auf den echten Handys mit Einstellungen, „Testnachricht“.

## Grenzen des kostenlosen Tarifs

- 100.000 Anfragen pro Tag. Eine geöffnete App fragt alle 15 Sekunden nach Neuigkeiten; zwei Handys, die den ganzen Tag benutzt werden, bleiben weit darunter. Der Cron-Trigger fügt 1.440 pro Tag hinzu.
- Kostenlose Workers bekommen 10 ms CPU pro Anfrage. Eine Push-Nachricht zu verschlüsseln und zu signieren braucht davon nur einen Bruchteil. Zeigen die Logs aber einmal „exceeded CPU“-Fehler, hebt der Tarif Workers Paid (etwa 5 USD im Monat) die Grenze auf.
- Das kostenlose Kontingent von Cloudflare D1 ist weit größer, als diese App braucht: ein paar Dutzend geschriebene Zeilen pro Tag, und jede Abfrage liest nur eine Handvoll Zeilen über Indizes (Migration `0002_indexes.sql`).

## Aufbau

```
src/        Worker: api.js (Routen, Statusregeln), feeding.js (Fütterungstracker), cron.js (Erinnerungen), push.js + webpush.js (Web Push), stats.js (Protokoll-Rechnung)
public/     Die App: index.html, app.js, style.css, sw.js (offline + Push), Manifest, Icons, Katzenbilder, Schriften
migrations/ Datenbankschema
scripts/    setup, links, keys, deploy
test/       Integrationstest mit Mock-Pushdienst
```
