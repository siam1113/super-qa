# superqa — Interactive Product Demo

A standalone, self-contained, click-through demo of the superqa app for client onboarding, stakeholder demos, and investor pitches.

**Everything here is fake and scripted.** No backend, no real agents, no network calls except Google Fonts. It's intentionally kept separate from the real app (`apps/web`) — not linked from its navigation, no shared code or dependencies — so it can't drift or break alongside real product changes. It is, however, built to *look and navigate* exactly like the real app: same sidebar, same topbar, same page structure and design tokens (copied from `apps/web/components/Sidebar.tsx`, `TopBar.tsx`, and `apps/web/app/globals.css`), so a prospect clicking through it is really previewing the real product's shell.

## Running it

No build step. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static server, e.g. `npx serve demo` or `python3 -m http.server --directory demo`

Deploy it anywhere static (Vercel, Netlify, S3, GitHub Pages) for a shareable link — just upload this folder as-is.

## How it works

Unlike a forced-autoplay tour, this demo is **navigation-driven**, like the real app: the sidebar and topbar are always there, and a visitor clicks through at their own pace. There's no "play" button that takes over — every screen responds to a real click.

- **Home** ("See what Super QA can do for you") is the landing view inside the shell, pitching three flagship flows plus quick links into the rest of the workspace.
- **Generate tests from a live exploration** (`Test Cases → Generate with AI → Explore live app`) — configure an environment/focus/depth, then watch a full-screen live viewer stream pages as Alex "explores" them, with working **Pause/Resume** and **Stop** (stop opens the same "generate test cases from what I have so far" confirmation the real feature has, including the thin-exploration warning), landing on a review screen of proposed test cases grounded in what was "seen."
- **Chat with Alex, your QA Engineer** (`Agents → Alex`, or the topbar chat icon) — a terminal-style console (not a chat-bubble toy) with quick-action prompts and scripted responses, plus an **Outpost** tab showing proactive findings that can be opened straight into the Console session.
- **A failure that fixes itself** (`Execute → Executions → a failed run`) — click through AI root-cause analysis → a self-healing locator fix (with a diff) → approve → a PR opens.
- Every other sidebar destination (Execution Plans, Framework, Automated Tests, Test Credentials, Defects, Reports, Coverage, Command Center, Environments) resolves to a real page so nothing in the nav dead-ends; the ones without a dedicated flow use the real app's own "coming soon" placeholder pattern.

The sidebar, topbar (search, chat, command center, notifications, theme toggle, avatar), and light/dark theme toggle are all functional, not just decorative — click around.

## Editing

Everything lives in three files:

- `index.html` — shell markup (sidebar/topbar containers) plus the static "after" markup for each view (Home, Test Cases, Executions, Environments, Agent Console) and the three overlay modals (Generate wizard, live exploration viewer, execution detail).
- `styles.css` — design tokens (copied from `apps/web/app/globals.css`, both dark and light) and every component's styling.
- `app.js` — the sidebar nav config (`NAV`, mirrors `Sidebar.tsx`'s structure), all scripted fake data (`DATA`, `EXPLORE_STEPS`, `CONSOLE_RESPONSES`, `DATA.outpost`), and the interaction logic for each flow.

To change what the live exploration "finds," edit `EXPLORE_STEPS` in `app.js`. To change Alex's canned answers, edit `CONSOLE_RESPONSES`. To add a nav destination, add it to `NAV` and either build a real `.view` section for it in `index.html` or add it to `PLACEHOLDER_CONFIG` for the generic "coming soon" treatment.
