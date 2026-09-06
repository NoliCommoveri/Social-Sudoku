# Phase 2 Session C — Gate, picker, shelf

The session that turns a Worker with a database behind it into a site the
family opens. It delivers **H1** — one door — and the reading half of **H3**.

Three things that could each have been their own session, kept together because
none of them is worth anything alone: a gate nobody is behind is a login for no
one, a picker with no shelf to land on picks you for nothing, and a shelf that
does not know who you are is the placeholder page that was already there.

What it does *not* do is let anybody change anything about a profile. That is
Session D, and `../../../ROADMAP.md` says why the line falls there: **Phase 3
needs picking, not editing.**

## 1. Files

```
worker/auth.js            pure: HMAC signing, the two cookies, safeNext
worker/gate.js            the passphrase page and /gate
worker/api.js             /api/players and /api/who
worker/index.js           routes /gate and /api/* alongside /admin

public/shared/theme.css   the shell's tokens, both themes
public/shared/avatars.js  the built-in set: 30 glyphs, pure, no DOM
public/shared/games.js    what is on the shelf
public/shared/api.js      the client's two calls, and what a 401 means
public/hub/hub.css        the hub's layout
public/hub/hub.js         the picker and the shelf
public/index.html         the shell they render into
```

`worker/gate.js` imports `public/shared/avatars.js` — the only place the Worker
reaches into `public/` — so the first screen of the site carries three real
faces rather than three coloured dots. It is safe because that module is pure:
wrangler bundles it into the Worker as happily as the browser loads it. The
dependency points one way only; nothing under `public/` imports from `worker/`.

The split inside the Worker is the one Session A established and for the same
reason: everything with a decision in it takes strings as arguments and is
tested (`auth.js`), and the modules that touch requests hold no logic worth
testing. Unlike Session A's, those two turned out to be reachable from
`node --test` anyway — see §8.

## 2. The gate

One shared family passphrase, the Worker secret `FAMILY_PASSPHRASE`, typed once
per device on a single-field page at `/gate`. Server-rendered, a plain
`<form method="post">`, no client JavaScript — the same reasoning as the admin
page, and the same reason: a login screen that needs a script to work fails on
the one device where the script did not load.

Three decisions inside it worth stating.

**Case and surrounding space are thrown away on both sides.** The passphrase is
typed by a 5-year-old on an Android keyboard that capitalises the first letter
whatever anybody wants. The entropy that costs is entropy this gate was never
relying on: it exists to keep the open internet out of the leaderboard, not to
survive an attack (`../../identity-and-stats.md` §2).

**A wrong word is compared as a digest, not as a string.** Two SHA-256 digests
are always 32 bytes, so a wrong passphrase of the wrong length is rejected in
the same time as a wrong one of the right length. It is four lines and it means
the timing question never has to be thought about again.

**Before setup task A3 there is no passphrase, and the page says so.** It names
A3 rather than showing a form that cannot be right, and it says `/admin` still
works — which is the next paragraph.

### 2.1 What the gate covers, and what it cannot

The gate is in front of `/api/*` and nothing else.

- **The shell is public; the data is not.** `public/index.html` is a file, so
  the assets binding serves it before the Worker script runs at all. Gating it
  would mean giving up the assets binding and serving every page from the
  Worker. What it renders before it has spoken to the server is a heading and a
  spinner: no names, no faces, no record. The first thing it does is ask
  `/api/players`, which is where the gate answers.
- **`/admin` is exempt, deliberately.** It has to render before a passphrase
  exists, and the passphrase is a Worker secret rather than a row — so a gated
  `/admin` is a database that can never be brought up in the first place. Its
  three destructive routes stay as Session B left them: the erase confirmation
  guards itself with a backup receipt, and anyone who can reach `/admin` could
  already erase.

## 3. The two cookies

| Cookie | Holds | Lifetime | Cleared by |
|---|---|---|---|
| `gate` | `{ k, pf, exp }` — proof the passphrase was entered | 1 year | changing either secret |
| `who` | `{ k, id, exp }` — the player id picked here | 1 year | tapping Nobody, or another profile |

