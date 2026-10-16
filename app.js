/* ============ Helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// API base URL: '' when this page is served by the Express server itself,
// otherwise (file://, Live Server, etc.) we fall back to http://localhost:3000.
let API_BASE = '';
const FALLBACK_BASE = 'http://localhost:3000';

async function detectApiBase() {
  const candidates = location.protocol === 'file:' ? [FALLBACK_BASE] : ['', FALLBACK_BASE];
  for (const base of candidates) {
    try {
      const r = await fetch(base + '/api/stats');
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) { API_BASE = base; return true; }
    } catch (_) { /* try next */ }
  }
  return false;
}

async function api(url, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_) {
    throw new Error('Cannot reach the server. Is it running? (npm start)');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong');
    err.fields = data && data.fields;
    err.status = res.status;
    throw err;
  }
  return data;
}

const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 3200);
}

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const initials = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatarBg = (s) => `linear-gradient(135deg, hsl(${hue(s)} 75% 58%), hsl(${(hue(s) + 40) % 360} 75% 52%))`;

/* ============ State ============ */
const state = { view: 'events', events: [], attendees: [], eventQ: '', attQ: '', attEvent: '' };

/* ============ Theme ============ */
(function initTheme() {
  const saved = localStorage.getItem('theme');
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
})();

