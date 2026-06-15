/* Flex DS Swimlane Timeline
   – Pure vanilla JS, no dependencies
   – Drag cards left/right to move dates, click to edit
   – Arrow SVG shows handoff chains
   – localStorage autosave, JSON export/import
*/

// ─── Constants ───────────────────────────────────────────────────────────────
const COL_W = 180;  // px per week column (single source of truth; mirrored to CSS --col-w)
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const CARD_H = 34;  // px height of a single card
const V_GAP  = 6;   // px vertical gap between stacked cards
const LANE_PAD = 8; // px top/bottom padding inside a swimlane

let SEED = null;    // bundled data.json (for reset / version compare)
let READONLY = false;  // true when loaded from a snapshot link

// ─── State ───────────────────────────────────────────────────────────────────
let DATA = null;       // loaded from data.json or localStorage
let filters = { phase: new Set(), status: new Set(), workstream: new Set() };
let editingId = null;  // item id currently in modal

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseDate(s)  { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); }
function fmtDate(d)    { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function addDays(d, n) { return new Date(d.getTime() + n * DAY_MS); }

function weekStart(refDate) {
  // Monday of the week containing refDate
  const d = new Date(refDate);
  const day = d.getDay();               // 0=Sun
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0,0,0,0);
  return d;
}

// Weeks array: Monday dates spanning start→end of all items + some buffer
function buildWeeks() {
  const allDates = DATA.items.flatMap(i => [parseDate(i.start), parseDate(i.end)]);
  allDates.push(parseDate(DATA.meta.codeCompleteDate), parseDate(DATA.meta.deployDate));
  if (DATA.meta.timelineStart) allDates.push(parseDate(DATA.meta.timelineStart));
  const earliest = weekStart(new Date(Math.min(...allDates)));
  const latest   = weekStart(new Date(Math.max(...allDates)));
  const weeks = [];
  let cur = new Date(earliest);
  while (cur <= new Date(latest.getTime() + WEEK_MS)) {
    weeks.push(new Date(cur));
    cur = new Date(cur.getTime() + WEEK_MS);
  }
  return weeks;
}

function weekIndex(date, weeks) {
  const ms = weekStart(date).getTime();
  return weeks.findIndex(w => w.getTime() === ms);
}

// Working-day offset within its week: Mon=0 … Fri=4, weekends clamped to Fri.
function workdayOffset(date) {
  const day = date.getDay();          // 0=Sun..6=Sat
  if (day === 0) return 4;            // Sun → Fri
  if (day === 6) return 4;            // Sat → Fri
  return day - 1;                     // Mon(1)→0 … Fri(5)→4
}

// X is relative to the grid origin (the cards-layer lives inside .swimlane-grid,
// which already starts after the 200px label column). Columns are Mon–Fri (5 days).
function dateToX(date, weeks) {
  const ws = weekStart(date).getTime();
  const idx = weeks.findIndex(w => w.getTime() === ws);
  if (idx < 0) return -1;
  return idx * COL_W + (workdayOffset(date) / 5) * COL_W;
}

function xToDate(x, weeks) {
  const rawIdx = x / COL_W;
  const weekIdx = Math.max(0, Math.min(weeks.length - 1, Math.floor(rawIdx)));
  const dayFrac = rawIdx - weekIdx;
  const workday = Math.max(0, Math.min(4, Math.round(dayFrac * 5)));  // snap to Mon–Fri
  return addDays(weeks[weekIdx], workday);
}

function fmtShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function visibleItems() {
  return DATA.items.filter(item => {
    if (filters.phase.size      && !filters.phase.has(item.phase))            return false;
    if (filters.status.size     && !filters.status.has(item.status))          return false;
    if (filters.workstream.size && !filters.workstream.has(item.workstream))  return false;
    return true;
  });
}

function personById(id) { return DATA.people.find(p => p.id === id); }
function wsById(id)     { return DATA.workstreams.find(w => w.id === id); }
function statusById(id) { return (DATA.statuses || []).find(s => s.id === id); }
function phaseById(id)  { return (DATA.phases || []).find(p => p.id === id); }

function statusLabel(s) { return statusById(s)?.label || s; }

// Readable text color (black/white) for a given hex background.
function readableFg(hex) {
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.55 ? '#111111' : '#f5f5f5';
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || ('id-' + Math.abs(hashStr(s)));
}
function hashStr(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}return h;}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Build a Linear issue URL from an ID (DS-179) or pass through a full URL.
function linearUrl(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[A-Za-z]+-\d+$/.test(s)) {
    const org = (DATA.meta && DATA.meta.linearOrg) || 'get-flex';
    return `https://linear.app/${org}/issue/${s.toUpperCase()}`;
  }
  return null;
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('flex-ds-roadmap', JSON.stringify(DATA));
}

