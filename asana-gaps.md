# Asana Timeline — gap analysis (parked ideas)

Comparison of Asana's Timeline/Gantt against our tool, with candidate features to add later.
Researched from Asana's public docs + general product knowledge (Jun 2026).

## Things Asana does that we don't (candidate additions)

### 1. Auto-shifting dependencies  ★ highest value
When you move a task in Asana, every *dependent* task automatically shifts to keep the gap.
The whole chain re-flows. We removed our dependency arrows (see `parked-connections.md`).
**If we revisit connections, build THIS** — not just lines, but "move a blocker → its
dependents slide with it." That's what makes dependencies useful vs. decorative.

### 2. Milestones as a first-class type  ★ easy + high value
Asana milestones are a distinct entity (diamond marker, not a bar) for hard dates
("Legal sign-off", "QA gate"). We render everything as a bar.
**Add:** `item.type: "milestone"` → render a vertical diamond marker instead of a date-range bar.
Low effort, great for leadership-facing hard dates.

### 3. Baseline / planned-vs-actual overlay
Asana snapshots a baseline and overlays it semi-transparently so you see schedule slip.
**Add:** a "Snapshot baseline" button storing each item's current start/end; render a faint
ghost bar behind the live bar. Strong leadership signal ("planned X, tracking Y"). Medium effort.

### 4. Per-lane workload / capacity signal
Asana has a Workload view showing each person's load over time (who's overloaded).
**Lightweight version:** a small heat bar under each swimlane label = count of active items
per week. Flags over-allocation at a glance.

### 5. Critical path highlighting
Toggle that highlights the dependency chain determining the end date; greys the rest.
Requires dependencies back first. Compelling reason to rebuild #1 well.

### 6. In-timeline task creation
Asana lets you click a spot on a row to create a task in place. We only have "+ Add".
Minor UX nicety.

### 7. Cross-project dependencies
Asana links tasks across projects. Not relevant to our single-board use case yet.

## Things WE already do better than Asana
- Mon–Fri-only columns (Asana always shows weekends)
- Distinct current-week column highlight (Asana = thin "today" line)
- Drag a card into another person's row to reassign owner
- Shareable snapshot link that needs **no login** (Asana requires an account)
- Workstream emoji + fully custom colors, branded
- Manual vertical ordering within a lane (drag up/down)
- Free, no per-seat cost (Asana Timeline needs paid Starter+ at ~$11–25/user/mo)

## Suggested priority if we invest further
1. **Milestones** (diamond markers) — quick, high leadership value
2. **Auto-shifting dependencies** — the "real" version of connections, if revisited
3. **Baseline overlay** — planned-vs-actual for leadership
4. **Per-lane load indicator** — capacity at a glance
