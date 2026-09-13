# splitpot-web

The Splitpot host app on the web — the same ledger as the Android app, on the same data.

Deployed by **Cloudflare Workers** (static assets) to <https://splitpot.dvpvalo.workers.dev>.

## Layout

| Path | What |
|---|---|
| `public/` | **The site. The only thing deployed.** |
| `test/` | `node --test` over the pure logic. Never served. |
| `wrangler.jsonc` | Deploy config. `assets.directory` is `./public` on purpose — see the comment in it. |

There is no build step. Hand-written ES modules; `git push` is the deploy. The one vendored
dependency (`public/vendor/supabase.js`) is committed on purpose — no npm, no lockfile, no CDN
at runtime.

Separate from `dvpvalo/splitpot-ledger` so a bad deploy here can never break the player-facing
ledger links already sent to people.