function loadData(json) {
  DATA = json;
  filters = { phase: new Set(), status: new Set(), workstream: new Set() };
  render();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  // single source of truth for column width — both headers and grid inherit it
  document.getElementById('timeline-outer').style.setProperty('--col-w', COL_W + 'px');
  const weeks = buildWeeks();
  renderWeekHeaders(weeks);
  renderFilters();
  renderLegend();
  renderSwimlanes(weeks);
  // arrows need a tick for layout to settle
  requestAnimationFrame(() => renderArrows(weeks));
}

function renderWeekHeaders(weeks) {
  const ccDate = parseDate(DATA.meta.codeCompleteDate);
  const depDate = parseDate(DATA.meta.deployDate);
  const ccWeek  = weekStart(ccDate).getTime();
  const depWeek = weekStart(depDate).getTime();
  const todayWeek = weekStart(new Date()).getTime();

  const container = document.getElementById('week-headers');
  container.innerHTML = '';

  weeks.forEach(w => {
    const div = document.createElement('div');
    div.className = 'week-col';
    const fri = addDays(w, 4);
    const isCC  = w.getTime() === ccWeek;
    const isDep = w.getTime() === depWeek;
    const isToday = w.getTime() === todayWeek;
    if (isToday) div.classList.add('target-today');
    if (isCC)  div.classList.add('target-cc');
    if (isDep) div.classList.add('target-deploy');
    const badge = isCC ? '◆ Code Complete' : isDep ? '🚀 Deploy' : isToday ? '● This week' : '';
    div.innerHTML = `
      <span class="week-label">${w.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
      <span class="week-dates">${(isDep||isCC||isToday) ? badge : '→ ' + fri.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
    `;
    container.appendChild(div);
  });
}

function renderFilters() {
  const allPhases    = (DATA.phases   || []).map(p => p.id);
  const allStatuses  = (DATA.statuses || []).map(s => s.id);
  const allWS        = DATA.workstreams.map(w => w.id);

  function makeGroup(containerId, values, filterSet, labelFn, colorFn) {
    const c = document.getElementById(containerId);
    c.innerHTML = '';
    values.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn' + (filterSet.has(v) ? ' active' : '');
      btn.textContent = labelFn(v);
      const accent = colorFn && colorFn(v);
      if (accent) {
        btn.style.setProperty('--chip', accent);
        const dot = document.createElement('span');
        dot.className = 'chip-dot';
        dot.style.background = accent;
        btn.prepend(dot);
      }
      btn.onclick = (ev) => {
        ev.stopPropagation();   // keep popover open; avoid detached-node close handler
        if (filterSet.has(v)) filterSet.delete(v); else filterSet.add(v);
        render();
      };
      c.appendChild(btn);
    });
  }
  makeGroup('filter-phase',      allPhases,   filters.phase,      v => phaseById(v)?.label || v);
  makeGroup('filter-status',     allStatuses, filters.status,     statusLabel,                 v => statusById(v)?.bg);
  makeGroup('filter-workstream', allWS,       filters.workstream, v => `${wsById(v)?.icon || ''} ${wsById(v)?.label || v}`.trim(), v => wsById(v)?.color);

  // active-filter count on the Filter button
  const count = filters.phase.size + filters.status.size + filters.workstream.size;
  const btn = document.getElementById('btn-filter');
  btn.textContent = count ? `Filter · ${count}` : 'Filter';
  btn.classList.toggle('has-filters', count > 0);
}

// Filter popover open/close + clear all
document.getElementById('btn-filter').onclick = e => {
  e.stopPropagation();
  document.getElementById('filter-popover').classList.toggle('hidden');
};
document.getElementById('btn-clear-filters').onclick = (e) => {
  e.stopPropagation();
  filters = { phase: new Set(), status: new Set(), workstream: new Set() };
  render();
};
// close popover on outside click
document.addEventListener('click', e => {
  const pop = document.getElementById('filter-popover');
  if (pop.classList.contains('hidden')) return;
  if (!e.target.closest('.filter-wrap')) pop.classList.add('hidden');
});

function renderLegend() {
  const c = document.getElementById('legend-swatches');
  c.innerHTML = '';
  (DATA.statuses || []).forEach(s => {
    const span = document.createElement('span');
    span.className = 'legend-swatch';
    span.textContent = s.label;
    span.style.background = s.bg;
    span.style.color = s.fg || readableFg(s.bg);
    c.appendChild(span);
  });
}

