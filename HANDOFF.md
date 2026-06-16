# Flex DS Roadmap — Session Handoff

Use this doc to resume work in a new session.

## Live link + repo
- **Live tool:** https://samiflex82.github.io/flex-ds-roadmap/
- **Repo:** https://github.com/samiflex82/flex-ds-roadmap
- Hosted on GitHub Pages; any push to `main` auto-deploys (~1–2 min).

---

## Architecture
**No-backend static app** — plain HTML/CSS/JS, no server, no build step.

- **Edits live in the browser's `localStorage`**, not a server. Auto-saves on every change; per-device (your edits only exist in your browser).
- **`data.json` in this repo is the published baseline** — what a fresh visitor sees. To publish your latest: Export → commit as `data.json` → push.
- **Sharing:** the **Share** button encodes the whole board into a URL hash as a **read-only snapshot** (anyone with the link sees your exact board at that moment; no login needed). Don't share the plain address-bar URL — that serves the last committed baseline.
- **No live multi-user editing yet.** Planned next step: **Supabase** (see below).

## Files overview
| File | Purpose |
|------|---------|
| `index.html` | App shell + the two overlays (edit panel, settings modal) |
| `app.js` | All logic — rendering, drag, settings, migrate, boot |
| `style.css` | All styles; uses `:root` CSS variables (Flex black theme) |
| `data.json` | Published seed/baseline (v8 schema) |
| `README.md` | User-facing docs |
| `HANDOFF.md` | This file |
| `parked-connections.md` | Full code for the dependency-arrows feature (removed from UI, ready to restore) |
| `asana-gaps.md` | Gap analysis: Asana Timeline vs our tool; feature backlog ideas |

---

## Data model (v8)

`data.json` shape:

```jsonc
{
  "meta": {
    "seedVersion": 8,            // bumped with each breaking schema change
    "codeCompleteDate": "...",   // legacy (kept for v<8 migration; real source is milestones[])
    "deployDate": "...",         // same
    "timelineStart": "2026-06-01",
    "timelineEnd": "2026-12-31",
    "linearOrg": "get-flex",
    "milestones": [{ "id", "label", "date", "color", "text" }],  // dated column markers
    "todayMarker": { "color", "text" },  // current-week column highlight
    "markerColors": { ... },     // legacy (v<8); kept for snapshot-link compatibility
    "weekNotes": { "<YYYY-MM-DD>": "note text" }  // keyed by week-start Monday
  },
  "people":      [{ "id", "name", "role", "color" }],
  "statuses":    [{ "id", "label", "bg", "fg", "textMode" }],   // textMode: auto|light|dark
  "phases":      [{ "id", "label" }],
  "workstreams": [{ "id", "label", "color", "icon" }],
  "items": [{
    "id", "phase", "workstream", "title", "owner",
    "status", "start", "end",       // YYYY-MM-DD
    "linear", "notes",
    "blocking": [],                 // [itemId] this item blocks
    "handsOffTo": [],               // informational; no longer drives arrows
    "track": null                   // optional manual row index within owner's lane
  }]
}
```

---

## How persistence works (`migrate()` / `seedVersion`)

`boot()` in `app.js`:
1. Fetches bundled `data.json` as `SEED`.
2. Reads `localStorage`; if present, runs **`migrate(parsed)`** in-place (non-destructive: keeps user's items/dates/edits, layers in new structure).
3. Each `if (v < N)` branch in `migrate()` handles one schema bump — **never wipes data**.
4. Fresh browser (no localStorage) → loads `SEED` directly.

Current ladder: v0→v3 (status remap, icons) → v4 (Flex theme) → v5 (de-purple) → v6 (markerColors) → v7 (status textMode + marker objects) → **v8 (milestones list + todayMarker)**.

↺ **Reset** is the only way to forcefully wipe localStorage back to seed.

---

## Publish-baseline loop

When Sami makes edits she wants everyone to see via the plain link:
1. **Export** (top toolbar) → downloads `flex-ds-roadmap-data.json`.
2. Attach the file to the new session / send to the agent.
3. Agent validates + commits as `data.json`, pushes to `main` → Pages auto-deploys.

---

## Key features (current state)

| Feature | Where |
|---------|-------|
| Swimlanes by owner, lane packing | `renderSwimlanes` / `packTracks` |
| Mon–Fri columns (no weekends) | `workdayOffset` / `dateToX` / `xToDate` |
| Current-week, milestone columns | `milestonesByWeek` / `renderWeekHeaders` |
| Per-week Notes row (OOO/holidays) | `renderWeekNotes` / `meta.weekNotes` |
| Drag to move dates (horizontal) | `setupDrag` |
| Drag to reassign owner (vertical) | `setupDrag` onUp → `lane.dataset.owner` |
| Drag to set vertical row (`track`) | `setupDrag` onUp → `item.track` |
| Resize end date | `setupResize` |
| Right side panel (edit/add items) | `openPanel` / `closePanel` |
| Filters popover | `renderFilters` / `#filter-popover` |
| Manage: people/ws/statuses/phases/milestones | `renderSettingsLists` + family |
| Hex-only color editor | `colorField` (preview chip + hex input; no native picker) |
| Colors in use palette | `renderPalette` |
| Snapshot share link (read-only) | `encodeSnapshot` / `decodeSnapshot` / `READONLY` |
| Export / Import JSON | `btn-export` / `btn-import` |
| Dependency arrows (parked) | see `parked-connections.md` |

---

## Pending: Supabase real-time sync

**Goal:** one live link, edits auto-save to the cloud, team can co-edit.  
**Status:** not yet implemented.

### Setup steps (one-time, Sami's account)
1. Go to **supabase.com** → sign up → **New project** (any name).
2. In the **SQL Editor**, run:
   ```sql
   create table public.board (
     id text primary key,
     data jsonb not null,
     updated_at timestamptz default now()
   );
   alter table public.board enable row level security;
   create policy "read"   on public.board for select using (true);
   create policy "insert" on public.board for insert with check (true);
   create policy "update" on public.board for update using (true) with check (true);
   alter publication supabase_realtime add table public.board;
   ```
3. **Settings → API**: copy **Project URL** (`https://abcdxyz.supabase.co`) and the **anon public key**.
4. Give both values to the agent.

### What the agent will do
- Add the Supabase JS client (CDN import) to `index.html`.
- Add `syncToSupabase(data)` + `subscribeSupabase(onUpdate)` helpers in `app.js` — save triggers an upsert; a realtime subscription re-renders when another user edits.
- Seed the cloud table with the current `data.json`.
- Remove the "Export to publish" manual loop.

The `data.json` seed and localStorage fallback are kept so the tool still works if Supabase is unreachable.