/* ============ Tabs ============ */
function movePill() {
  const active = $('.tab.active');
  const pill = $('.tab-pill');
  pill.style.width = active.offsetWidth + 'px';
  pill.style.transform = `translateX(${active.offsetLeft - 4}px)`;
}
function setView(view) {
  state.view = view;
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $('#view-events').hidden = view !== 'events';
  $('#view-attendees').hidden = view !== 'attendees';
  movePill();
  if (view === 'attendees') loadAttendees();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
addEventListener('resize', movePill);

/* ============ Rendering ============ */
async function loadStats() {
  const s = await api('/api/stats');
  $('#stEvents').textContent = s.events;
  $('#stUpcoming').textContent = s.upcoming;
  $('#stAttendees').textContent = s.attendees;
  $('#stVip').textContent = s.vip;
}

async function loadEvents() {
  const grid = $('#eventGrid');
  if (!state.events.length) grid.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  state.events = await api('/api/events?q=' + encodeURIComponent(state.eventQ));
  renderEvents();
  fillEventSelects();
}

function renderEvents() {
  const grid = $('#eventGrid');
  const today = todayISO();
  if (!state.events.length) {
    grid.innerHTML = `<div class="empty"><div class="art">🗓️</div>
      <h3>${state.eventQ ? 'No events match your search' : 'No events yet'}</h3>
      <p>${state.eventQ ? 'Try a different keyword.' : 'Create your first event to start registering attendees.'}</p></div>`;
    return;
  }
  const max = Math.max(10, ...state.events.map((e) => e.attendee_count));
  grid.innerHTML = state.events.map((e, i) => {
    const d = new Date(e.date + 'T00:00:00');
    const upcoming = e.date >= today;
    const pct = Math.round((e.attendee_count / max) * 100);
    return `<article class="event-card" style="animation-delay:${i * 50}ms">
      <div class="ec-top">
        <div class="date-badge"><span class="m">${d.toLocaleString(undefined, { month: 'short' })}</span><span class="d">${d.getDate()}</span></div>
        <div class="ec-title">
          <h3>${esc(e.name)}</h3>
          <div class="ec-meta">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
            <span>${esc(e.venue)}</span>
          </div>
        </div>
        <span class="chip ${upcoming ? 'up' : 'past'}">${upcoming ? 'Upcoming' : 'Past'}</span>
      </div>
      <div>
        <div class="ec-stats"><span><b>${e.attendee_count}</b> attendee${e.attendee_count === 1 ? '' : 's'}${e.vip_count ? ` · ${e.vip_count} VIP` : ''}</span><span>${fmtDate(e.date)}</span></div>
        <div class="bar" style="margin-top:10px"><span style="width:${pct}%"></span></div>
      </div>
      <div class="ec-actions">
        <button class="btn primary small" data-act="register" data-id="${e.id}">Register</button>
        <button class="btn ghost small" data-act="view" data-id="${e.id}">View guests</button>
        <button class="icon-btn del" data-act="del-event" data-id="${e.id}" aria-label="Delete event">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    </article>`;
  }).join('');
}

function fillEventSelects() {
  const opts = state.events.map((e) => `<option value="${e.id}">${esc(e.name)} — ${fmtDate(e.date)}</option>`).join('');
  const filter = $('#attEventFilter');
  const prevFilter = state.attEvent;
  filter.innerHTML = '<option value="">All events</option>' + opts;
  filter.value = state.events.some((e) => String(e.id) === String(prevFilter)) ? prevFilter : '';
  state.attEvent = filter.value;
  $('#regEvent').innerHTML = '<option value="">Select an event…</option>' + opts;
}

async function loadAttendees() {
  const params = new URLSearchParams();
  if (state.attQ) params.set('q', state.attQ);
  if (state.attEvent) params.set('event_id', state.attEvent);
  state.attendees = await api('/api/attendees?' + params);
  renderAttendees();
}

function renderAttendees() {
  const body = $('#attBody');
  const empty = $('#attEmpty');
  if (!state.attendees.length) {
    body.innerHTML = '';
    empty.hidden = false;
    const filtered = state.attQ || state.attEvent;
    empty.innerHTML = `<div class="art">👥</div><h3>${filtered ? 'No attendees found' : 'No attendees yet'}</h3>
      <p>${filtered ? 'Adjust your search or filter.' : 'Register someone to an event to see them here.'}</p>`;
    return;
  }
  empty.hidden = true;
  body.innerHTML = state.attendees.map((a, i) => `<tr style="animation-delay:${Math.min(i, 12) * 25}ms">
    <td><div class="person"><div class="avatar" style="background:${avatarBg(a.email)}">${esc(initials(a.name))}</div>
      <div><b>${esc(a.name)}</b><span>${esc(a.email)}</span></div></div></td>
    <td>${esc(a.event_name)}<br><span class="muted" style="font-size:.8rem">${fmtDate(a.event_date)}</span></td>
    <td><span class="pill ${esc(a.ticket_type)}">${esc(a.ticket_type)}</span></td>
    <td class="muted">${new Date(a.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
    <td class="right"><button class="icon-btn del" data-act="del-att" data-id="${a.id}" data-name="${esc(a.name)}" aria-label="Remove attendee">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></button></td>
  </tr>`).join('');
}

const refreshAll = () => Promise.all([loadStats(), loadEvents(), state.view === 'attendees' ? loadAttendees() : null]);

/* ============ Confirm dialog ============ */
function confirmDialog(title, text, okLabel = 'Delete') {
  const dlg = $('#confirmDialog');
  $('#cfTitle').textContent = title;
  $('#cfText').textContent = text;
  dlg.querySelector('[value=ok]').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal();
  });
}

/* ============ Forms ============ */
function clearErrors(form) {
  $$('.err', form).forEach((e) => (e.textContent = ''));
  $$('.field', form).forEach((f) => f.classList.remove('invalid'));
}
function showErrors(form, fields = {}) {
  clearErrors(form);
  Object.entries(fields).forEach(([k, msg]) => {
    const el = $(`.err[data-for="${k}"]`, form);
    if (el) { el.textContent = msg; el.closest('.field').classList.add('invalid'); }
  });
  const first = $('.field.invalid input, .field.invalid select', form);
  if (first) first.focus();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function openDialog(dlg) { dlg.showModal(); }
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog.dialog').forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d && d.id !== 'confirmDialog') d.close(); // click on backdrop
  })
);

