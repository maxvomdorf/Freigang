# Änderungsprotokoll

## 1.4.0
- „Heute“, die Tagesbänder und die Heatmap im Protokoll zeigen jetzt den ganzen Tag (0 bis 24 Uhr) statt 5 bis 23 Uhr. Die Zeitangabe neben „Heute“ ist entfallen.
- README und Änderungsprotokoll auf Deutsch.

## 1.3.1
- Fix: Der Schritt „Benachrichtigungen“ in der Einrichtung erschien als schmaler senkrechter Balken (seine CSS-Klasse kollidierte mit der Marke im Zeitverlauf).

## 1.3.0
- Automatischer Deploy: Jeder Push auf `main` führt die Tests auf GitHub aus und deployt dann nach Cloudflare (`.github/workflows/deploy.yml`). `npm run deploy` geht weiterhin von Hand.

## 1.2.1
- Wird der Hinweis einer Katze geändert, die schon draußen ist, schwächt das die frühere Push-Nachricht nicht mehr ab: Sie behält die Warnung „beide draußen“ und die hohe Dringlichkeit.

## 1.2.0
- Kurzer Hinweis am Status einer Katze: Schnellwahl „In Begleitung“ und „Nur kurz draußen“ oder eigener Text (bis 40 Zeichen). Vor dem Tippen setzbar oder änderbar, solange die Katze angekündigt oder draußen ist. Der Nachbar sieht ihn auf der Karte und in der Push-Nachricht; eine spätere Änderung ersetzt die frühere Benachrichtigung leise.
- Der Hinweis wandert von „In 15 Min“ zu „Jetzt raus“, erscheint bei Vorfällen im Protokoll und hat eine eigene CSV-Spalte.
- Keine Datenbank-Migration nötig (nutzt die vorhandene Spalte `events.note`). Ältere Handys funktionieren weiter und zeigen den Hinweis nur nicht an.

## 1.1.0
- `npm run deploy` ist jetzt sicher für Updates: Es findet deine Datenbank, trägt deine Mailadresse ein, wendet neue Datenbank-Migrationen an und deployt. `wrangler.jsonc` bleibt eine saubere Vorlage.
- Die App zeigt ihre Version in den Einstellungen und lädt sich einmal von selbst neu, wenn der Server eine neuere Version hat.

## 1.0.0
- Erste Version: Status für Ilford und Bonnie, Push-Nachrichten, Konfliktsperre, Wochenplan (auch über Nacht), Admin-Protokoll.