Both are `<base64url(JSON)>.<base64url(HMAC-SHA256)>` under `SESSION_SECRET`,
`HttpOnly; SameSite=Lax; Secure`, and verified on every `/api/*` call.

**Neither is secret and neither is encrypted.** A player id is on the screen.
What signing buys is the difference between "the client says it is player 3"
and "the server issued this", which is what Phase 3 will write play results on
the strength of.

**`exp` is inside the signature.** The cookie's own `Max-Age` is the one number
a browser will happily change; a client that edits the expiry invalidates the
cookie rather than extending it.

**`pf` is twelve hex characters of the passphrase's digest**, and it is what
makes changing `FAMILY_PASSPHRASE` log every device out — the cookie still
verifies, but it attests to a passphrase that is no longer the one. Rotating
`SESSION_SECRET` does the same thing harder, invalidating both cookies
everywhere. Neither needs any state kept anywhere, which is why the "lock it
again" story is one dashboard field and no code.

**`SameSite=Lax` rather than `Strict`**, because the family opens this site
from a chat message and `Strict` withholds the cookie on that first navigation
— the gate would ask again every time, which is exactly what it promises not to
do.

## 4. The two endpoints

```
GET  /api/players   → { players: [{ id, name, avatar }], me: string | null }
POST /api/who       { id }        → { me }        sets the who cookie
                    { id: null }  → { me: null }  clears it
```

**One call rather than two**: the shelf needs the faces and the identity to
draw anything, and `me` comes from an `HttpOnly` cookie the page cannot read
for itself.

**Order is fixed** — `created_at, id`, live players only. Position is how a
pre-reader finds their own face, so the shelf does not reorder itself
(`../../design-language.md` §2). Creation order is the one order that never
moves under them; `id` breaks the tie when a seed inserts six rows in the same
millisecond.

**A `who` cookie naming a retired or deleted player reads as nobody**, not as
an error. The picker is the answer to both.

**`{ id: null }` is the shared tablet.** Clearing is one tap from the picker's
Nobody tile, so the next person gets the picker rather than somebody else's
face. There is no confirmation in either direction and no password: sibling
impersonation is possible on purpose, and the deterrent is that every play is
timestamped and the family can see it (`../../identity-and-stats.md` §3.2).

## 5. The avatar set

Thirty inline SVG glyphs in `public/shared/avatars.js`, drawn to four rules:
readable at 32px, one tint each and no two alike, no theme dependency, and
pure — no DOM, so `node --test` imports the file directly.

Animals first, because that is what the 4- and 5-year-old reach for, then the
things that are not animals. Each glyph is built from flat shapes on a 48-unit
box with one dark ink for detail, and sits on its own tinted disc, which is what
makes one glyph legible on the shelf, in a 56px strip tile and in a play-log row
that does not exist yet.

**An unknown key still draws something tappable** — a grey question disc. A
player whose avatar key was edited to something the set does not have needs a
tile that can be found and pressed; an empty one is a tile nobody can find
themselves on. CI asserts that the seed's keys are all in the set, so that path
is a safety net rather than a plan.

Two players may not hold the same avatar. That is enforced in the schema
(`players_avatar_live`, Session A) rather than here, and Session D is where the
picking of one has to respect it.

## 6. Tokens

`public/shared/theme.css`, defined once and used by the gate, the picker, the
shelf and whatever Phase 3 adds. A game may add its own colours; it may not
redefine what is there.

**Dark is the ground and light is the override**, in that order — the site
reads as a game rather than a document, and the phones and the Chromebook will
not agree anyway. Both are `prefers-color-scheme` and there is no toggle.

`--tap: 64px` is the touch floor and is referenced rather than repeated; the
smallest type in the shell is 16px. The sudoku board is exempt from the first
and always will be.

## 7. The picker and the shelf

Two screens, one page, chosen by whether `me` came back null.

