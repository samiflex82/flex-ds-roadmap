# Parked: Connections / Dependency feature

Removed from the live tool in Iteration 6 (felt broken in use). The `blocking`
field is **left intact in `data.json`** so this can be restored later without data loss.
To bring it back: re-add the pieces below to `app.js`, `style.css`, `index.html`,
re-add `setupConnect(...)` + the `link-handle` div in `buildCard`, re-add the
`renderArrows(weeks)` call in `render()`, and the `scheduleArrowRedraw(weeks)` calls
in `setupDrag`/`setupResize` `onMove`.

Data model: `item.blocking = [itemId, …]` — "this item blocks those". Arrow drawn blocker → blocked.

---

## app.js — buildCard innerHTML (the connector handle)
```html
<div class="link-handle" title="Drag to another card to set a dependency"></div>
```
And in buildCard, after wiring drag/resize:
```js
setupConnect(card.querySelector('.link-handle'), item, weeks);
```
Also guard the card click + drag against the handle:
```js
if (e.target.classList.contains('link-handle')) return;
```

## app.js — setupConnect (drag a handle onto another card to toggle a dependency)
```js
function setupConnect(handle, item, weeks) {
  if (!handle) return;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const outer = document.getElementById('timeline-outer');
    const wrap = document.getElementById('timeline-wrap');
    const startCard = handle.closest('.card');

    let svg = document.getElementById('arrows-svg');
    const tmp = document.createElementNS('http://www.w3.org/2000/svg','path');
    tmp.setAttribute('stroke', '#6A3DB8');
    tmp.setAttribute('stroke-width', '2');
    tmp.setAttribute('fill', 'none');
    if (svg) svg.appendChild(tmp);

    function ptInOuter(clientX, clientY) {
      const r = outer.getBoundingClientRect();
      return { x: clientX - r.left + wrap.scrollLeft, y: clientY - r.top + wrap.scrollTop };
    }
    const sRect = startCard.getBoundingClientRect();
    const start = ptInOuter(sRect.right, sRect.top + sRect.height / 2);

    function onMove(e) {
      const p = ptInOuter(e.clientX, e.clientY);
      tmp.setAttribute('d', `M${start.x},${start.y} L${p.x},${p.y}`);
    }
    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (tmp.parentNode) tmp.remove();
      handle.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      handle.style.pointerEvents = '';
      const targetCard = under && under.closest('.card');
      if (targetCard) {
        const targetId = Number(targetCard.dataset.id);
        if (targetId !== item.id) {
          item.blocking = item.blocking || [];
          const i = item.blocking.indexOf(targetId);
          if (i >= 0) item.blocking.splice(i, 1);
          else item.blocking.push(targetId);
          save();
          render();
        }
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
```

## app.js — arrow rendering (+ rAF throttle used during drag/resize)
```js
let _arrowRAF = null;
function scheduleArrowRedraw(weeks) {
  if (_arrowRAF) return;
  _arrowRAF = requestAnimationFrame(() => { _arrowRAF = null; renderArrows(weeks); });
}

function renderArrows(weeks) {
  const old = document.getElementById('arrows-svg');
  if (old) old.remove();

  const outer = document.getElementById('timeline-outer');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'arrows-svg';
  svg.setAttribute('width',  outer.scrollWidth);
  svg.setAttribute('height', outer.scrollHeight);
  outer.appendChild(svg);

  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg','marker');
  marker.setAttribute('id','arrow');
  marker.setAttribute('markerWidth','6'); marker.setAttribute('markerHeight','6');
  marker.setAttribute('refX','5'); marker.setAttribute('refY','3');
  marker.setAttribute('orient','auto');
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d','M0,0 L0,6 L6,3 z');
  path.setAttribute('fill','rgba(255,255,255,0.25)');
  marker.appendChild(path); defs.appendChild(marker); svg.appendChild(defs);

  const items = visibleItems();
  const visibleIds = new Set(items.map(i => i.id));
  const outerRect = outer.getBoundingClientRect();
  const scrollLeft = document.getElementById('timeline-wrap').scrollLeft;
  const scrollTop  = document.getElementById('timeline-wrap').scrollTop;

  items.forEach(item => {
    if (!item.blocking?.length) return;
    const fromCard = document.querySelector(`.card[data-id="${item.id}"]`);
    if (!fromCard) return;
    item.blocking.forEach(toId => {
      if (!visibleIds.has(toId)) return;
      const toCard = document.querySelector(`.card[data-id="${toId}"]`);
      if (!toCard) return;
      const fromRect = fromCard.getBoundingClientRect();
      const toRect   = toCard.getBoundingClientRect();
      const x1 = fromRect.right - outerRect.left + scrollLeft;
      const y1 = fromRect.top   - outerRect.top  + scrollTop + fromRect.height / 2;
      const x2 = toRect.left    - outerRect.left + scrollLeft;
      const y2 = toRect.top     - outerRect.top  + scrollTop + toRect.height / 2;
      const d = `M${x1},${y1} C${x1+30},${y1} ${x2-30},${y2} ${x2},${y2}`;
      const line = document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d', d);
      line.setAttribute('stroke', 'rgba(124,79,208,0.6)');
      line.setAttribute('stroke-width', '1.5'); line.setAttribute('fill', 'none');
      line.setAttribute('stroke-dasharray', '4 3'); line.setAttribute('marker-end', 'url(#arrow)');
      svg.appendChild(line);
      const hit = document.createElementNS('http://www.w3.org/2000/svg','path');
      hit.setAttribute('d', d); hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '12'); hit.setAttribute('fill', 'none');
      hit.style.cursor = 'pointer'; hit.style.pointerEvents = 'stroke';
      hit.addEventListener('click', () => {
        if (READONLY) return;
        if (!confirm('Remove this dependency?')) return;
        item.blocking = item.blocking.filter(id => id !== toId);
        save(); render();
      });
      svg.appendChild(hit);
    });
  });
}
```
Call `requestAnimationFrame(() => renderArrows(weeks));` at the end of `render()`.

