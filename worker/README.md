The Worker. Bundled by wrangler on Cloudflare's build machine, never served —
nothing here is under `public/` and nothing under `public/` imports from here.

```
index.js        fetch(): /admin and /api/* handled here, everything else back to assets
admin.js        the database admin page and its two posts
db/
  plan.js       pure: the statement splitter, checksums, applied/pending/drifted
  migrations.js the only module that imports .sql; MIGRATIONS and SEEDS, no logic
  apply.js      everything that touches D1
  sql/
    001_schema.sql
    seed_players.sql
```

`plan.js` is split from `migrations.js` because `node --test` cannot import a
`.sql` file — a text import is a bundler feature and there is no bundler in CI.
Everything with a decision in it takes strings as arguments and is tested;
`migrations.js` turns files into strings and holds nothing worth testing.

Tests may still *read* the `.sql` files with `node:fs`; reading is not
importing. Two naming conventions make that work without importing
`migrations.js`: migrations are `NNN_*.sql`, seeds are `seed_*.sql`.
