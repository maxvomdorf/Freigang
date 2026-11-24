# Änderungsprotokoll

## 1.7.0
- Plan: Zeiten, in denen eine Katze **drinnen bleibt**. Im Plan wählt man beim Anlegen „Draußen“ oder „Drinnen“. Drinnen-Einträge gibt es **„Nur einmal“** (am nächsten Tag mit dem gewählten Wochentag, heute eingeschlossen, höchstens 6 Tage im Voraus) oder **„Jede Woche“**, **ganztägig** (Standard) oder mit Von/Bis, auch über Mitternacht.
- Darstellung: Draußen-Zeiten bleiben gefüllte Balken, Drinnen-Zeiten sind hohle Balken mit gestrichelter Linie (Unterschied in der Form, nicht nur in der Farbe). In der Liste steht „Bleibt drinnen · nur am Mi 25.11.“ bzw. „jede Woche“.
- Ein einmaliger Drinnen-Eintrag darf auf einem wöchentlichen Draußen-Fenster liegen, das ist die Ausnahme für einen Tag. Beginnt das Fenster in diesem Zeitraum, **entfällt** es an diesem Tag: Die Erinnerung „Gleich: … darf raus“ kommt nicht, im Plan steht das Fenster durchgestrichen als „Entfällt am …“, und es zählt nicht für den Hinweis bei Überschneidungen. Wöchentliche Einträge dürfen sich nicht überschneiden (Draußen und Drinnen derselben Katze), einmalige Drinnen-Einträge nicht untereinander.
- Auf „Jetzt“ erscheint bei einer Katze, die laut Plan drinnen bleibt, ein Hinweis („Bleibt laut Plan heute drinnen“, „… bis 23:00 Uhr drinnen“), auch bei der anderen Katze. Er ist reine Information: Rauslassen bleibt jederzeit möglich, es gibt keine zusätzliche Rückfrage und keine Meldung beim Anlegen.
- Einmalige Einträge räumt der Server nachts auf (nach zwei Tagen); wöchentliche bleiben.
- Neue Spalten `schedule_slots.kind` und `schedule_slots.on_date` (Migration 0006, nur additiv; bestehende Fenster bleiben „Draußen“). Alte App-Versionen sehen Drinnen-Einträge nicht und legen weiter Draußen-Fenster an.
- Neuer Test: Die Kalender-Funktionen der App (eine Kopie in `public/app.js`) werden gegen die des Servers geprüft.

## 1.6.1
- Fütterung nachtragen: Im Tab „Füttern“ trägt „Früher gefüttert? Zeit anpassen“ eine vergessene Fütterung nach, per Schnellwahl (vor 10 Min bis 2 Std) oder mit genauer Uhrzeit, bis 24 Stunden zurück. Die Liste markiert solche Einträge mit „nachgetragen“, die Meldung an den Haushalt auch.
- Der Hinweis „vor weniger als einer Stunde gefüttert“ gilt für den Zeitpunkt, der eingetragen wird: Er prüft die Fütterung, die am nächsten liegt, eine Stunde davor und danach.
- „Rückgängig“ zählt ab dem Moment des Eintragens (nicht ab der Fütterungszeit), sodass sich auch ein Nachtrag 10 Minuten lang zurücknehmen lässt.
- Einstellungen: Der Schalter „Meldungen aus dem Haushalt“ heißt jetzt „Meldungen beim Rauslassen“ und sagt klar, dass er das Rauslassen und Reinholen betrifft („wenn jemand anderes aus dem Haushalt Bonnie rauslässt oder wieder reinholt“). Er ist damit klar vom Schalter „Meldungen beim Füttern“ getrennt.
- Neue Spalte `feedings.recorded_at` (Migration 0005, nur additiv).

## 1.6.0
- Fütterungstracker, nur für Bonnies Haushalt (Kathrin, Linus, Oskar, Anna-Lena): neuer Tab „Füttern“ anstelle des Protokolls, das nur die Admins haben. Ein Knopf trägt Uhrzeit und Name ein, darunter zeigt die Liste der letzten 7 Tage nach Tagen, wann und von wem gefüttert wurde.
- Wurde Bonnie in der letzten Stunde schon gefüttert, steht ein Hinweis auf der Karte, und beim erneuten Füttern wird nachgefragt („Trotzdem eintragen“). Der Server prüft das ebenfalls, auch wenn jemand anderes gerade erst gefüttert hat. Es wird nichts blockiert.
- „Rückgängig“ direkt auf der Karte für den eigenen Eintrag, 10 Minuten lang. Der Server erlaubt es nur dem Eintragenden und nur in dieser Zeit.
- Meldung an den Rest von Bonnies Haushalt, wenn jemand füttert (nie an Ilfords Haushalt, nie an die Person selbst). Pro Person abschaltbar unter „Meldungen beim Füttern“, standardmäßig an. Wird ein Eintrag zurückgenommen, ersetzt eine Korrektur die Meldung.
- Ilfords Haushalt bekommt vom Server keine Fütterungsdaten und auf allen Fütterungs-Routen 403.
- Neue Tabelle `feedings` und neue Spalte `user_prefs.feed_push` (Migration 0004, nur additiv).

## 1.5.1
- Janin ist ebenfalls Admin und sieht das Protokoll (Kennzahlen, Tagesbänder, Heatmap, Vorfälle, Notizen, CSV).
- Protokoll, Ansicht „30 Tage“: Die Tagesbänder zeigen zuerst nur die letzten 10 Tage, der Knopf „Alle 30 Tage anzeigen“ klappt den Rest auf. So ist die Heatmap darunter schnell erreichbar.

## 1.5.0
- Mehrere Personen pro Katze, jede mit eigenem Link: Janin (Ilford) sowie Linus, Oskar und Anna-Lena (Bonnie). Wer auf der Gegenseite steht, wird weiter als Kathrin (für Ilfords Seite) bzw. Maxime (für Bonnies Seite) angezeigt.
- Status-Meldungen gehen an alle auf der Gegenseite und standardmäßig auch an den eigenen Haushalt (mit „(von Janin)“). In den Einstellungen lässt sich das pro Person abschalten („Meldungen aus dem Haushalt“).
- Erinnerungen, „Auf geht’s“ und „Noch draußen?“ gehen an alle, die sich um die Katze kümmern, nicht nur an eine Person.
- `npm run links` erzeugt und lädt Codes nur für neue Personen hoch und lässt bestehende unverändert. Die Account-ID wird, einmal gesetzt, in `.secrets.json` gemerkt.
- Neue Tabelle `user_prefs` (Migration 0003, nur additiv).

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
