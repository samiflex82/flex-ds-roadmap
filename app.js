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

// X is relative to the grid origin (the cards-layer lives inside .swimlane-grid,
// which already starts after the 200px label column).
function dateToX(date, weeks) {
  const ws = weekStart(date).getTime();
  const idx = weeks.findIndex(w => w.getTime() === ws);
  if (idx < 0) return -1;
  const dayOffset = (date.getTime() - ws) / DAY_MS;
  return idx * COL_W + (dayOffset / 7) * COL_W;
}

function xToDate(x, weeks) {
  const rawIdx = x / COL_W;
  const weekIdx = Math.max(0, Math.min(weeks.length - 1, Math.floor(rawIdx)));
  const dayFrac = rawIdx - weekIdx;
  const days = Math.round(dayFrac * 7);
  return addDays(weeks[weekIdx], days);
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

  const container = document.getElementById('week-headers');
  container.innerHTML = '';

  weeks.forEach(w => {
    const div = document.createElement('div');
    div.className = 'week-col';
    const fri = addDays(w, 4);
    const isCC  = w.getTime() === ccWeek;
    const isDep = w.getTime() === depWeek;
    if (isCC)  div.classList.add('target-cc');
    if (isDep) div.classList.add('target-deploy');
    const badge = isCC ? '◆ Code Complete' : isDep ? '🚀 Deploy' : '';
    div.innerHTML = `
      <span class="week-label">${w.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
      <span class="week-dates">${isDep||isCC ? badge : '→ ' + fri.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
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
      btn.onclick = () => {
        if (filterSet.has(v)) filterSet.delete(v); else filterSet.add(v);
        render();
      };
      c.appendChild(btn);
    });
  }
  makeGroup('filter-phase',      allPhases,   filters.phase,      v => phaseById(v)?.label || v);
  makeGroup('filter-status',     allStatuses, filters.status,     statusLabel,                 v => statusById(v)?.bg);
  makeGroup('filter-workstream', allWS,       filters.workstream, v => wsById(v)?.label || v,  v => wsById(v)?.color);
}

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
  const x2 = dateToX(endDate, weeks) + (COL_W / 7) * 1; // end of end-day
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

  const linear = item.linear ? ` · ${item.linear}` : '';
  card.innerHTML = `
    <div class="card-title">${item.title}</div>
    <div class="card-meta">${statusLabel(item.status)}${linear}</div>
    ${item.handsOffTo?.length ? '<div class="card-handoff-dot" title="Has handoff"></div>' : ''}
    <div class="resize-handle"></div>
  `;

  // Click to edit (not drag)
  card.addEventListener('click', e => {
    if (card.classList.contains('dragging')) return;
    if (e.target.classList.contains('resize-handle')) return;
    openModal(item.id);
  });

  setupDrag(card, item, weeks);
  setupResize(card.querySelector('.resize-handle'), item, weeks);
  return card;
}

// ─── Drag ─────────────────────────────────────────────────────────────────────
function setupDrag(card, item, weeks) {
  let startX, origLeft, origWidth, dragged = false;

  card.addEventListener('mousedown', e => {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    startX = e.clientX;
    origLeft = parseInt(card.style.left);
    origWidth = parseInt(card.style.width);
    dragged = false;

    function onMove(e) {
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) dragged = true;
      if (!dragged) return;
      card.classList.add('dragging');
      card.style.left = (origLeft + dx) + 'px';
    }

    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragged) { card.classList.remove('dragging'); return; }

      const dx = e.clientX - startX;
      const newLeft = origLeft + dx;
      const newStart = xToDate(newLeft, weeks);
      const duration = parseDate(item.end).getTime() - parseDate(item.start).getTime();
      const newEnd = new Date(newStart.getTime() + duration);

      item.start = fmtDate(newStart);
      item.end   = fmtDate(newEnd);
      save();
      render();
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

// ─── Handoff arrows ───────────────────────────────────────────────────────────
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
  items.forEach(item => {
    if (!item.handsOffTo?.length) return;
    const fromCard = document.querySelector(`.card[data-id="${item.id}"]`);
    if (!fromCard) return;

    item.handsOffTo.forEach(toOwner => {
      // find card owned by toOwner that starts after item.end and depends on this workstream
      const toItem = items.find(it =>
        it.owner === toOwner &&
        it.workstream === item.workstream &&
        parseDate(it.start) >= parseDate(item.end)
      );
      if (!toItem) return;
      const toCard = document.querySelector(`.card[data-id="${toItem.id}"]`);
      if (!toCard) return;

      const fromRect = fromCard.getBoundingClientRect();
      const toRect   = toCard.getBoundingClientRect();
      const outerRect = outer.getBoundingClientRect();
      const scrollLeft = document.getElementById('timeline-wrap').scrollLeft;
      const scrollTop  = document.getElementById('timeline-wrap').scrollTop;

      const x1 = fromRect.right  - outerRect.left + scrollLeft;
      const y1 = fromRect.top    - outerRect.top  + scrollTop + fromRect.height / 2;
      const x2 = toRect.left     - outerRect.left + scrollLeft;
      const y2 = toRect.top      - outerRect.top  + scrollTop + toRect.height / 2;

      const cx1 = x1 + 30;
      const cx2 = x2 - 30;

      const line = document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d', `M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}`);
      line.setAttribute('stroke', 'rgba(255,255,255,0.2)');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke-dasharray', '4 3');
      line.setAttribute('marker-end', 'url(#arrow)');
      svg.appendChild(line);
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(itemId) {
  editingId = itemId;
  const item = DATA.items.find(i => i.id === itemId);
  const isNew = !item;

  document.getElementById('modal-title').textContent = isNew ? 'New item' : 'Edit item';

  // populate owner select
  const ownerSel = document.getElementById('f-owner');
  ownerSel.innerHTML = DATA.people.map(p =>
    `<option value="${p.id}" ${!isNew && item.owner===p.id ? 'selected' : ''}>${p.name}</option>`
  ).join('');

  // workstream select
  const wsSel = document.getElementById('f-workstream');
  wsSel.innerHTML = DATA.workstreams.map(w =>
    `<option value="${w.id}" ${!isNew && item.workstream===w.id ? 'selected' : ''}>${w.label}</option>`
  ).join('');

  // handoff select
  const hSel = document.getElementById('f-handoff');
  hSel.innerHTML = DATA.people.map(p =>
    `<option value="${p.id}" ${!isNew && item.handsOffTo?.includes(p.id) ? 'selected' : ''}>${p.name}</option>`
  ).join('');

  // phase select (data-driven)
  document.getElementById('f-phase').innerHTML = DATA.phases.map(p =>
    `<option value="${p.id}">${p.label}</option>`).join('');
  // status select (data-driven)
  document.getElementById('f-status').innerHTML = DATA.statuses.map(s =>
    `<option value="${s.id}">${s.label}</option>`).join('');

  document.getElementById('f-title').value   = item?.title   || '';
  document.getElementById('f-phase').value   = item?.phase   || DATA.phases[0]?.id   || 'P1';
  document.getElementById('f-status').value  = item?.status  || DATA.statuses[0]?.id || 'to-ticket';
  document.getElementById('f-start').value   = item?.start   || DATA.meta.startDate;
  document.getElementById('f-end').value     = item?.end     || DATA.meta.startDate;
  document.getElementById('f-linear').value  = item?.linear  || '';
  document.getElementById('f-notes').value   = item?.notes   || '';

  document.getElementById('modal-delete').style.display = isNew ? 'none' : '';
  document.getElementById('modal-overlay').classList.remove('hidden');
}

document.getElementById('modal-cancel').onclick = closeModal;
document.getElementById('modal-overlay').onclick = e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
};

document.getElementById('modal-save').onclick = () => {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { alert('Title required'); return; }
  const handoff = [...document.getElementById('f-handoff').selectedOptions].map(o => o.value);

  if (editingId === null) {
    // new item
    const newId = Math.max(0, ...DATA.items.map(i => i.id)) + 1;
    DATA.items.push({
      id: newId,
      phase:      document.getElementById('f-phase').value,
      workstream: document.getElementById('f-workstream').value,
      title,
      owner:      document.getElementById('f-owner').value,
      handsOffTo: handoff,
      status:     document.getElementById('f-status').value,
      start:      document.getElementById('f-start').value,
      end:        document.getElementById('f-end').value,
      linear:     document.getElementById('f-linear').value.trim(),
      notes:      document.getElementById('f-notes').value.trim(),
    });
  } else {
    const item = DATA.items.find(i => i.id === editingId);
    Object.assign(item, {
      title,
      phase:      document.getElementById('f-phase').value,
      workstream: document.getElementById('f-workstream').value,
      owner:      document.getElementById('f-owner').value,
      handsOffTo: handoff,
      status:     document.getElementById('f-status').value,
      start:      document.getElementById('f-start').value,
      end:        document.getElementById('f-end').value,
      linear:     document.getElementById('f-linear').value.trim(),
      notes:      document.getElementById('f-notes').value.trim(),
    });
  }
  save();
  closeModal();
  render();
};

document.getElementById('modal-delete').onclick = () => {
  if (!confirm('Delete this item?')) return;
  DATA.items = DATA.items.filter(i => i.id !== editingId);
  save();
  closeModal();
  render();
};

function closeModal() {
  editingId = null;
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ─── Add button ───────────────────────────────────────────────────────────────
document.getElementById('btn-add').onclick = () => {
  editingId = null;
  openModal(null);
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

    // delete
    const del = document.createElement('button');
    del.className = 'row-delete';
    const used = usageCount(listKey, entry.id);
    if (used > 0) {
      del.textContent = `in use (${used})`;
      del.disabled = true;
      del.title = 'Reassign these items before deleting';
    } else {
      del.textContent = '✕';
      del.title = 'Delete';
      del.onclick = () => {
        DATA[listKey].splice(idx, 1);
        save();
        renderSettingsLists();
        render();
      };
    }
    row.appendChild(del);
    c.appendChild(row);
  });
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

// ─── Share ────────────────────────────────────────────────────────────────────
document.getElementById('btn-share').onclick = () => {
  const url = window.location.href.split('?')[0];
  const old = document.getElementById('share-banner');
  if (old) { old.remove(); return; }
  const banner = document.createElement('div');
  banner.id = 'share-banner';
  banner.innerHTML = `
    <span>Share link (read-only when opened)</span>
    <input type="text" value="${url}" readonly onclick="this.select()" />
    <button onclick="navigator.clipboard.writeText('${url}').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>
    <button onclick="this.closest('#share-banner').remove()">✕</button>
  `;
  document.body.appendChild(banner);
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // always fetch bundled seed so we can compare versions / offer reset
  try {
    const resp = await fetch('./data.json', { cache: 'no-store' });
    SEED = await resp.json();
  } catch { SEED = null; }

  const saved = localStorage.getItem('flex-ds-roadmap');
  if (saved) {
    let parsed = null;
    try { parsed = JSON.parse(saved); } catch {}
    if (parsed) {
      const savedV  = parsed.meta?.seedVersion ?? 0;
      const seedV   = SEED?.meta?.seedVersion ?? 0;
      if (SEED && seedV !== savedV) {
        const ok = confirm(
          'An updated roadmap is available (v' + seedV + ').\n\n' +
          'Load it? This replaces your local changes.\n' +
          'Cancel to keep your current version.'
        );
        if (ok) { loadData(JSON.parse(JSON.stringify(SEED))); save(); return; }
        // keep local, but stop nagging on every load
        parsed.meta = parsed.meta || {};
        parsed.meta.seedVersion = seedV;
        DATA = parsed; save(); render(); return;
      }
      // migrate: if old data is missing statuses/phases, graft from seed silently
      if (SEED && (!parsed.statuses || !parsed.phases)) {
        parsed.statuses = SEED.statuses;
        parsed.phases   = SEED.phases;
      }
      DATA = parsed; save(); render(); return;
    }
  }
  // no saved state → use seed
  DATA = SEED;
  render();
}

boot();