function renderSwimlanes(weeks) {
  const container = document.getElementById('swimlanes');
  container.innerHTML = '';

  const items = visibleItems();
  const ccWeek  = weekStart(parseDate(DATA.meta.codeCompleteDate)).getTime();
  const depWeek = weekStart(parseDate(DATA.meta.deployDate)).getTime();
  const todayWeek = weekStart(new Date()).getTime();

  DATA.people.forEach(person => {
    const personItems = items.filter(i => i.owner === person.id);
    if (!personItems.length) return;

    const lane = document.createElement('div');
    lane.className = 'swimlane';
    lane.dataset.owner = person.id;

    // Label
    const label = document.createElement('div');
    label.className = 'swimlane-label';
    label.style.borderLeft = `3px solid ${person.color}`;
    label.innerHTML = `<div class="swimlane-name">${person.name}</div><div class="swimlane-role">${person.role}</div>`;
    lane.appendChild(label);

    // Grid columns
    const grid = document.createElement('div');
    grid.className = 'swimlane-grid';
    weeks.forEach(w => {
      const col = document.createElement('div');
      col.className = 'grid-col';
      if (w.getTime() === todayWeek) col.classList.add('target-today');
      if (w.getTime() === ccWeek)  col.classList.add('target-cc');
      if (w.getTime() === depWeek) col.classList.add('target-deploy');
      grid.appendChild(col);
    });

    // Lane packing: assign each item to the first track with no date overlap.
    const tracks = packTracks(personItems);
    const laneHeight = LANE_PAD * 2 + tracks.count * CARD_H + (tracks.count - 1) * V_GAP;
    lane.style.minHeight = laneHeight + 'px';

    // Cards layer
    const cardsLayer = document.createElement('div');
    cardsLayer.className = 'cards-layer';

    personItems.forEach(item => {
      const card = buildCard(item, weeks, tracks.byId[item.id]);
      if (card) cardsLayer.appendChild(card);
    });
    grid.appendChild(cardsLayer);
    lane.appendChild(grid);
    container.appendChild(lane);
  });
}

// Greedy interval partitioning. Returns {count, byId:{itemId->trackIndex}}.
function packTracks(items) {
  const sorted = [...items].sort((a, b) => parseDate(a.start) - parseDate(b.start));
  const trackEnds = [];   // last end-date (ms) per track
  const byId = {};
  sorted.forEach(item => {
    const s = parseDate(item.start).getTime();
    const e = parseDate(item.end).getTime();
    let placed = -1;
    for (let t = 0; t < trackEnds.length; t++) {
      if (trackEnds[t] < s) { placed = t; break; }  // no overlap (strictly before)
    }
    if (placed === -1) { placed = trackEnds.length; trackEnds.push(e); }
    else trackEnds[placed] = e;
    byId[item.id] = placed;
  });
  return { count: Math.max(1, trackEnds.length), byId };
}

function buildCard(item, weeks, track) {
  const startDate = parseDate(item.start);
  const endDate   = parseDate(item.end);
  const x1 = dateToX(startDate, weeks);
  const x2 = dateToX(endDate, weeks) + (COL_W / 5) * 1; // fill through the end workday (Mon–Fri basis)
  const w  = Math.max(x2 - x1, 20);
  if (x1 < 0 || w < 1) return null;

  const ws = wsById(item.workstream);
  const st = statusById(item.status);
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = item.id;
  card.style.left   = x1 + 'px';
  card.style.width  = w + 'px';
  card.style.top    = (LANE_PAD + (track || 0) * (CARD_H + V_GAP)) + 'px';
  card.style.height = CARD_H + 'px';
  // colors are data-driven (statuses are editable)
  if (st) { card.style.background = st.bg; card.style.color = st.fg || readableFg(st.bg); }
  card.style.borderColor = 'rgba(255,255,255,0.1)';
  if (ws) { card.style.borderLeft = `3px solid ${ws.color}`; }

  const wsIcon = ws?.icon ? `${ws.icon} ` : '';
  const lUrl = linearUrl(item.linear);
  const linearHtml = item.linear
    ? (lUrl ? ` · <a class="card-link" href="${escapeHtml(lUrl)}" target="_blank" rel="noopener">${escapeHtml(item.linear)}</a>`
            : ` · ${escapeHtml(item.linear)}`)
    : '';
  card.innerHTML = `
    <div class="card-title">${wsIcon}${escapeHtml(item.title)}</div>
    <div class="card-meta">${escapeHtml(statusLabel(item.status))}${linearHtml}</div>
    <div class="link-handle" title="Drag to another card to set a dependency"></div>
    <div class="resize-handle"></div>
  `;
  // Linear link opens without triggering the card's edit-panel click
  const a = card.querySelector('.card-link');
  if (a) a.addEventListener('click', e => e.stopPropagation());

  // Click to edit (not drag/connect/link); skip entirely in read-only mode
  if (!READONLY) {
    card.addEventListener('click', e => {
      if (card.classList.contains('dragging')) return;
      if (e.target.classList.contains('resize-handle')) return;
      if (e.target.classList.contains('link-handle')) return;
      if (e.target.classList.contains('card-link')) return;
      openPanel(item.id);
    });
    setupDrag(card, item, weeks);
    setupResize(card.querySelector('.resize-handle'), item, weeks);
    setupConnect(card.querySelector('.link-handle'), item, weeks);
  } else {
    card.style.cursor = 'default';
  }
  return card;
}

