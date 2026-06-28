# wiki-thread — doomscroll your Obsidian vault like Threads

Turn a folder of `.md` notes into a Threads-style feed you can scroll to study.
Zero dependencies — just Node.

## Run

```bash
node server.js [vaultDir] [port]   # defaults: ./vault  4173
```

Open <http://localhost:4173>.

## How notes map to the feed

| Vault thing | Feed thing |
|---|---|
| each `.md` file | a post |
| `[text](other.md)` / `[[other]]` inside a note | a **reply** threaded under it |
| `![alt](pic.png)` | an inline image (served from the vault) |
| `@slug` | a mention link to that note |
| frontmatter `author`, `time`, `tags` | name, timestamp, hashtags |
| inline `#tag` | hashtag |

## Navigation (Threads sidebar)

- **Home** — the For you / Following feed
- **New thread** — write a brand-new top-level note (`posts/…md`)
- **Search** — filter and jump to any note
- **Activity** — notes you've liked
- **Saved** — notes you've reposted
- **Profile** — notes by your main author

On narrow screens the sidebar collapses to a bottom icon bar.

## Interactions (write back into the vault)

- **♥ Like** → adds `liked` to the note's frontmatter `tags`. Drives **For you** (TF-IDF + shared tags + link adjacency to everything you've liked).
- **🔁 Repost** → tags `reposted` and logs a link in `reposts.md`.
- **💬 Reply** → creates a note in `replies/` (with `author`+`time`) and appends a `[link]` into the parent so it threads.
- **New thread** → creates a note in `posts/`.
- **@-autocomplete** in the composer searches the vault.
- **Views** are counted in `vault/.wiki-thread/state.json` (notes stay clean).
- Editing a note in Obsidian live-reindexes the open feed.

Share / bookmark / DM are intentionally omitted.

## Point it at your real vault

```bash
node server.js ~/Obsidian/MyVault
```

The `.wiki-thread/` sidecar is the only thing it adds; likes/replies/reposts/posts are plain Markdown edits.
