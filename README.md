# Seat Plan

A single-page office seating chart tool. No build step, no server, no dependencies.

Open `index.html` in a browser, or serve the folder from any static host.

## Files
- `index.html` — the app (standalone page)
- `app.css`, `app.js` — styles and logic
- `artifact.html` — same markup, wrapped for publishing as a Claude Artifact (generated from `index.html`; head/body tags stripped)

## How it works
- **Assign mode** — drag a name from the left rail onto a desk. Drag a seated name onto another desk to swap; drag it back to the rail to unseat. Click a name then click a desk if you prefer clicking (also what works on touch).
- **Layout mode** — add desks, rows of desks, and labelled areas; drag to move (snaps to a 10px grid), corner handle resizes, double-click renames. `R` rotates, `backspace` deletes, arrows nudge (shift = 5x).
- **Group edits** — drag across the floor to rubber-band a group, shift-click to add or drop one desk, `cmd-A` selects everything. Dragging any selected desk moves the whole group, and nudge/rotate/duplicate/delete all apply to the selection. A group move is a single undo step. Desks join a band when it touches them; areas join only when the band encloses them whole, so you can rubber-band a row that sits inside an area. Click an area once to select it, then drag to move it.
- **Copy / cut / paste** — `cmd-C`, `cmd-X`, `cmd-V` on a layout selection. Copies land offset from the original and arrive selected, so you can paste and immediately drag. Desk names that would collide are renumbered, and pasted desks come in empty (nobody is seated twice). The clipboard carries JSON, so a group copies between browser tabs and windows too.
- **Undo/redo** — `cmd-Z` / `shift-cmd-Z`, 60 steps.

## Saving and sharing
- Every change autosaves to this browser's `localStorage`; the top bar shows when it last saved.
- **Save** opens save & restore: name a version, **Save to file (.json)** to keep a copy outside the browser, or **Open a file…** to load one back. `cmd-S` opens it.
- **Versions** (inside Save) keeps up to 40 named snapshots in this browser, each restorable in one click.
- **Share link** packs the entire layout — people, desks, assignments — into the URL hash (gzip + base64url), so a link needs no backend. Typical office-sized plans land well under 2,000 characters; the dialog shows the length and warns past 8,000.
- **Data** copies or pastes the raw JSON, for a file backup or for exchanging a layout when a link is inconvenient.

Share links only work when the page is served from a real URL (a static host, or the local file). Inside a framed embed the app says so and points at Data instead.

## Zoom
Buttons zoom around the middle of the view, `ctrl`/`cmd` + scroll (or trackpad pinch) zooms around the pointer, `cmd +` / `cmd -` / `cmd 0` from the keyboard, and **Fit** frames everything you've laid out. Range is 25%–250%.

## Hosting
Static hosting only — there is no backend, no database, and no build. Ship `index.html`, `app.css` and `app.js` (about 40 KB, ~20 KB gzipped) and you're done.

```bash
HOST=root@your-hetzner-box DEST=/var/www/seating ./deploy.sh
```

Server configs to copy: [`deploy/Caddyfile`](deploy/Caddyfile) (auto-HTTPS, simplest) or [`deploy/nginx.conf`](deploy/nginx.conf).

Two things the host must get right:

1. **Serve it over HTTPS.** The copy-to-clipboard calls behind *Share link* and *Copy data* need a secure context; over plain `http://` on a real domain they silently fail (localhost is exempt). Both configs redirect port 80 and terminate TLS.
2. **Don't cache the three files hard.** They change as a set, so a stale `app.js` against a fresh `index.html` breaks the page. Both configs send `Cache-Control: no-cache`, which still revalidates cheaply.

Share links work fully once hosted: the fragment holding the layout never leaves the browser, so there's no URL-length limit at the server and nothing to store.
