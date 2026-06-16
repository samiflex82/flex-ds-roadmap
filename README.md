# Flex DS — Dark Matter Roadmap

Swimlane timeline for the Flex Design System Dark Matter (DM) migration. Shows action items per person, tracks progress against the code-complete target, and gives leadership a shareable read-only view.

**Live:** https://samiflex82.github.io/flex-ds-roadmap/

## Architecture / current state

It's a **no-backend static app** (plain HTML/CSS/JS) hosted on GitHub Pages — no server, no build step.

- **Edits live in the browser's `localStorage`.** Every change auto-saves locally, so a refresh keeps your work — but it's **per-device** (your edits only exist in your browser).
- **`data.json` in this repo is the published baseline** — what a fresh visitor sees on first load. Once you've edited, your browser's localStorage version takes over for you.
- **Sharing is manual:**
  - **Export** → downloads a `.json` backup (re-load with **Import**).
  - **Share** → encodes the whole board into a URL as a **read-only snapshot** (point-in-time; whoever opens it sees exactly your current view).
  - To publish your latest as the baseline, the `data.json` gets re-committed.
- **No live multi-user editing yet** — it's single-player; two people editing = two separate browser copies that don't sync.

**Planned:** move to **Supabase** (hosted Postgres + realtime) so the board lives in one shared place — auto-save, one live link, and the team can co-edit.

## How to use

| Action | How |
|--------|-----|
| Move a card | Drag it left/right |
| Reorder within a lane / reassign owner | Drag up/down (within or across lanes) |
| Change end date | Drag the right edge |
| Edit details / status / dependencies | Click the card → side panel |
| Add item | **+ Add** button |
| Delete item | Open card → Delete |
| Filter | **Filter** button (popover) → toggle chips; Clear all |
| Manage people / workstreams / statuses / phases / colors / markers | **⚙ Manage** |
| Per-week OOO / holidays | The **Notes** row under the week headers |
| Save | Auto-saves to localStorage |
| Share | **Share** → Copy snapshot link |
| Back up / restore | **Export** → JSON; **Import** to reload |

## Notes on rendering

- Cards are colored by **status** (background); status text auto-contrasts (or set Light/Dark per status in Manage).
- **Workstream** shows as an emoji on each card.
- Columns are **Mon–Fri** only; the current week, code-complete, and deploy columns are highlighted (colors editable in Manage → Column markers).
- The **dependency / connector arrows** feature was removed for now; its code is parked in [`parked-connections.md`](./parked-connections.md) for a future revisit.

## Updating data

`data.json` is the published seed/baseline. After first load, edits persist in localStorage. To publish a new baseline: **Export** the current board and commit the resulting JSON as `data.json`. To reset your browser to the baseline: **↺ Reset** (or clear localStorage / Import a JSON).

## Deploy

GitHub Pages serves directly from the `main` branch root. Any push to `main` auto-deploys (~1–2 min).
