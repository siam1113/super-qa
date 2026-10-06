# Super QA — Scripted Demo

A standalone, self-contained walkthrough of the Super QA platform for client onboarding, stakeholder demos, and investor pitches.

**Everything here is fake and scripted.** No backend, no real agents, no network calls except the Google Fonts stylesheet. It is intentionally kept separate from the real app (`apps/web`) — it is not linked from its navigation and has no shared code or dependencies, so it can't drift or break alongside real product changes.

## Running it

No build step. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static server, e.g. `npx serve demo` or `python3 -m http.server --directory demo`

Deploy it anywhere static (Vercel, Netlify, S3, GitHub Pages) for a shareable link — just upload this folder as-is.

## Presenting it

- **Play the full tour** (hero button, or the play/pause icon in the top bar) autoplays all 6 chapters hands-free, ~3 minutes.
- **Explore chapter by chapter** stops auto-advancing after each chapter so you can narrate live; click a chapter in the footer rail to jump.
- Space bar toggles play/pause, Left/Right arrows jump chapters — handy for driving from a clicker during a live pitch.
- "Book a working session" opens a dummy contact form (no data is sent anywhere).

## Story arc

1. **Connect & Learn** — Context Manager connects GitHub/Jira/Confluence/Zephyr, extracts facts, resolves a flow ambiguity.
2. **Generate Coverage** — Test Case Manager finds a coverage gap and generates regression tests from real requirements.
3. **Execute** — Executor runs the suite; one test fails.
4. **Investigate** — AI Analysis explains the root cause with evidence and related failures.
5. **Self-Heal** — Healer proposes a resilient locator fix and opens a PR.
6. **Ship It** — PR merges, dashboard KPIs update, impact recap.

## Editing

All content lives in three files:

- `index.html` — static markup for every scene (the "after" state of each element)
- `styles.css` — visual design, reusing the real app's color tokens
- `app.js` — the sequencer engine (`sceneScripts`) and the fake data for each chapter (source lists, facts, generated test cases, execution rows, etc.)

To change the script, edit the relevant array in `app.js` (e.g. `factsData`, `generatedTests`, `testRows`) or the step functions around it.
