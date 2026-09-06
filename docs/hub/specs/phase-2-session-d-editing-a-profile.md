# Phase 2 Session D — Editing a profile

The write half of **H3**: the family defines its own profiles, with avatars and
screen names each player changes whenever they like. Session C could show you
the six people the seed put there and let you say which one you are. This
session is the one where an 11-year-old can be somebody the seed never heard
of, and where a name changes without anybody editing SQL.

It closes Phase 2.

## 1. Files

```
public/shared/profile.js  pure: what a name and a face have to pass
public/shared/api.js      gains createPlayer and updatePlayer
public/hub/hub.js         gains the editor, the third screen
public/hub/hub.css        the editor's layout
worker/api.js             POST /api/players, PATCH /api/players/:id
```

**The rules live under `public/shared/`, not under `worker/`.** They are the
same rules on both sides — the editor says "somebody already has that face"
without a round trip, and the Worker decides it again without trusting that the
editor did — and the dependency between the two trees only ever points from
`worker/` into `public/` (`../../../worker/README.md`). So the shared half goes
where both can reach it, alongside `avatars.js`, which the Worker already
imports for the same reason.

The browser's copy of the check is a courtesy and never a guard. Anybody
through the gate can post whatever they like, and the Worker's answer is the
one that decides.

## 2. Two endpoints

```
POST  /api/players        { name, avatar }   → 201 { player, me }
PATCH /api/players/:id    { name?, avatar? } → 200 { player }
```

**A refusal names a field.** `400 { error: 'invalid', field, detail }`, where
`field` is `name` or `avatar` and `detail` is the sentence to show. The editor
puts it beside the control that is wrong, which is the difference between "that
did not work" and "somebody already has that face".

**`PATCH` takes either field alone.** What is left out keeps the value on the
row, so renaming does not require the editor to know which avatar it is
looking at. What can never be sent is `id`: that is the point of splitting it
from the name, and it is why a rename touches no play result
(`../../identity-and-stats.md` §3).

**Creating picks the new profile only if the device had nobody.** A phone that
has just been cleared is somebody sitting down to make themselves, and hunting
for the face you drew a second ago is a step for nothing. A parent making a
profile for a child from their own phone is the other case, and there the
device stays as the parent: making a profile is not the same thing as becoming
one.

### 2.1 No locks inside

Anybody through the gate can edit anybody. That follows from
`../../identity-and-stats.md` §1 — a gate at the door and no locks inside —
and it is load-bearing rather than an omission: the 4-year-old will not fix
their own name, and an adult doing it from their own phone must not first have
to become them on that device.

The deterrent against a sibling renaming their brother is the one that works at
a physical board game: everybody can see it, and it is undone in four taps.

## 3. What a name has to pass

- **Trimmed, collapsed, and stripped of control characters.** An Android
  keyboard and a paste out of a chat message produce all three.
- **Case is kept exactly as typed.** The gate's passphrase is the only thing on
  this site that lowercases anything; a screen name is the one the kid chose.
- **Twenty characters, counted as characters.** The bar shows a name beside a
  48px face on a 360px phone and ellipsises what does not fit, so a longer name
  is the same name with a `…` on it. Twenty emoji are twenty characters, not
  forty.
- **Not somebody else's, whatever the capitals.** Two `Twelve`s in the strip is
  a strip nobody can read. Nothing keys on the name, so this is a courtesy
  rather than a constraint — but it is the courtesy that keeps the family strip
  meaning something.

## 4. What a face has to pass

In the set, and not held by another live player. Both are already true of the
schema — `players_avatar_live` is a unique index over live rows (Session A) —
and the Worker checks them first anyway, because a constraint error is not a
sentence anybody wants to read.

The index still has the last word, and the code catches it: two phones can pick
the fox in the same second, and the second one gets the same sentence it would
have got a moment earlier.

**A retired player releases their face.** That falls out of the partial index
and is the right answer; nothing in this session retires anybody.

## 5. The editor

The third screen, beside the picker and the shelf, in the same file and the
same state machine. It is one name and thirty faces, and it is the same screen
for a profile that exists and one that does not — the heading and the word on
the button are the only differences.

