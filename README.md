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

Static hosting only — no backend, no database, no build step. The whole app is `index.html`, `app.css` and `app.js` (~40 KB, ~20 KB gzipped).

**Live at <https://cydeswype.github.io/seating-chart/>**, served by GitHub Pages from `main`. To deploy, push:

```bash
./tools/bump.sh && git commit -am "…" && git push
```

`tools/bump.sh` stamps the asset links in `index.html` with the current time and regenerates `artifact.html`. Pages caches files for ten minutes, so without the stamp a browser can pair a fresh `index.html` with a stale `app.js`. Run it whenever `app.js` or `app.css` changes.

### Self-hosting instead

Pages is public to anyone with the URL. If the plan should sit behind the VPN or a password, host it yourself — [`deploy.sh`](deploy.sh) rsyncs the files over SSH, with [`deploy/Caddyfile`](deploy/Caddyfile) (auto-HTTPS) or [`deploy/nginx.conf`](deploy/nginx.conf) to serve them:

```bash
HOST=root@your-box DEST=/var/www/seating ./deploy.sh
```

Wherever it lands, serve it over **HTTPS** — the copy-to-clipboard behind *Share link* and *Copy data* needs a secure context and fails silently on plain `http://` (localhost is exempt). Share links work the same on any host: the fragment holding the layout never reaches the server, so there's no URL length limit and nothing to store.