// ─── Drag (move dates horizontally + reassign owner vertically) ───────────────
function setupDrag(card, item, weeks) {
  let startX, startY, origLeft, origTop, dragged = false;

  card.addEventListener('mousedown', e => {
    if (e.target.classList.contains('resize-handle')) return;
    if (e.target.classList.contains('link-handle')) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    origLeft = parseInt(card.style.left);
    origTop  = parseInt(card.style.top);
    dragged = false;

    function onMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
      if (!dragged) return;
      card.classList.add('dragging');
      card.style.left = (origLeft + dx) + 'px';
      card.style.top  = (origTop + dy) + 'px';   // follow cursor vertically too
      scheduleArrowRedraw(weeks);                // arrows track the card live
    }

    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragged) { card.classList.remove('dragging'); return; }

      // new dates from horizontal position
      const dx = e.clientX - startX;
      const newStart = xToDate(origLeft + dx, weeks);
      const duration = parseDate(item.end).getTime() - parseDate(item.start).getTime();
      const newEnd = new Date(newStart.getTime() + duration);
      item.start = fmtDate(newStart);
      item.end   = fmtDate(newEnd);

      // new owner from the lane under the cursor (skip the dragged card itself)
      card.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      card.style.pointerEvents = '';
      const lane = under && under.closest('.swimlane');
      if (lane && lane.dataset.owner && lane.dataset.owner !== item.owner) {
        item.owner = lane.dataset.owner;
      }

      save();
      render();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── Connect: drag the link-handle onto another card to create a connection ────
function setupConnect(handle, item, weeks) {
  if (!handle) return;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const outer = document.getElementById('timeline-outer');
    const wrap = document.getElementById('timeline-wrap');
    const startCard = handle.closest('.card');

    // temp line in the arrows svg layer
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
          if (i >= 0) item.blocking.splice(i, 1);   // toggle off if already linked
          else item.blocking.push(targetId);        // this item blocks the target
          save();
          render();
        }
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function setupResize(handle, item, weeks) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const card = handle.closest('.card');
    const startX = e.clientX;
    const origWidth = parseInt(card.style.width);

    function onMove(e) {
      const dx = e.clientX - startX;
      const newW = Math.max(20, origWidth + dx);
      card.style.width = newW + 'px';
      scheduleArrowRedraw(weeks);
    }

    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const dx = e.clientX - startX;
      const newW = origWidth + dx;
      const startDate = parseDate(item.start);
      const endX = parseInt(card.style.left) + Math.max(20, newW);
      const newEnd = xToDate(endX, weeks);
      if (newEnd > startDate) {
        item.end = fmtDate(newEnd);
        save();
        render();
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── Dependency arrows ────────────────────────────────────────────────────────
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
  marker.setAttribute('markerWidth','6');
  marker.setAttribute('markerHeight','6');
  marker.setAttribute('refX','5');
  marker.setAttribute('refY','3');
  marker.setAttribute('orient','auto');
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d','M0,0 L0,6 L6,3 z');
  path.setAttribute('fill','rgba(255,255,255,0.25)');
  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);

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
      if (!visibleIds.has(toId)) return;            // target filtered out — skip
      const toCard = document.querySelector(`.card[data-id="${toId}"]`);
      if (!toCard) return;

      const fromRect = fromCard.getBoundingClientRect();
      const toRect   = toCard.getBoundingClientRect();

      const x1 = fromRect.right  - outerRect.left + scrollLeft;
      const y1 = fromRect.top    - outerRect.top  + scrollTop + fromRect.height / 2;
      const x2 = toRect.left     - outerRect.left + scrollLeft;
      const y2 = toRect.top      - outerRect.top  + scrollTop + toRect.height / 2;

      const cx1 = x1 + 30;
      const cx2 = x2 - 30;
      const d = `M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}`;

      // visible line
      const line = document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d', d);
      line.setAttribute('stroke', 'rgba(124,79,208,0.6)');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke-dasharray', '4 3');
      line.setAttribute('marker-end', 'url(#arrow)');
      svg.appendChild(line);

      // fat invisible hit-target to click-remove the link
      const hit = document.createElementNS('http://www.w3.org/2000/svg','path');
      hit.setAttribute('d', d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '12');
      hit.setAttribute('fill', 'none');
      hit.style.cursor = 'pointer';
      hit.style.pointerEvents = 'stroke';
      hit.addEventListener('click', () => {
        if (READONLY) return;
        if (!confirm('Remove this dependency?')) return;
        item.blocking = item.blocking.filter(id => id !== toId);
        save();
        render();
      });
      svg.appendChild(hit);
    });
  });
}

// ─── Edit side panel ──────────────────────────────────────────────────────────
function depLabel(it) { return `${it.title} — ${personById(it.owner)?.name || ''}`; }

