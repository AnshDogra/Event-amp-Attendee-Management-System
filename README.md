# Gather — Event & Attendee Management System

Full-stack CRUD app: **HTML/CSS/JavaScript** (Fetch API) → **Node.js + Express** REST API → **SQLite** (Node's built-in `node:sqlite` — no native modules to compile).

## Run

```bash
npm install
npm start
# open http://localhost:3000
```

Requires Node.js 22.13 or newer. The database file `events.db` is created automatically on first run.

## Database schema (one-to-many)

```
events (id PK, name, date, venue, created_at)
   │ 1
   │
   ▼ many
attendees (id PK, event_id FK → events.id ON DELETE CASCADE,
           name, email, ticket_type, created_at,
           UNIQUE(event_id, email))
```

Deleting an event automatically deletes its attendees (`ON DELETE CASCADE`).

## REST API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/events?q=` | List events (search by name/venue) with attendee counts |
| POST | `/api/events` | Add a new event `{name, date, venue}` |
| DELETE | `/api/events/:id` | Delete an event (and its attendees) |
| GET | `/api/attendees?q=&event_id=` | List / search attendees by name, email or event |
| POST | `/api/attendees` | Register attendee `{event_id, name, email, ticket_type}` |
| DELETE | `/api/attendees/:id` | Delete an attendee |
| GET | `/api/stats` | Dashboard counters |

## Validation

- Required fields: event name/date/venue; attendee event/name/email/ticket type
- Email format check (client **and** server)
- Ticket type must be `General`, `VIP` or `Student`
- Duplicate registration (same email for the same event, case-insensitive) → `409 Conflict`
- Errors are returned as `{ error, fields }` and shown inline in the form

## UI highlights

Glassmorphism cards, bento stats, animated tab pill, light/dark theme (auto + toggle), modal forms with inline errors, toasts, skeleton loaders, debounced live search, `/` shortcut to focus search, responsive and reduced-motion friendly.