// Create event
$('#openEvent').addEventListener('click', () => {
  const f = $('#eventForm');
  f.reset(); clearErrors(f);
  f.date.min = '';
  f.date.value = todayISO();
  openDialog($('#eventDialog'));
  setTimeout(() => f.name.focus(), 50);
});
$('#eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = Object.fromEntries(new FormData(f));
  const fields = {};
  if (!data.name.trim()) fields.name = 'Event name is required';
  if (!data.date) fields.date = 'Date is required';
  if (!data.venue.trim()) fields.venue = 'Venue is required';
  if (Object.keys(fields).length) return showErrors(f, fields);

  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    await api('/api/events', { method: 'POST', body: data });
    $('#eventDialog').close();
    toast('Event created');
    setView('events');
    await refreshAll();
  } catch (err) {
    showErrors(f, err.fields);
    toast(err.message, 'error');
  } finally { btn.disabled = false; }
});

// Register attendee
function openRegister(eventId = '') {
  const f = $('#regForm');
  f.reset(); clearErrors(f);
  if (!state.events.length) { toast('Create an event first', 'error'); return; }
  f.event_id.value = eventId || '';
  openDialog($('#regDialog'));
  setTimeout(() => (eventId ? f.name : f.event_id).focus(), 50);
}
$('#openRegister').addEventListener('click', () => openRegister());
$('#regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = Object.fromEntries(new FormData(f));
  const fields = {};
  if (!data.event_id) fields.event_id = 'Select an event';
  if (!data.name.trim()) fields.name = 'Name is required';
  if (!data.email.trim()) fields.email = 'Email is required';
  else if (!EMAIL_RE.test(data.email.trim())) fields.email = 'Enter a valid email address';
  if (Object.keys(fields).length) return showErrors(f, fields);

  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    await api('/api/attendees', { method: 'POST', body: data });
    $('#regDialog').close();
    toast(`${data.name.trim()} registered`);
    await refreshAll();
  } catch (err) {
    showErrors(f, err.fields);
    toast(err.message, 'error');
  } finally { btn.disabled = false; }
});

/* ============ Actions (event delegation) ============ */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  if (act === 'register') return openRegister(id);

  if (act === 'view') {
    state.attEvent = id;
    state.attQ = '';
    $('#attSearch').value = '';
    $('#attEventFilter').value = id;
    return setView('attendees');
  }

  if (act === 'del-event') {
    const ev = state.events.find((x) => String(x.id) === id);
    const ok = await confirmDialog('Delete event?',
      `“${ev.name}” and its ${ev.attendee_count} registered attendee(s) will be permanently removed.`);
    if (!ok) return;
    try { await api('/api/events/' + id, { method: 'DELETE' }); toast('Event deleted'); await refreshAll(); }
    catch (err) { toast(err.message, 'error'); }
  }

  if (act === 'del-att') {
    const ok = await confirmDialog('Remove attendee?', `${btn.dataset.name} will be removed from this event.`, 'Remove');
    if (!ok) return;
    try { await api('/api/attendees/' + id, { method: 'DELETE' }); toast('Attendee removed'); await refreshAll(); }
    catch (err) { toast(err.message, 'error'); }
  }
});

/* ============ Search & filter ============ */
$('#eventSearch').addEventListener('input', debounce((e) => { state.eventQ = e.target.value.trim(); loadEvents(); }));
$('#attSearch').addEventListener('input', debounce((e) => { state.attQ = e.target.value.trim(); loadAttendees(); }));
$('#attEventFilter').addEventListener('change', (e) => { state.attEvent = e.target.value; loadAttendees(); });

// "/" focuses the search box of the current view
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    (state.view === 'events' ? $('#eventSearch') : $('#attSearch')).focus();
  }
});

/* ============ Init ============ */
(async function init() {
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  movePill();
  const ok = await detectApiBase();
  if (!ok) {
    $('#eventGrid').innerHTML = `<div class="empty"><div class="art">🔌</div>
      <h3>Can’t reach the server</h3>
      <p>Start the backend, then reload this page:<br><code>npm install</code> then <code>npm start</code><br>
      and open <b>http://localhost:3000</b></p></div>`;
    toast('Cannot reach the server', 'error');
  } else {
    try { await refreshAll(); } catch (err) { toast(err.message, 'error'); }
  }
  document.fonts && document.fonts.ready.then(movePill);
})();
