# splitpot-web

The Splitpot host app on the web — the same ledger as the Android app, on the same data.

Deployed by **Cloudflare Pages** to <https://splitpot.pages.dev>.

## Deploy settings

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(empty)* |
| **Build output directory** | **`public`** |

`public/` is the entire asset root, and that is deliberate: the first deploy of this repo (as a
Worker, 13 Sep 2026) used the repo root and served `.git` to the public internet. An asset root
is a whitelist, never a tree. Everything outside `public/` — `test/`, `package.json`, `.git` —
is never served.

There is no build step. Hand-written ES modules; `git push` is the deploy. The one vendored
dependency (`public/vendor/supabase.js`) is committed on purpose — no npm, no lockfile, no CDN
at runtime.

Separate from `dvpvalo/splitpot-ledger` so a bad deploy here can never break the player-facing
ledger links already sent to people.
