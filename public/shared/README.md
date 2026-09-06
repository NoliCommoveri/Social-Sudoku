What every screen draws from. Nothing here belongs to one game.

```
theme.css   the shell's tokens, both themes; 64px touch floor, 16px type floor
avatars.js  the built-in avatar set: 30 inline SVG glyphs, pure, no DOM
profile.js  what a screen name and a face have to pass, pure, no DOM
games.js    what is on the shelf. Adding a third game is an entry here
api.js      the client's calls, and what a 401 means (go to the gate)
```

`avatars.js`, `profile.js` and `games.js` are imported by `node --test` as well
as by the browser, which is why none of them touches the DOM.

`avatars.js` and `profile.js` are also imported by the Worker — the gate needs
real faces on it, and a name is refused by the same rule on both sides. Those
are the only crossings between the two trees, and they point this way only:
nothing here imports from `worker/`.
