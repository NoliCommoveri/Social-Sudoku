# Slice specs

Implementation specs for the slice order in `../design.md` §6. One file per
slice. A slice is spec'd only when it is next or nearly next; unspec'd slices
live only as the one-line entry in §6.

| Slice | Spec | Cost | State |
|---|---|---|---|
| 1 | [`slice-01-grid-generator-solo.md`](slice-01-grid-generator-solo.md) | Medium | Built — criteria 1, 4, 7, 8 green; 2, 3, 5, 6 wait on S1 then S2 |
| 2 | [`slice-02-three-grid-sizes.md`](slice-02-three-grid-sizes.md) | Small | Built — criteria 1, 3, 4 green, and criterion 2's arithmetic; its by-eye half is S4 |
| 3 | [`slice-03-difficulty-tiers.md`](slice-03-difficulty-tiers.md) | Medium | Built — criteria 1, 2, 3 green; criterion 4 is S5 |
| 4 | Pencil marks | Small | Not spec'd |
| 5 | [`slice-05-solver.md`](slice-05-solver.md) | Small–Medium | Spec'd, not started |
| 6 | [`slice-06-technique-library-hints.md`](slice-06-technique-library-hints.md) | Medium | Spec'd, not started |
| 7 | [`slice-07-storage-foundation.md`](slice-07-storage-foundation.md) | Medium | **Superseded** — rewritten for D1 as hub Phase 2 |
| 8 | Erase, JSON export, re-import | — | Absorbed into hub Phase 2 |
| 9 | Timer + stats + best times | — | Became hub Phase 3 |
| 10 | WebSocket sync + race mode | — | Became hub Phase 8 |
| 11 | PWA | — | Became hub Phase 10 |

**Slices 4, 5 and 6 are unaffected by the hub pivot** and are current as
written — all three are pure client work with no server in them, and they are
hub Phase 4. Slices 7 onward were written against a per-family Durable Object
that no longer owns the data; `../../../ROADMAP.md` has what replaced each, and
`slice-07`'s migrations-and-admin machinery carries over almost whole into
Phase 2 even though its architecture does not.

No slice is estimated above Medium. `CLAUDE.md` caps a session at ~120k tokens
and says a Large slice should be split rather than started; a spec that comes out
Large is a spec that has not been cut yet. Three pairs in this table are halves
of slices that were: 3 and 4, 5 and 6, and 7 and 8. The reason for each cut is in
the first section of the earlier file of the pair.

Everything `CLAUDE.md` says about migrations, seeds, the admin page, drift,
erase, and JSON export now belongs to hub Phase 2. Nothing sudoku has built so
far stores anything a player would miss (`questions.md` Q7), which is why that
phase arrives with no data migration to perform.

All open items live in [`questions.md`](questions.md): `S`* (a setup task only
you can do, in a browser), `D`* (a due out — needs information I do not have),
and `Q`* (an open question where I have a recommendation and will build it
unless you say otherwise). Slice files reference those IDs rather than restating
them. `D1` has moved: the family code is gone with the per-family Durable
Object, and the passphrase and screen names are the hub's, tracked in
`../../identity-and-stats.md` §5.

**Anything a slice cannot verify on its own is an `S`* item, not a line in that
slice's acceptance criteria.** Timing on the phone, a touch layout, a
keyboard-only run, a deployed URL — none of those can be closed by CI or by me,
and a criterion nobody owns is a criterion that gets assumed. S1 connected the
repo to Cloudflare and is done; S2 is slice 1's four device checks; S4 is slice
2's two; S5 is slice 3's, and it is the one that decides whether the easy tier
is easy enough. **S2, S4 and S5 are all still open**; they are about the board,
which nothing since has touched. **S6 is the hub's first**, and the only one in
the file that is not about sudoku: Phase 2's database and admin page can be
checked nowhere but a deployment. Slice 6's library legibility on the phone
needs the same treatment when it starts, and the hub's own checks are in
`../../design-language.md` §5.

## Conventions these specs assume

Every spec below is written against these. They follow from `CLAUDE.md`, not
from taste, so changing one is a project-level decision, not a slice-level one.

- **No build step.** Source is plain ES modules loaded directly by the browser.
  No bundler, no transpile, no TypeScript, no npm dependency at runtime. This is
  a consequence of "no CLI": anything requiring `npm run build` before the site
  works cannot be driven from the GitHub web editor. It is a rule about
  `public/`. The Worker script under `worker/` is bundled by `wrangler` on
  Cloudflare's build machine, is never served, and does not relax this for a
  single client file — `../../architecture.md` §2.1 draws the line.
- **No runtime dependencies.** Zero. Everything in `public/sudoku/` is written
  here.
- **Pure core.** `public/sudoku/core/` never touches the DOM, `window`, or
  storage. It is importable by both the browser and the CI test runner, which
  is what lets the same tests cover both.
- **Size-parameterized from line one.** No module outside `sizes.js` may contain
  a literal `4`, `6`, `9`, `16`, `36`, or `81`. Enforced by a test that greps the
  core sources. `3` is banned too, but with a short exemption list for the
  structural constants that genuinely equal three and are not dimensions —
  `UNIT_KINDS` is its one entry. The list lives in the test and grows only by a
  deliberate edit. `2` is not banned; it is unusable as a signal.
  `slice-01-grid-generator-solo.md` §6 has the rule in full.
- **Everything served lives under `public/`.** That directory is the Worker's
  assets directory; the repo's docs and tests are not published. Sudoku's share
  of it is `public/sudoku/`.
- **Chrome only, current.** The players are on Android phones and a Chromebook.
  ES modules, CSS grid, container queries, `:has()`, and CSS nesting are used
  without fallbacks. The 360px-wide phone in portrait is the binding layout
  constraint.
