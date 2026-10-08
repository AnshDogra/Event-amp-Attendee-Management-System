const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+ (no install/compile needed)

const PORT = process.env.PORT || 3000;
const TICKET_TYPES = ['General', 'VIP', 'Student'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- Database ---------- */
const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'events.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// One-to-many: one Event -> many Attendees
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    date       TEXT NOT NULL,           -- YYYY-MM-DD
    venue      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendees (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL COLLATE NOCASE,
    ticket_type TEXT NOT NULL CHECK (ticket_type IN ('General','VIP','Student')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE (event_id, email)            -- prevents duplicate registration
  );

  CREATE INDEX IF NOT EXISTS idx_attendees_event ON attendees(event_id);
`);

/* ---------- App ---------- */
const app = express();
app.use(express.json());

// CORS for the API, so the UI also works when opened from file:// or another
// dev server (e.g. VS Code Live Server on :5500) while this server runs on :3000.
app.use('/api', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const isValidDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const fail = (res, status, error, fields) => res.status(status).json({ error, fields });

/* ----- Events ----- */
const EVENT_SELECT = `
  SELECT e.id, e.name, e.date, e.venue, e.created_at,
         COUNT(a.id) AS attendee_count,
         SUM(a.ticket_type = 'VIP') AS vip_count
  FROM events e LEFT JOIN attendees a ON a.event_id = e.id`;

// List events (optional ?q= search on name/venue)
app.get('/api/events', (req, res) => {
  const q = clean(req.query.q || '');
  const rows = db
    .prepare(
      `${EVENT_SELECT}
       WHERE (@q = '' OR e.name LIKE '%' || @q || '%' OR e.venue LIKE '%' || @q || '%')
       GROUP BY e.id ORDER BY e.date ASC, e.id ASC`
    )
    .all({ q });
  res.json(rows.map((r) => ({ ...r, vip_count: r.vip_count || 0 })));
});

// Add a new event
app.post('/api/events', (req, res) => {
  const name = clean(req.body.name);
  const date = clean(req.body.date);
  const venue = clean(req.body.venue);
  const fields = {};
  if (!name) fields.name = 'Event name is required';
  if (!date) fields.date = 'Date is required';
  else if (!isValidDate(date)) fields.date = 'Enter a valid date';
  if (!venue) fields.venue = 'Venue is required';
  if (Object.keys(fields).length) return fail(res, 400, 'Please fix the highlighted fields', fields);

  const info = db
    .prepare('INSERT INTO events (name, date, venue) VALUES (?, ?, ?)')
    .run(name, date, venue);
  const row = db.prepare(`${EVENT_SELECT} WHERE e.id = ? GROUP BY e.id`).get(info.lastInsertRowid);
  res.status(201).json({ ...row, vip_count: row.vip_count || 0 });
});

// Delete an event (its attendees are removed via ON DELETE CASCADE)
app.delete('/api/events/:id', (req, res) => {
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (!info.changes) return fail(res, 404, 'Event not found');
  res.status(204).end();
});

/* ----- Attendees ----- */
// List / search attendees: ?q= (name, email or event name) and ?event_id=
app.get('/api/attendees', (req, res) => {
  const q = clean(req.query.q || '');
  const eventId = req.query.event_id ? Number(req.query.event_id) : null;
  const rows = db
    .prepare(
      `SELECT a.id, a.event_id, a.name, a.email, a.ticket_type, a.created_at,
              e.name AS event_name, e.date AS event_date
       FROM attendees a JOIN events e ON e.id = a.event_id
       WHERE (@q = '' OR a.name LIKE '%' || @q || '%'
                      OR a.email LIKE '%' || @q || '%'
                      OR e.name LIKE '%' || @q || '%')
         AND (@eventId IS NULL OR a.event_id = @eventId)
       ORDER BY a.created_at DESC, a.id DESC`
    )
    .all({ q, eventId });
  res.json(rows);
});

// Register an attendee to an event
app.post('/api/attendees', (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const ticket = clean(req.body.ticket_type);
  const eventId = Number(req.body.event_id);
  const fields = {};

  if (!eventId) fields.event_id = 'Select an event';
  if (!name) fields.name = 'Name is required';
  if (!email) fields.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email address';
  if (!TICKET_TYPES.includes(ticket)) fields.ticket_type = 'Choose a ticket type';
  if (Object.keys(fields).length) return fail(res, 400, 'Please fix the highlighted fields', fields);

  if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId))
    return fail(res, 404, 'Event not found', { event_id: 'Event no longer exists' });

  const dup = db
    .prepare('SELECT 1 FROM attendees WHERE event_id = ? AND email = ?')
    .get(eventId, email);
  if (dup)
    return fail(res, 409, 'This email is already registered for the selected event', {
      email: 'Already registered for this event',
    });

  const info = db
    .prepare('INSERT INTO attendees (event_id, name, email, ticket_type) VALUES (?, ?, ?, ?)')
    .run(eventId, name, email, ticket);
  const row = db
    .prepare(
      `SELECT a.*, e.name AS event_name, e.date AS event_date
       FROM attendees a JOIN events e ON e.id = a.event_id WHERE a.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(row);
});

// Delete an attendee
app.delete('/api/attendees/:id', (req, res) => {
  const info = db.prepare('DELETE FROM attendees WHERE id = ?').run(req.params.id);
  if (!info.changes) return fail(res, 404, 'Attendee not found');
  res.status(204).end();
});

/* ----- Stats ----- */
app.get('/api/stats', (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const s = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM events) AS events,
              (SELECT COUNT(*) FROM events WHERE date >= @today) AS upcoming,
              (SELECT COUNT(*) FROM attendees) AS attendees,
              (SELECT COUNT(*) FROM attendees WHERE ticket_type = 'VIP') AS vip`
    )
    .get({ today });
  res.json(s);
});

app.use('/api', (_req, res) => fail(res, 404, 'Endpoint not found'));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Event Manager running at http://localhost:${PORT}`));
}
module.exports = app;
