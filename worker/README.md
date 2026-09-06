The Worker. Bundled by wrangler on Cloudflare's build machine, never served —
nothing here is under `public/` and nothing under `public/` imports from here.

```
index.js        fetch(): /admin and /api/* handled here, everything else back to assets
admin.js        the database admin page and its seven routes
db/
  plan.js       pure: the statement splitter, checksums, applied/pending/drifted
  backup.js     pure: the export document, its fingerprint, the import plan
  migrations.js the only module that imports .sql; MIGRATIONS and SEEDS, no logic
  apply.js      everything that touches D1
  sql/
    001_schema.sql
    seed_players.sql
```

The routes, and which of them change anything:

| Route | | |
|---|---|---|
| `GET /admin` | reads | the page |
| `GET /admin/export` | reads | the backup, and the cookie the erase confirmation requires |
| `POST /admin/apply` | writes | pending migrations, one `batch()` per file |
| `POST /admin/seed` | writes | every seed file, whole |
| `POST /admin/erase` | reads | the confirmation page |
| `POST /admin/erase/confirm` | **drops** | every table, the ledger included |
| `POST /admin/import` | writes | a backup, `INSERT OR IGNORE` |

There is no login on any of them. Session C's gate has to keep `GET /admin`
exempt — the page renders before a passphrase exists — and decides for itself
what to do about the three that change something.

`plan.js` is split from `migrations.js` because `node --test` cannot import a
`.sql` file — a text import is a bundler feature and there is no bundler in CI.
Everything with a decision in it takes strings as arguments and is tested;
`migrations.js` turns files into strings and holds nothing worth testing.

Tests may still *read* the `.sql` files with `node:fs`; reading is not
importing. Two naming conventions make that work without importing
`migrations.js`: migrations are `NNN_*.sql`, seeds are `seed_*.sql`.
