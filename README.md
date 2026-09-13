# splitpot-web

The Splitpot host app on the web — the same ledger as the Android app, on the same data.

Deployed by **Cloudflare Pages** to <https://splitpot.pages.dev/>.

## Deploy settings

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `/` (repo root) |

There is no build step. This is a static site of hand-written ES modules; `git push` is the
deploy. The one vendored dependency (`vendor/supabase.js`) is committed on purpose — no npm,
no lockfile, no CDN at runtime.

Separate from `dvpvalo/splitpot-ledger` so a bad deploy here can never break the player-facing
ledger links already sent to people.