## app.js — panel dependency chips (Blocking / Blocked by)
```js
function depLabel(it) { return `${it.title} — ${personById(it.owner)?.name || ''}`; }

function renderDeps(item) {
  const itemById = id => DATA.items.find(x => x.id === id);
  item.blocking = item.blocking || [];
  const blockingBox  = document.getElementById('f-blocking');
  const blockedbyBox = document.getElementById('f-blockedby');
  const blockingAdd  = document.getElementById('f-blocking-add');
  const blockedbyAdd = document.getElementById('f-blockedby-add');
  const chip = (it, id) =>
    `<span class="dep-chip"><span>${escapeHtml(depLabel(it))}</span><span class="chip-x" data-id="${id}">×</span></span>`;
  const blk = item.blocking.map(itemById).filter(Boolean);
  blockingBox.innerHTML = blk.length ? blk.map(t => chip(t, t.id)).join('') : '<span class="dep-empty">None</span>';
  blockingBox.querySelectorAll('.chip-x').forEach(x => x.onclick = () => {
    item.blocking = item.blocking.filter(id => id !== Number(x.dataset.id));
    save(); renderDeps(item); render();
  });
  const blockers = DATA.items.filter(o => (o.blocking || []).includes(item.id));
  blockedbyBox.innerHTML = blockers.length ? blockers.map(o => chip(o, o.id)).join('') : '<span class="dep-empty">None</span>';
  blockedbyBox.querySelectorAll('.chip-x').forEach(x => x.onclick = () => {
    const src = itemById(Number(x.dataset.id));
    if (src) src.blocking = (src.blocking || []).filter(id => id !== item.id);
    save(); renderDeps(item); render();
  });
  const opt = it => `<option value="${it.id}">${escapeHtml(depLabel(it))}</option>`;
  blockingAdd.innerHTML = '<option value="">＋ Add item this blocks…</option>' +
    DATA.items.filter(it => it.id !== item.id && !item.blocking.includes(it.id)).map(opt).join('');
  blockingAdd.onchange = () => {
    const id = Number(blockingAdd.value); if (!id) return;
    item.blocking.push(id); save(); renderDeps(item); render();
  };
  blockedbyAdd.innerHTML = '<option value="">＋ Add item that blocks this…</option>' +
    DATA.items.filter(it => it.id !== item.id && !(it.blocking || []).includes(item.id)).map(opt).join('');
  blockedbyAdd.onchange = () => {
    const id = Number(blockedbyAdd.value); if (!id) return;
    const src = itemById(id); if (src) { src.blocking = src.blocking || []; src.blocking.push(item.id); }
    save(); renderDeps(item); render();
  };
}
```
In `openPanel`, after the scalar fields:
```js
const depBlocks = document.querySelectorAll('#panel .dep-block');
depBlocks.forEach(b => b.style.display = isNew ? 'none' : '');
if (!isNew) renderDeps(item);
```
On item delete, drop refs: `DATA.items.forEach(i => { if (i.blocking) i.blocking = i.blocking.filter(id => id !== goneId); });`

## index.html — panel dependency sections (place before the Linear field)
```html
<div class="dep-block">
  <span class="filter-label">Blocking (this must finish first →)</span>
  <div id="f-blocking" class="dep-chips"></div>
  <select id="f-blocking-add" class="dep-add"></select>
</div>
<div class="dep-block">
  <span class="filter-label">Blocked by (← waits on)</span>
  <div id="f-blockedby" class="dep-chips"></div>
  <select id="f-blockedby-add" class="dep-add"></select>
</div>
```

## style.css — arrows, handle, chips
```css
.link-handle {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  width: 11px; height: 11px; border-radius: 50%;
  background: rgba(255,255,255,0.18); border: 1.5px solid rgba(255,255,255,0.45);
  cursor: crosshair; opacity: 0; transition: opacity 0.12s;
}
.card:hover .link-handle { opacity: 1; }
.link-handle:hover { background: var(--accent); border-color: var(--accent-hover); }
body.readonly .link-handle { display: none !important; }

#arrows-svg { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 5; overflow: visible; }

.dep-block { display: flex; flex-direction: column; gap: 6px; }
.dep-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dep-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface-3);
  border: 1px solid var(--border); border-radius: 5px; padding: 3px 6px 3px 9px; font-size: 12px; color: var(--text); max-width: 100%; }
.dep-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dep-chip .chip-x { cursor: pointer; color: var(--text-3); font-size: 14px; line-height: 1; flex-shrink: 0; }
.dep-chip .chip-x:hover { color: var(--danger); }
.dep-empty { font-size: 12px; color: var(--text-3); font-style: italic; }
.dep-add { background: var(--surface-3); border: 1px solid var(--border); border-radius: 5px; color: var(--text-2); padding: 6px 9px; font-size: 12px; }
```

## Known issue to fix when revisiting
Arrows felt unreliable when dragging connected cards (curve endpoints lagged / looked
"wonky"). The rAF redraw during drag helped but wasn't fully smooth. Consider: drawing arrows
into a single persistent `<svg>` that's updated (not torn down) per frame, or anchoring arrows
to card edge coordinates computed from data (dateToX) instead of `getBoundingClientRect`.
