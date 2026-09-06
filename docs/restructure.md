# Phase 1 — Restructure without losing anything

The one-time move from a standalone sudoku to a hub layout. This file is
deleted once Phase 1 is merged.

**Nothing is rewritten in this phase.** No feature is added, no behaviour
changes, no binding is created, no Cloudflare setting is touched. Files move and
import paths follow them. That is the entire scope, and keeping it that narrow
is what makes the 46 tests a real proof rather than a hope.

## Why in place, and not a new repo

The Pit document said everything migrates to a new repo. It should not.

- Git history is the answer to "why is this like this," and this project has
  already needed it once — `HISTORY.md` exists because a difficulty design was
  replaced and the measurements behind the replacement were worth keeping.
- The Cloudflare build connection (setup task S1) is done and working. A new
  repo means doing it again, and re-pointing the custom domain afterwards.
- A restructure inside one repo is a reviewable diff of file moves. A new repo
  is one commit of 1,200 lines with no provenance.
- GitHub renames preserve history, issues, and redirect the old URL.

The repo becomes `carson-gameroom` (Settings → Rename). The old name keeps
working as a redirect, so nothing breaks at the moment of the rename.

**The Worker is a separate question.** Renaming the GitHub repo does not
rename the Cloudflare Worker, and the Worker rename is optional — see
`architecture.md` §8, A4. Nothing in this phase depends on it.

## The pre-pivot tree, reachable by name

**Done.** The branch `v0-standalone-sudoku` points at `a4718f6`, the last commit
of the standalone sudoku. Nothing else is needed before starting Phase 1.

Worth being accurate about what this is for. `a4718f6` is on `main` and Phase 1
adds commits on top rather than rewriting history, so the commit is already
permanently reachable — this ref is a *memorable name* for it, not a rescue from
data loss. The genuine safety net for the file move is the test suite, below.

A branch rather than a tag because tag refs cannot be pushed from this
environment. Functionally identical for keeping a commit findable. To upgrade it
to a real tag, in the GitHub web UI: **Releases → Draft a new release → Choose a
tag → type `v0-standalone-sudoku` → Create new tag on publish → set Target to
the `v0-standalone-sudoku` branch → Publish release.** Then delete the branch.
Cosmetic; the branch does the job as it stands.

## The move

`public/` stays the assets directory — `CLAUDE.md` already says everything
served lives there, and the Worker's asset binding takes exactly one directory,
so scattering client code into per-game folders elsewhere is not available.

```
  public/index.html          →  public/sudoku/index.html
  public/dev.html            →  public/sudoku/dev.html
  public/src/core/*.js       →  public/sudoku/core/*.js
  public/src/store/local.js  →  public/sudoku/store/local.js
  public/src/ui/*.js         →  public/sudoku/ui/*.js
  (new)                      →  public/index.html          hub placeholder
  (new)                      →  public/shared/             empty until Phase 2
  (new)                      →  worker/                    empty until Phase 2
```

Docs moved in Phase 0 and are already where they belong:

```
  sudoku-design.md  →  docs/sudoku/design.md
  specs/            →  docs/sudoku/specs/
```

## What changes inside files

Four kinds of edit, all mechanical.

1. **Test imports.** `test/*.test.js` reaches into `../public/src/core/…`;
   becomes `../public/sudoku/core/…`. Five files.
2. **HTML script tags.** `public/sudoku/index.html` and `dev.html` point at
   `./src/ui/app.js`; becomes `./ui/app.js`. The `src/` level is dropped because
   `public/sudoku/` is now unambiguous about what it holds.
3. **Cross-module imports inside `public/sudoku/`.** Unchanged. Every one of
   them is already relative and every relative distance is preserved by moving
   the tree as a unit — `ui/app.js` importing `../core/grid.js` still resolves.
4. **Doc cross-references.** `README.md` and `docs/sudoku/specs/README.md`
   mention `public/src/`. Prose only.

The `localStorage` key prefix (`sudoku.v1.`) **does not change.** It is already
namespaced by game and already versioned. Changing it would silently discard
every in-progress board on the family's phones for no benefit.

## Order of operations

Each step leaves `main` deployable. Stop at any of them.

1. ~~Mark the pre-pivot tree.~~ Done — the `v0-standalone-sudoku` branch.
2. Rename the repo to `carson-gameroom`.
3. One commit: `git mv` the tree, fix the four kinds of reference above.
   **Verify: 46 tests green, and the site still serves — now at `/sudoku/`.**
4. One commit: a hub placeholder at `public/index.html` that links to
   `/sudoku/`. Deliberately plain; the real shelf is Phase 2 and is designed,
   not improvised here.

Steps 1 and 2 are yours in a browser. Steps 3 and 4 are one session, Small.

## How we know nothing was lost

- **The tests.** 46 of them, covering geometry, generation, tiering, the
  openness floor, and the no-hardcoded-sizes rule. They import the core modules
  directly. If a file were dropped or an import misrouted, they fail loudly.
- **`git mv` produces renames, not delete-plus-add.** The diff should show
  `R100` on every moved file. Any file showing as new content is a file that got
  edited when it should not have been — that is the review check.
- **The deployed site.** After step 3 the sudoku loads at `/sudoku/`, deals,
  accepts input, undoes, and checks. That is a two-minute pass on the phone.
- **`v0-standalone-sudoku`.** If all of the above somehow misleads, the
  pre-pivot tree is one click away.

## What Phase 1 explicitly does not do

Listed because each is a tempting thing to fold in, and each would ruin the
diff's reviewability.

- No `worker/index.js`. No D1. No Durable Object. No `wrangler.jsonc` bindings.
- No Worker rename. It is optional, it is not a rename (it creates a second
  Worker), and if it is done at all it belongs *before* Phase 2 rather than
  inside it — `architecture.md` §8, A4.
- No custom domain.
- No hub design work beyond a placeholder link.
- No pencil marks, and no touching `board.js` at all — the device checks S2, S4
  and S5 are still open against the current board, and changing it before they
  are answered means answering them about code that no longer exists.
