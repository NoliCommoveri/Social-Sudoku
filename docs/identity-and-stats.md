# Identity and the record

Who a player is, how the site knows, and what it remembers about them.
Delivers H3 and H4.

§2, §3 and §3.2 — the gate, profiles, the picker and the two cookies — are
Phase 2, built. §4, the record, is Phase 3.

## 1. This is a family, not a user base

The whole design follows from that. Six people who live together, share
devices, and can shout across the house. There are no strangers to keep out of
each other's accounts, no password resets to run, and no support burden worth
carrying. What there *is*, is a 12-year-old who will notice if their best time
is attributed to their brother.

So: **a gate at the door, and no locks inside.**

## 2. The gate

One shared family passphrase, stored as the Worker secret `FAMILY_PASSPHRASE`
and set in the dashboard rather than seeded — changing it logs every device out.
Typed once per device on a single-field page. On success the Worker sets a
long-lived signed cookie and never asks again on that device.

It exists to keep the open internet out of the leaderboard, not to separate
family members from each other. One word everybody can remember is correct;
anything a 5-year-old cannot type is not.

*Alternative considered:* Cloudflare Access with email one-time PINs. Genuinely
secure, free at this scale, and wrong here — it needs an email address per child
and a code check on every new device.

## 3. Profiles

A profile is a row, created from the hub by anybody who is through the gate, and
renamed and re-faced from there by anybody too. Not an account. No password.
`hub/specs/phase-2-session-d-editing-a-profile.md` is the screen and the two
endpoints.

```sql
players(
  id,             -- stable, never shown, never changes
  screen_name,    -- shown everywhere, changes freely
  avatar,         -- key into the built-in set
  created_at,
  retired_at      -- soft delete; results keep their author
)
```

**`id` is the only thing stats key on.** That is the point of splitting it from
`screen_name`: the 12-year-old can rename themselves weekly and their best times
follow without a single row being rewritten. A design that keyed results on the
name would either freeze the name or orphan the history, and both were
considered and rejected in the original sudoku due-out D1.

`retired_at` rather than a delete, because deleting a player would either
cascade away games the rest of the family played or leave results pointing at
nothing.

**The seed file makes players; it does not name them.**
`worker/db/sql/seed_players.sql` ships six placeholders, and the site renames
them — press **Run seed** once and change them from the picker, which is what
the family does anyway and what an 11-year-old can do without asking. Editing
the seed file is only ever how a player who *does not exist yet* is added,
because every statement in it is `ON CONFLICT DO NOTHING`, and the avatar keys
in it must be names the built-in set actually contains.

### 3.1 Avatars

A fixed built-in set of inline SVG glyphs, chosen from a grid. Not uploads.

- No R2, no upload handling, no file size limits, no image moderation with four
  children on the site.
- They render at any size, in either theme, and never 404.
- A 4-year-old picks a fox because it is a fox. Nothing to read.

**Thirty of them, one screenful, bold silhouettes distinguishable at 32px** —
animals first, then space, food and monsters, in `public/shared/avatars.js`.
Each has one tint of its own and sits on a disc, which is what keeps a glyph
legible at 96px in the picker and at 56px in the family strip. *Would revisit
if:* the kids want to draw their own, which is a better answer than any set I
would pick — it becomes an SVG committed to the repo, still no upload path.

Two players may not hold the same avatar. It is the primary way a pre-reader
identifies a row, so uniqueness matters more than choice. The editor shows all
thirty and disables the ones other live players hold, with their name under
them, so the answer to "why can I not have the dragon" is on the tile. A
retired player releases theirs.

### 3.2 Picking who you are

Through the gate, the hub shows every profile as a big avatar tile. Tap yours.
A second signed cookie remembers that choice on that device, so the
12-year-old's phone opens straight to them.

Switching is always one tap away from the header, and the picker it opens
carries a **Nobody** tile that clears the device. That is the shared tablet's
answer: whoever hands it on taps Nobody, and the next person gets the picker
rather than somebody else's face. No confirmation, no password, in either
direction.

The picker is also where a profile is made and changed — a **New player** tile
in the grid, and a button that opens the editor on the profile this device is
already on. Both live here rather than on the shelf, because this is the screen
whose subject is who you are and the shelf's front page stays the games and the
faces (`design-language.md` §3).

