# Operon partner preview

A clickable preview of Operon, an AI-run practice system for South African accounting firms. All data is made up, and every login and security screen is simulated. No production app code, credentials or real client details are included.

Open it at https://ajtradezs.github.io/operon-partner-preview/

## Signing in

Use `aidan.demo@example.test`, `johan.demo@example.test` or `roelof.demo@example.test` with the code `123456`, then choose Partner, Manager or Clerk. Any valid-looking demo email works. These are demonstration identities, not accounts or access controls.

## Leaving notes and rearranging pages

Open the review link Aidan sent you; it ends in `?review=…`. The page remembers it in that browser and removes it from the address bar.

- **+ Note** on any section: say what you'd change and how it could be done better. Other people's notes show on the same section, and you can reply or set a status.
- **Pin a note anywhere:** click any button, tab or column to attach a note to it.
- **Arrange this page:** drag sections around, hide them, make them half-width, double-click text to reword it, add blocks, reorder the menu, or suggest a whole new page.
- **Review notes** (in the menu) lists everyone's notes and layout changes. Filter them, or export them as Markdown, CSV or JSON.

Notes and layouts sync automatically to Aidan and the other partners. The chip in the review bar shows whether they are synced, saving or offline. Without the review link everything still works, but your notes stay in your browser. Everyone with the link can read everyone's notes, so don't type real client details.

## Document collections

Request documents from clients, let them upload through a client portal, and see what came back.

- **Board:** Overdue, Pending, In progress and Complete, plus Filed on SARS when it's switched on. Cards show progress, due dates and linked tasks.
- **New collection:** pick a client, use a template checklist or list specific documents, and send by email, WhatsApp or link. Sending is simulated.
- **Templates** for each client type, and **Reminders & settings**.
- **Client portal:** open it with **Preview portal** on a collection. Verify, upload or mark items N/A, and submit. The board updates straight away. Completing a collection that feeds a task moves that task to AI at work.

Uploaded files are never read or sent anywhere. Only the file name and size are kept, in memory, until you reload.

## Resetting

Reloading resets the demo work. **Reset the demo data** on the Account page puts the starting data back and keeps your notes.

## For developers

`index.html` is generated. A build script adapts the original demo and inlines the sources in `src/`:

- `sync.js`, `review.js` and `review.css` are the review layer.
- `collections.js` and `collections.css` are Document collections.

Edit `src/`, rebuild, then run the browser tests with `python -m pytest tests -q` (Playwright for Python). The live-sync tests need a test access code and skip without one. The real Operon app is separate and private; this static site does not connect to it.
