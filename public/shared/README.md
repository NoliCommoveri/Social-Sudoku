What every screen draws from. Nothing here belongs to one game.

```
theme.css   the shell's tokens, both themes; 64px touch floor, 16px type floor
avatars.js  the built-in avatar set: 30 inline SVG glyphs, pure, no DOM
games.js    what is on the shelf. Adding a third game is an entry here
api.js      the client's calls, and what a 401 means (go to the gate)
```

`avatars.js` and `games.js` are imported by `node --test` as well as by the
browser, which is why neither touches the DOM.
