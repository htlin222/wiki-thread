# wiki-thread — developer guide

Turn an Obsidian vault into a Threads-style scroll feed. **Zero runtime dependencies, no build step.**
Two source files do almost everything: `server.js` (Node backend) and `public/index.html` (the whole frontend, inline CSS+JS).

## Run / test

```bash
node server.js [vaultDir] [port]   # defaults: ./vault  4173  → http://localhost:4173
pnpm test                          # Playwright smoke suite (16 tests)
```

- `pnpm` for installs; only dev dep is `@playwright/test`. The server itself imports **nothing** but Node built-ins (`http`, `fs`, `path`). Keep it that way unless there's a strong reason.
- In the Claude Code sandbox, background `node server.js` processes get **reaped between turns** — don't rely on a long-lived server here. For a persistent server, the user runs it in their own terminal. For verification, start it within a single turn (curl) or let Playwright's `webServer` manage it.

## Architecture

```
Obsidian vault (.md)  ──read/write──►  server.js (in-memory index)  ──HTTP/JSON──►  public/index.html
```

- **server.js** scans the vault, parses frontmatter + body, builds `INDEX` (id → record) and an inverted index for search. `fs.watch` re-indexes on change; every write endpoint also calls `buildIndex()`. `index.html` is read from disk **per request** (no caching) — so frontend edits need no server restart; only `server.js` edits do.
- **public/index.html** is vanilla JS. No framework, no bundler. Visual target is **Threads** (dim `#101010`, `#777` muted, `#5cc0ff` links, outline action icons, Lucide nav icons). Match existing style when adding UI.

## Data model

| Vault thing | Feed thing |
|---|---|
| each `.md` (id = vault-relative path w/o `.md`) | a post |
| `[text](other.md)` / `[[other]]` in a note | a **reply** threaded under it (`record.links`) |
| `![alt](pic.png)` | inline image, served from `/vault/<path>` |
| `@slug` | mention; resolved to a note id when basename matches |
| frontmatter `author`, `time`, `title`, `tags` | name, timestamp, title, hashtags |
| inline `#tag` | hashtag |

**Tag conventions (state lives in the `.md` frontmatter `tags:`):** `liked`, `saved`, `reposted` are interaction flags, stripped from displayed hashtags. View counts live in `vault/.wiki-thread/state.json` (sidecar, gitignored) — keep notes clean.

## HTTP API (all in `server.js`)

`GET /api/meta` · `GET /api/feed?tab=foryou|following` · `GET /api/note/:id` · `GET /api/search?q=` ·
`POST /api/like|save|repost|reply|post|view` · `GET /vault/<path>` (images) · SPA fallback serves `index.html` for any non-`/api` GET (so deep links work).

- **For you** = `rankForYou()`: cosine TF-IDF to the centroid of `liked` notes + tag-overlap + link-adjacency bonuses; cold start = recency.
- **Following** = reverse-chronological.
- **Search** = `search()`: inverted-index candidate retrieval (exact+prefix tokens) → field-weighted scoring (title>id/author>tags>body) → snippet + `#tag` filters. Multi-term is AND with partial-match fallback.

## Frontend routing (Threads-style URLs)

- `/` → home feed. `/@handle/post/<id>` → thread. `/@handle/post/<id>/media[/<n>]` → image lightbox.
- `route()` parses `location.pathname`; `navTo(url)` = pushState + route; `popstate` re-routes. `renderThread` `replaceState`s the canonical handle. Back/forward and refresh all work via the SPA fallback.
- `curThread` caches the open thread so re-opening the lightbox doesn't re-fetch.

## Extending — common recipes

- **New post action** (like the bookmark): add `flag` to `toPost` + a `POST /api/<x>` using `toggleTag(id, 'flag', on)`; add the button in `postEl`'s `acts`, a handler in `wire()`, and a `syncCards` toggle. Mirror the `save` implementation.
- **New sidebar view**: add to the `NAV` array, handle it in `nav()`, render via `showList(title, filterFn)`.
- **New ⋯ menu item**: add to the `items` array in `openMenu()`.
- Always add/extend a Playwright test in `tests/smoke.spec.js`. Tests run against a throwaway `.test-vault` copy (port 4188) so the real vault is never mutated; make tests **deterministic** (target a specific note, don't rely on feed order — "For you" reorders as likes change, and the suite shares one vault across tests).

## Gotchas

- Don't break the **zero-dep** server or add a frontend build step without discussing.
- `id` may contain `/` (e.g. `replies/…`, `posts/…`); URLs `encodeURIComponent` it.
- `renderText` escapes HTML first, then linkifies — order matters (images before links before mentions).
- Use `rip`, not `rm` (user env). Sample vault under `vault/` is the demo; `vault/replies/` and `vault/posts/` hold runtime-created notes.
