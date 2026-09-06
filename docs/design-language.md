# Design language

H5 — the kids want to open it — stated concretely enough to build against and
to fail against. A starting position, not a finished system; it firms up as
Phase 2 renders the first real screens.

## 1. The actual problem

The audience is 4, 5, 11 and 12. That span is the hard part, and the wrong
resolutions are obvious enough to name:

- **A kid mode and a big-kid mode.** Doubles the surface, and the 11-year-old
  will still see the babyish one exists.
- **Design for the youngest.** The 12-year-old stops opening it. A 12-year-old
  will not use something that looks like it is for a 5-year-old; a 5-year-old
  will happily use something that looks like it is for a 12-year-old, provided
  they can operate it.

**So: one shell, pitched at the 12-year-old's taste and the 5-year-old's
motor skills and reading ability.** Bold and characterful, not cute. Arcade
cabinet, not nursery.

The one place this splits is *inside* a game, where Pit's little-kid mode (Phase
9) is a genuinely separate mode with different rules. That is a game design
decision, not a shell decision.

## 2. Rules that follow

**Nothing essential is text-only.** Every action carries an icon or an avatar;
text labels it rather than being it. A pre-reader navigates by shape, colour and
position, and position means the shelf does not reorder itself.

**Touch targets 64px minimum on the hub**, with 8px of dead space between. Bigger
than the 44px accessibility floor because the 4-year-old is the constraint, and
because a mis-tap that starts the wrong game is a real cost.

The sudoku board is exempt and always will be — 81 cells at 360px cannot obey
this. That is why S2 exists as a device check rather than a rule.

**The phone in portrait at 360px is the binding constraint.** Everything is laid
out for it first. The Chromebook gets the same layout with more air, not a
different one.

**Avatars are the identity channel everywhere.** Leaderboard rows, room seats,
the play log, the header. A name is a caption on an avatar, never a substitute
for one. This is what lets the 5-year-old find themselves on a stats page they
cannot read.

**Feedback is immediate and physical.** Every tap does something visible within
100ms. Nothing is silently accepted.

**Motion is short and purposeful.** Entering a game, winning, setting a personal
best. 200–400ms. It respects `prefers-reduced-motion`, and nothing is behind an
animation you have to wait out.

**Sound is off by default**, with a per-device toggle. The normal state of a
family phone is muted, and a site that makes noise unexpectedly gets closed.

## 3. The shelf

The hub's front page, and the thing seen most.

- Games as large tiles with their own art. A tile is legible as *which game*
  from across a room.
- The family strip: everybody's avatar, tappable to switch who you are.
- The recent play log — "Tuesday: sudoku, Pit, Pit" with faces. The site's
  memory, made the hero rather than a leaderboard. See `identity-and-stats.md`
  §5, I1.
- Nothing else. No settings gear on the front page, no news, no announcements.

## 4. Tokens

Defined once in `public/shared/theme.css` and used by every game. A game may add
its own colours; it may not redefine the shell's.

- **Palette.** Dark ground by default — it reads as a game and is kinder on a
  phone at night. One saturated accent per game, used for that game's tile and
  its in-game highlights, which is what makes "which game am I in" answerable at
  a glance.
- **Type.** One family, a system stack. Large sizes; the smallest text anywhere
  in the shell is 16px.
- **Radius and depth.** Generous radii, real elevation on interactive things.
  Flat design reads as a document; this should read as objects to press.
- **Both themes.** Light and dark, driven by `prefers-color-scheme`, since the
  Chromebook and the phones will not agree.

Chrome only, current — ES modules, CSS grid, container queries, `:has()`, CSS
nesting, all without fallbacks. The players are on Android phones and a
Chromebook, and that was already the rule.

## 5. How this gets checked

The same way the sudoku layout does: on the actual devices, by the actual
players. A design criterion nobody owns is a criterion that gets assumed.

Each phase that renders something new adds its device check to
`docs/sudoku/specs/questions.md` alongside S2, S4 and S5. Phase 2's, in advance:

- **Can the 5-year-old get from the front page into a game, alone, first try?**
  Watch, do not coach. Where they hesitate is the finding.
- **Does the 12-year-old open it a second time without being asked?** The only
  honest measure of H5, and it takes a week to read.
