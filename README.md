# Flex DS — Dark Matter Roadmap

Swimlane timeline for the Flex Design System Dark Matter (DM) migration. Shows action items per person, handoff chains, and tracks progress against the **Jul 24 code-complete** target.

**Live:** https://samiflex82.github.io/flex-ds-roadmap/

## How to use

| Action | How |
|--------|-----|
| Move a card | Drag it left/right |
| Change end date | Drag the right edge |
| Edit details / status | Click the card |
| Add item | **+ Add** button |
| Delete item | Open card → Delete |
| Filter by phase/status/workstream | Toggle chips at top |
| Save data | Auto-saves to localStorage |
| Share with leadership | **Share** → copy link |
| Back up / move data | **Export** → JSON; **Import** to reload |

## Bars and arrows

- `===` / colored bar = active item
- Dashed arrows = handoff: an item hands off to the next person in the same workstream

## Updating data

The source of truth for initial seed is `data.json`. After loading once, changes persist in localStorage. To reset: clear localStorage or re-Import the updated `data.json`.

To sync from the Google Sheet: export the `Roadmap` tab as CSV → run the generator script in the workspace `.context/gen_roadmap_csv.py`, then manually update `data.json` (or update it directly).

## Deploy

GitHub Pages serves directly from `main` branch root. Any push to main auto-deploys.
