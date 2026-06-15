/* Flex DS Swimlane Timeline
   – Pure vanilla JS, no dependencies
   – Drag cards left/right to move dates, click to edit
   – Arrow SVG shows handoff chains
   – localStorage autosave, JSON export/import
*/

// ─── Constants ───────────────────────────────────────────────────────────────
const COL_W = 130;  // px per week column
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

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

function dateToX(date, weeks) {
  const ws = weekStart(date).getTime();
  const idx = weeks.findIndex(w => w.getTime() === ws);
  if (idx < 0) return -1;
  const dayOffset = (date.getTime() - ws) / DAY_MS;
  return 200 + idx * COL_W + (dayOffset / 7) * COL_W;
}

function xToDate(x, weeks) {
  const relX = x - 200;
  const rawIdx = relX / COL_W;
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

function statusLabel(s) {
  return { done:'Done','in-eng':'In eng','in-design':'In design','to-ticket':'To ticket',
           'blocked':'Blocked/decision','not-started':'Not started' }[s] || s;
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
  const weeks = buildWeeks();
  renderWeekHeaders(weeks);
  renderFilters();
  renderStats();
  renderProjectedBadge();
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
  container.style.setProperty('--col-w', COL_W + 'px');

  weeks.forEach(w => {
    const div = document.createElement('div');
    div.className = 'week-col';
    div.style.setProperty('--col-w', COL_W + 'px');
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
  const allPhases    = [...new Set(DATA.items.map(i => i.phase))].sort();
  const allStatuses  = ['done','in-eng','in-design','to-ticket','blocked','not-started'];
  const allWS        = DATA.workstreams.map(w => w.id);

  function makeGroup(containerId, values, filterSet, labelFn) {
    const c = document.getElementById(containerId);
    c.innerHTML = '';
    values.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn' + (filterSet.has(v) ? ' active' : '');
      btn.textContent = labelFn(v);
      btn.onclick = () => {
        if (filterSet.has(v)) filterSet.delete(v); else filterSet.add(v);
        render();
      };
      c.appendChild(btn);
    });
  }
  makeGroup('filter-phase',      allPhases,   filters.phase,      v => v);
  makeGroup('filter-status',     allStatuses, filters.status,     statusLabel);
  makeGroup('filter-workstream', allWS,       filters.workstream, v => wsById(v)?.label || v);
}

function renderStats() {
  const items = DATA.items;
  const done = items.filter(i => i.status === 'done').length;
  document.getElementById('header-stats').textContent =
    `${done}/${items.length} done · Code complete ${DATA.meta.codeCompleteDate} · Deploy ${DATA.meta.deployDate}`;
}

function renderProjectedBadge() {
  const target = parseDate(DATA.meta.codeCompleteDate);
  const p1Items = DATA.items.filter(i => i.phase === 'P1');
  if (!p1Items.length) return;
  const latest = new Date(Math.max(...p1Items.map(i => parseDate(i.end).getTime())));
  const badge = document.getElementById('projected-badge');
  const diffDays = Math.round((latest.getTime() - target.getTime()) / DAY_MS);
  if (diffDays <= 0) {
    badge.className = 'projected-badge on-track';
    badge.textContent = diffDays === 0 ? 'On track — Jul 24' : `${Math.abs(diffDays)}d early`;
  } else if (diffDays <= 7) {
    badge.className = 'projected-badge at-risk';
    badge.textContent = `At risk — +${diffDays}d`;
  } else {
    badge.className = 'projected-badge off-track';
    badge.textContent = `Off track — +${diffDays}d`;
  }
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

    // Cards layer
    const cardsLayer = document.createElement('div');
    cardsLayer.className = 'cards-layer';

    personItems.forEach(item => {
      const card = buildCard(item, weeks, grid);
      if (card) cardsLayer.appendChild(card);
    });
    grid.appendChild(cardsLayer);
    lane.appendChild(grid);
    container.appendChild(lane);
  });
}

function buildCard(item, weeks, grid) {
  const startDate = parseDate(item.start);
  const endDate   = parseDate(item.end);
  const x1 = dateToX(startDate, weeks);
  const x2 = dateToX(endDate, weeks) + (COL_W / 7) * 1; // end of end-day
  const w  = Math.max(x2 - x1, 20);
  if (x1 < 0 || w < 1) return null;

  const ws = wsById(item.workstream);
  const card = document.createElement('div');
  card.className = `card ${item.status}`;
  card.dataset.id = item.id;
  card.style.left  = x1 + 'px';
  card.style.width = w + 'px';
  if (ws) card.style.borderTopColor = ws.color;

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

  document.getElementById('f-title').value   = item?.title   || '';
  document.getElementById('f-phase').value   = item?.phase   || 'P1';
  document.getElementById('f-status').value  = item?.status  || 'to-ticket';
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
  const saved = localStorage.getItem('flex-ds-roadmap');
  if (saved) {
    try { DATA = JSON.parse(saved); render(); return; } catch {}
  }
  // load from bundled data.json
  const resp = await fetch('./data.json');
  DATA = await resp.json();
  render();
}

boot();