**Both ways in are on the picker.** The `New player` tile sits in the grid
where the next face would go, and a `Change my name or face` button sits under
it. That is where they belong: the picker is the screen whose subject is
already who you are, and the shelf's bar has room for one control rather than
two — the front page stays the games and the faces
(`../../design-language.md` §3). The cost is one extra tap on a thing done
rarely.

**A face somebody holds is shown, disabled, with their name under it.** Hiding
it would give a grid that changes shape as the family grows, and "the dragon is
Twelve's" is an answer to why it cannot be picked. An absent tile answers
nothing.

**The preview is the top of the screen**, at 112px, because a 5-year-old is
choosing a fox rather than filling in a form.

**Nothing here is optimistic**, unlike picking (`phase-2-session-c-gate-picker-shelf.md`
§7). Picking a face is undone by picking another one; a save that silently did
not happen is a name somebody believes they changed, and finding that out a day
later is worse than waiting 200ms.

**The save follows the screen down.** Thirty faces are eight rows on a 360px
phone, so the button is sticky at the bottom, and a refusal scrolls itself into
view — a message rendered beside the name field is a message nobody is looking
at when they press a button eight rows below it.

**What was typed survives choosing a face.** Every screen redraws whole, so the
name lives in state and the input's `input` event keeps it there. Without that,
typing a name and choosing a face would be mutually exclusive.

## 6. Tests

`node --test`, 24 new assertions across two files, taking the suite to 178.

- **`test/profile.test.js`** — the rules. The one that pays for the file is
  *editing yourself is never blocked by yourself*: the caller passes everybody
  **else**, so keeping your own face while changing your name has to stay
  legal, and a version that compared against the whole house would refuse every
  rename.
- **`test/players-write.test.js`** — the two routes, driven with real
  `Request`s through the gate. Its D1 stub is a step past Session C's: those
  routes only ask for a list, and a stub that ignored the SQL would let every
  assertion here pass against a Worker that wrote nothing. This one holds rows,
  applies the three statements `api.js` issues, and enforces the live-avatar
  index, so the constraint path is reachable without SQLite.

The three screens were rendered in headless Chromium at a true 360px viewport
in both themes, and the editor was driven through it — create, refuse, rename,
back out — against a server running the same `profile.js`. That is a screenshot
and a script rather than a test, and it is not a substitute for **S9**: it says
the round trip works, not that the 11-year-old finds it.

## 7. Acceptance criteria

| # | Criterion | Closed by |
|---|---|---|
| 1 | `node --test` passes, including the two new files. | CI |
| 2 | From the picker, `New player` makes a profile with a name and a face, and it appears in the strip in creation order. | **S9** |
| 3 | Making one on a device with nobody on it lands on the shelf as that new player; making one while somebody is picked leaves the device as them. | **S9** |
| 4 | `Change my name or face` renames the picked player, and the new name is in the bar and the strip immediately. | **S9** |
| 5 | A face another player holds cannot be tapped and says whose it is; a name somebody has is refused in a sentence. | **S9** |
| 6 | A renamed player is still the same player: the `who` cookie is unchanged and nothing has to be picked again. | **S9** |
| 7 | Everything is legible and tappable on the 360px phone — nothing under 64px, no horizontal scroll, no type under 16px. | **S9** |
| 8 | The 11-year-old renames themselves without being shown how. | **S9** |

Criterion 8 is the one that decides whether the rest mattered.

## 8. Explicitly not in this session

- **Retiring a profile.** The schema has `retired_at` and nothing sets it.
  A soft delete behind a door with no locks inside is a prank a 12-year-old
  plays on a 4-year-old once, and the mis-typed profile it would clean up is
  fixed by renaming it instead. The escape hatch, if one is ever needed before
  it is built properly, is `/admin` — export, erase, re-import.
- **Drawing your own avatar.** `../../identity-and-stats.md` §3.1 says what that
  becomes if the kids ask: an SVG committed to the repo, still no upload path.
- **Anything about the record.** Phase 3.