// Live-edited dependency chips (Blocking + Blocked by)
function renderDeps(item) {
  const itemById = id => DATA.items.find(x => x.id === id);
  item.blocking = item.blocking || [];

  const blockingBox  = document.getElementById('f-blocking');
  const blockedbyBox = document.getElementById('f-blockedby');
  const blockingAdd  = document.getElementById('f-blocking-add');
  const blockedbyAdd = document.getElementById('f-blockedby-add');

  const chip = (it, id) =>
    `<span class="dep-chip"><span>${escapeHtml(depLabel(it))}</span><span class="chip-x" data-id="${id}">×</span></span>`;

  // Blocking: items THIS one blocks
  const blk = item.blocking.map(itemById).filter(Boolean);
  blockingBox.innerHTML = blk.length ? blk.map(t => chip(t, t.id)).join('') : '<span class="dep-empty">None</span>';
  blockingBox.querySelectorAll('.chip-x').forEach(x => x.onclick = () => {
    item.blocking = item.blocking.filter(id => id !== Number(x.dataset.id));
    save(); renderDeps(item); render();
  });

  // Blocked by: items whose blocking includes this id (derived)
  const blockers = DATA.items.filter(o => (o.blocking || []).includes(item.id));
  blockedbyBox.innerHTML = blockers.length ? blockers.map(o => chip(o, o.id)).join('') : '<span class="dep-empty">None</span>';
  blockedbyBox.querySelectorAll('.chip-x').forEach(x => x.onclick = () => {
    const src = itemById(Number(x.dataset.id));
    if (src) src.blocking = (src.blocking || []).filter(id => id !== item.id);
    save(); renderDeps(item); render();
  });

  // Add pickers
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

function openPanel(itemId) {
  editingId = itemId;
  const item = DATA.items.find(i => i.id === itemId);
  const isNew = !item;

  document.getElementById('panel-title').textContent = isNew ? 'New item' : 'Edit item';

  document.getElementById('f-owner').innerHTML = DATA.people.map(p =>
    `<option value="${p.id}" ${!isNew && item.owner===p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  document.getElementById('f-workstream').innerHTML = DATA.workstreams.map(w =>
    `<option value="${w.id}" ${!isNew && item.workstream===w.id ? 'selected' : ''}>${escapeHtml((w.icon?w.icon+' ':'')+w.label)}</option>`).join('');
  document.getElementById('f-phase').innerHTML = DATA.phases.map(p =>
    `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  document.getElementById('f-status').innerHTML = DATA.statuses.map(s =>
    `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');

  document.getElementById('f-title').value   = item?.title   || '';
  document.getElementById('f-phase').value    = item?.phase   || DATA.phases[0]?.id   || 'P1';
  document.getElementById('f-status').value   = item?.status  || DATA.statuses[0]?.id || 'backlog';
  document.getElementById('f-start').value    = item?.start   || DATA.meta.startDate;
  document.getElementById('f-end').value      = item?.end     || DATA.meta.startDate;
  document.getElementById('f-linear').value   = item?.linear  || '';
  document.getElementById('f-notes').value    = item?.notes   || '';

  // Dependencies: only for saved items (need an id to relate to)
  const depBlocks = document.querySelectorAll('#panel .dep-block');
  depBlocks.forEach(b => b.style.display = isNew ? 'none' : '');
  if (!isNew) renderDeps(item);

  document.getElementById('panel-delete').style.display = isNew ? 'none' : '';
  document.getElementById('panel-overlay').classList.add('open');
}

document.getElementById('panel-cancel').onclick = closePanel;
document.getElementById('panel-overlay').onclick = e => {
  if (e.target === document.getElementById('panel-overlay')) closePanel();
};

document.getElementById('panel-save').onclick = () => {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { alert('Title required'); return; }
  const fields = {
    title,
    phase:      document.getElementById('f-phase').value,
    workstream: document.getElementById('f-workstream').value,
    owner:      document.getElementById('f-owner').value,
    status:     document.getElementById('f-status').value,
    start:      document.getElementById('f-start').value,
    end:        document.getElementById('f-end').value,
    linear:     document.getElementById('f-linear').value.trim(),
    notes:      document.getElementById('f-notes').value.trim(),
  };
  if (editingId === null) {
    const newId = Math.max(0, ...DATA.items.map(i => i.id)) + 1;
    DATA.items.push({ id: newId, ...fields, blocking: [] });
  } else {
    Object.assign(DATA.items.find(i => i.id === editingId), fields);
  }
  save();
  closePanel();
  render();
};

document.getElementById('panel-delete').onclick = () => {
  if (!confirm('Delete this item?')) return;
  const goneId = editingId;
  DATA.items = DATA.items.filter(i => i.id !== goneId);
  DATA.items.forEach(i => { if (i.blocking) i.blocking = i.blocking.filter(id => id !== goneId); });
  save();
  closePanel();
  render();
};

function closePanel() {
  editingId = null;
  document.getElementById('panel-overlay').classList.remove('open');
}

// ─── Add button ───────────────────────────────────────────────────────────────
document.getElementById('btn-add').onclick = () => {
  editingId = null;
  openPanel(null);
};

// ─── Export / Import ──────────────────────────────────────────────────────────
document.getElementById('btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flex-ds-roadmap-data.json';
  a.click();
};

document.getElementById('btn-import').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      loadData(JSON.parse(ev.target.result));
    } catch { alert('Invalid JSON file'); }
  };
  reader.readAsText(file);
};

// ─── Reset to seed ────────────────────────────────────────────────────────────
document.getElementById('btn-reset').onclick = () => {
  if (!SEED) { alert('Seed data not loaded.'); return; }
  if (!confirm('Reset to the bundled roadmap? This discards your local changes.')) return;
  loadData(JSON.parse(JSON.stringify(SEED)));
  save();
};

// ─── Settings / Manage panel ──────────────────────────────────────────────────
const settingsOverlay = document.getElementById('settings-overlay');

document.getElementById('btn-manage').onclick = openSettings;
document.getElementById('settings-close').onclick = closeSettings;
settingsOverlay.onclick = e => { if (e.target === settingsOverlay) closeSettings(); };

function openSettings() {
  document.getElementById('s-cc-date').value     = DATA.meta.codeCompleteDate || '';
  document.getElementById('s-deploy-date').value = DATA.meta.deployDate || '';
  renderSettingsLists();
  settingsOverlay.classList.remove('hidden');
}
function closeSettings() { settingsOverlay.classList.add('hidden'); }

// key-date inputs commit immediately
document.getElementById('s-cc-date').onchange = e => {
  if (e.target.value) { DATA.meta.codeCompleteDate = e.target.value; save(); render(); }
};
document.getElementById('s-deploy-date').onchange = e => {
  if (e.target.value) { DATA.meta.deployDate = e.target.value; save(); render(); }
};

// count of items referencing a given list entry (for delete-safety)
function usageCount(listKey, id) {
  switch (listKey) {
    case 'people':      return DATA.items.filter(i => i.owner === id || (i.handsOffTo||[]).includes(id)).length;
    case 'workstreams': return DATA.items.filter(i => i.workstream === id).length;
    case 'statuses':    return DATA.items.filter(i => i.status === id).length;
    case 'phases':      return DATA.items.filter(i => i.phase === id).length;
  }
  return 0;
}

function renderSettingsLists() {
  renderSettingsList('people',      'list-people');
  renderSettingsList('workstreams', 'list-workstreams');
  renderSettingsList('statuses',    'list-statuses');
  renderSettingsList('phases',      'list-phases');
}

function renderSettingsList(listKey, containerId) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  DATA[listKey].forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = 'settings-row';

    // color (people/workstreams use .color; statuses use .bg; phases have none)
    const hasColor = listKey === 'people' || listKey === 'workstreams' || listKey === 'statuses';
    if (hasColor) {
      const colorKey = listKey === 'statuses' ? 'bg' : 'color';
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.value = entry[colorKey] || '#888888';
      swatch.title = 'Color';
      swatch.oninput = () => { entry[colorKey] = swatch.value; save(); render(); };
      row.appendChild(swatch);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'swatch-spacer';
      row.appendChild(spacer);
    }

    // primary label (name for people, label for others)
    const labelKey = listKey === 'people' ? 'name' : 'label';
    const label = document.createElement('input');
    label.type = 'text';
    label.value = entry[labelKey] || '';
    label.placeholder = listKey === 'people' ? 'Name' : 'Label';
    label.oninput = () => { entry[labelKey] = label.value; save(); render(); };
    row.appendChild(label);

    // role for people
    if (listKey === 'people') {
      const role = document.createElement('input');
      role.type = 'text';
      role.value = entry.role || '';
      role.placeholder = 'Role';
      role.oninput = () => { entry.role = role.value; save(); render(); };
      row.appendChild(role);
    }

    // emoji icon for workstreams
    if (listKey === 'workstreams') {
      const icon = document.createElement('input');
      icon.type = 'text';
      icon.value = entry.icon || '';
      icon.placeholder = '🎨';
      icon.className = 'icon-input';
      icon.maxLength = 4;
      icon.oninput = () => { entry.icon = icon.value; save(); render(); };
      row.appendChild(icon);
    }

    // delete (with reassignment when in use)
    const del = document.createElement('button');
    del.className = 'row-delete';
    const used = usageCount(listKey, entry.id);
    del.textContent = used > 0 ? `✕ (${used})` : '✕';
    del.title = used > 0 ? `Used by ${used} item(s) — reassign on delete` : 'Delete';
    del.onclick = () => startDelete(listKey, idx, entry, used, row);
    row.appendChild(del);
    c.appendChild(row);
  });
}

// Delete a list entry; if in use, require reassigning its items to another entry first.
function startDelete(listKey, idx, entry, used, row) {
  if (used === 0) {
    DATA[listKey].splice(idx, 1);
    save(); renderSettingsLists(); render();
    return;
  }
  const others = DATA[listKey].filter(e => e.id !== entry.id);
  if (!others.length) {
    alert(`Can't delete the last ${listKey.replace(/s$/,'')} while ${used} item(s) use it. Add another first.`);
    return;
  }
  // inline reassignment UI in place of the row's controls
  const labelOf = e => listKey === 'people' ? e.name : e.label;
  const picker = document.createElement('div');
  picker.className = 'reassign-bar';
  picker.innerHTML = `<span>Move ${used} item(s) to:</span>`;
  const sel = document.createElement('select');
  sel.innerHTML = others.map(e => `<option value="${e.id}">${escapeHtml(labelOf(e) || e.id)}</option>`).join('');
  const go = document.createElement('button');
  go.className = 'btn-primary'; go.textContent = 'Move & delete';
  const cancel = document.createElement('button');
  cancel.id = 'reassign-cancel'; cancel.textContent = 'Cancel';
  go.onclick = () => { reassignAndDelete(listKey, entry.id, sel.value); save(); renderSettingsLists(); render(); };
  cancel.onclick = () => renderSettingsLists();
  picker.append(sel, go, cancel);
  row.replaceWith(picker);
}

function reassignAndDelete(listKey, fromId, toId) {
  DATA.items.forEach(it => {
    if (listKey === 'people') {
      if (it.owner === fromId) it.owner = toId;
      if (it.handsOffTo) it.handsOffTo = [...new Set(it.handsOffTo.map(o => o === fromId ? toId : o))];
    } else if (listKey === 'workstreams' && it.workstream === fromId) it.workstream = toId;
    else if (listKey === 'statuses' && it.status === fromId) it.status = toId;
    else if (listKey === 'phases'   && it.phase  === fromId) it.phase  = toId;
  });
  DATA[listKey] = DATA[listKey].filter(e => e.id !== fromId);
}

// + Add buttons
document.querySelectorAll('.add-row').forEach(btn => {
  btn.onclick = () => {
    const listKey = btn.dataset.list;
    const baseLabel = { people:'New person', workstreams:'New workstream',
                        statuses:'New status', phases:'New phase' }[listKey];
    let id = slugify(baseLabel);
    while (DATA[listKey].some(e => e.id === id)) id += '-' + (DATA[listKey].length + 1);
    if (listKey === 'people')      DATA[listKey].push({ id, name: baseLabel, role: '', color: '#7C6FCD' });
    else if (listKey === 'workstreams') DATA[listKey].push({ id, label: baseLabel, color: '#6366F1' });
    else if (listKey === 'statuses')    DATA[listKey].push({ id, label: baseLabel, bg: '#334155', fg: '#e2e8f0' });
    else if (listKey === 'phases')      DATA[listKey].push({ id, label: baseLabel });
    save();
    renderSettingsLists();
    render();
  };
});

// ─── Snapshot encode/decode (gzip+base64url → URL hash) ─────────────────────
async function encodeSnapshot(data) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  try {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(json);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0; chunks.forEach(c => { buf.set(c, off); off += c.length; });
    let s = ''; buf.forEach(b => s += String.fromCharCode(b));
    return 'g:' + btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  } catch {
    // fallback: raw base64url (no compression, older browsers)
    let s = ''; json.forEach(b => s += String.fromCharCode(b));
    return 'r:' + btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }
}

async function decodeSnapshot(payload) {
  const prefix = payload.slice(0, 2);
  const b64 = payload.slice(2).replace(/-/g,'+').replace(/_/g,'/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (prefix === 'g:') {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0; chunks.forEach(c => { buf.set(c, off); off += c.length; });
    return JSON.parse(new TextDecoder().decode(buf));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ─── Read-only banner (shown when READONLY = true) ───────────────────────────
function showReadonlyBanner() {
  const b = document.createElement('div');
  b.id = 'readonly-banner';
  b.innerHTML = `
    <span>📋 Read-only snapshot</span>
    <button id="btn-edit-copy">Edit a copy</button>
  `;
  document.getElementById('header').after(b);
  document.getElementById('btn-edit-copy').onclick = () => {
    localStorage.setItem('flex-ds-roadmap', JSON.stringify(DATA));
    location.hash = '';
    location.reload();
  };
}

// ─── Share ────────────────────────────────────────────────────────────────────
document.getElementById('btn-share').onclick = async () => {
  const old = document.getElementById('share-banner');
  if (old) { old.remove(); return; }
  const payload = await encodeSnapshot(DATA);
  const base = window.location.href.split('#')[0].split('?')[0];
  const url = base + '#s=' + payload;
  const banner = document.createElement('div');
  banner.id = 'share-banner';
  banner.innerHTML = `
    <span>Snapshot link — opens read-only for anyone</span>
    <input id="snapshot-url" type="text" value="${url}" readonly onclick="this.select()" />
    <button id="snap-copy">Copy</button>
    <button onclick="this.closest('#share-banner').remove()">✕</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('snap-copy').onclick = function() {
    navigator.clipboard.writeText(url).then(() => {
      this.textContent = 'Copied!';
      setTimeout(() => { this.textContent = 'Copy'; }, 1500);
    });
  };
};

// ─── Migration (non-destructive: keep the user's edits, layer in new structure) ─
function seedLinksFromHandoff(items) {
  items.forEach(item => {
    (item.handsOffTo || []).forEach(toOwner => {
      const target = items.find(it =>
        it.owner === toOwner &&
        it.workstream === item.workstream &&
        parseDate(it.start) >= parseDate(item.end)
      );
      if (target && target.id !== item.id && !item.blocking.includes(target.id)) {
        item.blocking.push(target.id);
      }
    });
  });
}

function migrate(data) {
  data.meta = data.meta || {};
  const v = data.meta.seedVersion ?? 0;

  // always guarantee shape
  data.items = data.items || [];
  const statusRemap = { 'in-eng': 'in-development', 'not-started': 'backlog', '': 'backlog' };

  if (v < 3) {
    // global taxonomy: adopt the new status list (safe — it's config, not her item data)
    if (SEED?.statuses) data.statuses = SEED.statuses;
    if (!data.phases) data.phases = SEED?.phases || [{id:'P1',label:'P1'},{id:'P2',label:'P2'},{id:'P3',label:'P3'}];
    const iconById = {};
    (SEED?.workstreams || []).forEach(w => { if (w.icon) iconById[w.id] = w.icon; });
    (data.workstreams || []).forEach(w => { if (!w.icon && iconById[w.id]) w.icon = iconById[w.id]; });
    if (SEED?.meta?.timelineStart && !data.meta.timelineStart) data.meta.timelineStart = SEED.meta.timelineStart;
  }

  // per-item: remap statuses, default phase, rename linksTo → blocking, ensure arrays
  data.items.forEach(it => {
    it.status = statusRemap[it.status] ?? (it.status || 'backlog');
    if (!it.phase) it.phase = 'P1';
    if (it.linksTo && !it.blocking) it.blocking = it.linksTo;   // v3→v4 rename
    delete it.linksTo;
    if (!Array.isArray(it.blocking)) it.blocking = [];
    if (!Array.isArray(it.handsOffTo)) it.handsOffTo = [];
  });
  if (v < 3 && !data.items.some(it => it.blocking.length)) seedLinksFromHandoff(data.items);

  // v<4: Flex black-theme refresh — re-apply seed status colors + workstream colors (preserve custom entries/labels)
  if (v < 4) {
    if (SEED?.statuses) {
      const byId = Object.fromEntries(SEED.statuses.map(s => [s.id, s]));
      (data.statuses || []).forEach(s => { if (byId[s.id]) { s.bg = byId[s.id].bg; s.fg = byId[s.id].fg; } });
    }
    if (SEED?.workstreams) {
      const byId = Object.fromEntries(SEED.workstreams.map(w => [w.id, w]));
      (data.workstreams || []).forEach(w => { if (byId[w.id]) w.color = byId[w.id].color; });
    }
    if (SEED?.meta?.linearOrg && !data.meta.linearOrg) data.meta.linearOrg = SEED.meta.linearOrg;
  }

  data.meta.seedVersion = Math.max(v, SEED?.meta?.seedVersion ?? v, 4);
}

// ─── Initial scroll to the current week (once) ────────────────────────────────
let didInitialScroll = false;
function scrollToCurrentWeek() {
  if (didInitialScroll) return;
  didInitialScroll = true;
  const weeks = buildWeeks();
  const idx = weeks.findIndex(w => w.getTime() === weekStart(new Date()).getTime());
  if (idx > 0) {
    requestAnimationFrame(() => { document.getElementById('timeline-wrap').scrollLeft = idx * COL_W; });
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // Check for snapshot hash first — if present, decode and show read-only
  const hash = location.hash;
  if (hash.startsWith('#s=')) {
    try {
      DATA = await decodeSnapshot(hash.slice(3));
      READONLY = true;
      document.body.classList.add('readonly');
      render();
      showReadonlyBanner();
      scrollToCurrentWeek();
      return;
    } catch { /* corrupt/too-old hash — fall through to normal load */ }
  }

  // Normal boot: fetch bundled seed, migrate localStorage
  try {
    const resp = await fetch('./data.json', { cache: 'no-store' });
    SEED = await resp.json();
  } catch { SEED = null; }

  const saved = localStorage.getItem('flex-ds-roadmap');
  let parsed = null;
  if (saved) { try { parsed = JSON.parse(saved); } catch {} }

  if (parsed) {
    migrate(parsed);          // in-place, non-destructive — never wipes edits
    DATA = parsed;
    save();
  } else {
    DATA = SEED;              // fresh browser → use committed baseline
  }
  render();
  scrollToCurrentWeek();
}

boot();