**Picker.** Every live profile as a 96px face, two columns at 360px. The first
screen a device ever shows, because a play needs a player and asking once is
cheaper than asking on the way into every game.

**Shelf.** A bar carrying who you are — one tap opens the picker again — then
the games as large tiles, then the family strip with everybody's face on it.
Tapping a face in the strip switches directly. There is nothing else on it: no
settings gear, no news. The play log joins it in Phase 3.

**The strip wraps rather than scrolls.** Six faces do not fit on one 360px row,
and a face nobody scrolls to is a face a 5-year-old cannot find.

**Picking is optimistic.** The ring moves under the thumb and the screen
changes before the server has answered, because a tap that does nothing for
200ms on a phone reads as a tap that missed. A failed write puts the picker
back and says so.

`public/shared/games.js` is the only place a game is named to the hub: adding a
third means adding an object to that list and touching neither of the first two,
which is H2 as code.

## 8. Tests

`node --test`, 39 new assertions across three files.

- **`test/auth.test.js`** — the signing. One property stated several ways: a
  cookie this Worker did not issue does not verify. Wrong secret, edited
  payload, wrong kind, expired, expiry stretched by hand, and eight kinds of
  rubbish that must return null rather than throw. Plus the cookie attributes,
  the passphrase fingerprint, and `safeNext` against nine ways to leave the
  site.
- **`test/gate-api.test.js`** — the routes, driven with real `Request` objects
  and a twenty-line D1 stub. The wrong word refused, the right one setting a
  cookie, case and spaces forgiven, the redirect kept on-site, a rotated
  passphrase locking every device out, the 401 shape, picking, clearing,
  forging, and a `who` cookie naming a player who has gone.
- **`test/avatars.test.js`** — the set. The one that pays for the file is
  *every avatar key in `seed_players.sql` exists in the set*: a key that does
  not is a player with no face, discovered long after the seed was edited.

`worker/index.js` is still unreachable from CI — it imports `admin.js`, which
imports SQL — so the routing *between* the pieces is checked by S8 rather than
here.

The layouts were rendered in headless Chromium at a true 360px viewport, in
both themes, before this shipped. That is a screenshot rather than a test, and
it is not a substitute for **S8**: it says the CSS does what it says, not that a
5-year-old can find the fox.

## 9. Acceptance criteria

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes, including the three new files. | CI |
| 2 | With **A3** done, `/` on a fresh device sends you to `/gate`; the right word lets you in and never asks again on that device. | **S8** |
| 3 | The wrong word is refused with a sentence, and `/api/players` without a gate cookie is a JSON 401. | **S8** |
| 4 | Through the gate, the picker shows the six seeded players with their faces; tapping one lands on the shelf with that face in the bar. | **S8** |
| 5 | Closing the tab and reopening `/` goes straight to the shelf, still as the same player. | **S8** |
| 6 | Tapping the bar shows the picker again; **Nobody** clears the device back to the picker. | **S8** |
| 7 | The shelf's Sudoku tile opens `/sudoku/`, and the sudoku's back link returns to the shelf. | **S8** |
| 8 | Everything is legible and tappable on the 360px phone in portrait — nothing under 64px on the hub, no horizontal scroll. | **S8** |
| 9 | Changing `FAMILY_PASSPHRASE` in the dashboard makes every device ask again. | **S8** |
| 10 | `/admin` still works with no passphrase set, and `/sudoku/` still plays. | **S8** |

Criterion 8 is the one that decides whether any of the rest matters, and it is
the one nothing here can close.

## 10. Explicitly not in this session

- **Creating a profile, changing a screen name, changing an avatar.** Session
  D. Between C and D a name changes by editing `seed_players.sql` — which only
  works for a player who does not exist yet — so the six real names are worth
  getting right before the first **Run seed**
  (`../../identity-and-stats.md` §5).
- **The play log on the shelf.** Phase 3, which is what fills it.
- **Any write to `plays` or `play_results`.** Also Phase 3.
- **A per-child PIN.** Considered and rejected: it buys very little and costs a
  support job the first time one of them forgets it.