**On sibling impersonation:** it is possible, deliberately. The deterrent is
that every play is logged with a timestamp and the family can see it, which is
the same deterrent that works at a physical board game. A PIN per child buys
very little and costs a support job the first time one of them forgets it.

### 3.3 Two cookies

| Cookie | Holds | Lifetime | Cleared by |
|---|---|---|---|
| `gate` | proof the passphrase was entered | 1 year | changing either secret |
| `who` | the player id last picked here | 1 year | tapping another profile, or Nobody |

Both are HMAC-signed with `SESSION_SECRET` and verified on every `/api/*` call.
Signing is the difference between "the client says it is player 3" and "the
server issued this". Roughly forty lines in `worker/auth.js`, and it is what
stops a stray script writing results as somebody else.

Neither is encrypted, because neither is secret — a player id is on the screen.
The expiry is inside the signature rather than left to the cookie's `Max-Age`,
which is the one number a browser will happily change.

The `gate` cookie also carries a short fingerprint of the passphrase that
issued it, so **changing `FAMILY_PASSPHRASE` asks everybody again** and
rotating `SESSION_SECRET` invalidates both cookies everywhere. That is the whole
of the "log everyone out" story, and it keeps no state anywhere.

## 4. The record

Schema in [`architecture.md`](architecture.md) §3.1. What it is *for*:

- **What we play.** `plays` grouped by date — the family's game log. This is the
  thing that makes the site feel like a place rather than a launcher.
- **Per-game stats.** Filter `plays.game`. Sudoku shows best times by size and
  tier; Pit shows points and corners.
- **Overall stats.** Aggregate across games. Wins, plays, a streak.
- **Head-to-head.** Two `play_results` rows sharing a `play_id`.

### 4.1 Rules the write path follows

- **The rules module never writes.** The room writes on completion, or the
  client posts to `/api/plays` — which is what a game running on one device
  does, Pit against bots as much as solo sudoku. A game that can write its own
  score is a game a 12-year-old can write any score into.
- **A row opens at the start and closes at the end.** `POST /api/plays` when the
  game begins, `POST /api/plays/:id/end` when it stops, so a phone that gets
  locked mid-game leaves a play with no ending rather than nothing at all. The
  Worker chooses the id and both timestamps, and `play_results.player_id` comes
  from the `who` cookie and never from the body — §3.3 is what that signature is
  for.
- **Solo sudoku posts once, on completion.** It is a static page with no socket;
  one `POST` is the entire server involvement. Server-side validation of a solo
  time is not worth building — see `architecture.md` §7 for where that judgement
  does get made properly, in race mode.
- **A play with no result is still a play.** Abandoned games get an `ended_at`
  and no `play_results` rows. "We started six and finished two" is true and
  worth being able to see.

### 4.2 What is not stored

No move-by-move history. No replays. The record answers *what happened*, not
*how*. Adding replays later means a new table, not a change to this one.

### 4.3 Where the record is shown

**The hub's front page shows the play log and one small overall tile. Detailed
stats live inside each game.**

A leaderboard is the first thing a 12-year-old optimises and the first thing a
5-year-old loses at. Making the log the hero and the ranking secondary is a
deliberate choice about what this site is for: the front page answers *what did
we play*, and it never puts the six of you in order. The tile carries the
family's total, a streak, and — when the device has somebody picked — that one
player's own counts. Nobody else's.

*Alternative:* cross-game standings on the front page. *Would revisit if:* the
kids ask for it, which would be them telling us what the site is for, and it is
a screen rather than a schema change either way.

Per-game detail — sudoku's best times by size and tier, Pit's points and
corners — is a screen inside that game, because what `config_json` and
`detail_json` mean is per-game knowledge. The Worker holds none of it and hands
both back unread (`hub/specs/phase-3-session-a-the-read-api-and-the-log.md` §3.1),
which is what keeps a third game to one file (H2).

## 5. Open

- **I2 — Do the 4- and 5-year-olds get their own profiles from day one?** *Rec:
  yes.* They will play Pit's little-kid mode in Phase 9 and sudoku 4×4 before
  that, and a profile they own is most of why they will want to.
