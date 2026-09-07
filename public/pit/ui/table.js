// The DOM half. It paints a Screen and reports taps, and it makes no decisions.
//
// There is no jsdom here — there are no dependencies at all — so nothing in
// this file is covered by CI, and **the size of this file is the size of what
// CI cannot check**. Everything that could be a decision is in `present.js`
// instead: which groups are tappable, what a tap means, when a mode cancels
// itself, what the line says. What is left is create elements, set text, set
// classes, attach listeners, call `onTap`.
//
// Two rules the markup depends on:
//
// - **Nothing changes size when it changes state.** The harvest bar is present
//   and dark from the first render, the line holds its height when empty, a
//   group with zero cards keeps its slot. A live board that reflows under a
//   finger produces mis-taps, and a mis-tap here is a trade.
// - **A row is never recreated while it is on screen.** Replacing a node under
//   a finger cancels the tap that was landing on it, so offer rows are keyed by
//   `offer.id` and updated in place.

import { avatarSvg } from '../../shared/avatars.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A card back and nothing else: a back that differed by commodity would leak. */
const CARD_BACK = 'art/cards/back.webp';

const MOTION = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {HTMLElement} root the table screen's container
 * @param {{ faces: { [playerId: string]: string }, onTarget: (target: object) => void }} wiring
 */
export function createTable(root, { faces, onTarget }) {
  const parts = {
    strip: root.querySelector('#strip'),
    board: root.querySelector('#board'),
    line: root.querySelector('#line'),
    counts: root.querySelector('#counts'),
    harvest: root.querySelector('#harvest'),
    hand: root.querySelector('#hand'),
    scrim: root.querySelector('#scrim'),
    banner: root.querySelector('#banner'),
    sheet: root.querySelector('#sheet'),
    panel: root.querySelector('#panel'),
  };

  const chips = new Map();     // playerId -> node
  const rows = new Map();      // offer id -> node
  const slots = new Map();     // commodity -> node
  const blocks = new Map();    // playerId -> reveal block
  let built = false;
  // Which round's reveal is on screen, so the card's 300ms runs once per
  // harvest rather than on every view push behind it.
  let celebrated = null;

  /** One delegated listener rather than one per node, so rows stay cheap. */
  root.addEventListener('click', (event) => {
    const hit = event.target.closest('[data-target]');
    if (!hit || hit.disabled) return;
    const target = { kind: hit.dataset.target };
    if (hit.dataset.commodity) target.commodity = hit.dataset.commodity;
    if (hit.dataset.id) target.id = hit.dataset.id;
    if (hit.dataset.n) target.n = Number(hit.dataset.n);
    onTarget(target);
  });

  /* ------------------------------------------------------------- building */

  function buildStrip(screen) {
    const menu = el('button', 'chip chip-menu');
    menu.type = 'button';
    menu.dataset.target = 'menu';
    menu.setAttribute('aria-label', 'Game menu');
    menu.append(el('span', 'menu-mark', '≡'));
    parts.strip.append(menu);

    for (const seat of screen.seats) {
      // Not tappable and carrying no target: a seat chip is a readout.
      const chip = el('div', 'chip');
      const face = el('span', 'chip-face');
      face.innerHTML = avatarSvg(faces[seat.playerId] ?? '', { size: 32 });
      const bot = el('span', 'chip-bot', '\u{1F916}');
      const body = el('span', 'chip-body');
      const name = el('span', 'chip-name', seat.name);
      const score = el('span', 'chip-score', String(seat.score));
      const away = el('span', 'chip-away');
      const bar = el('span', 'chip-bar');
      body.append(name, score, away);
      chip.append(face, bot, body, bar);
      parts.strip.append(chip);
      chips.set(seat.playerId, { chip, face, bot, name, score, away, bar, armed: false });
    }
  }

  function buildHand(screen) {
    for (const slot of screen.hand) {
      const node = el('button', 'slot');
      node.type = 'button';
      node.dataset.target = 'group';
      node.dataset.commodity = slot.commodity;
      node.style.setProperty('--tint', slot.tint);
      const art = el('img', 'slot-art');
      art.src = slot.art;
      art.alt = slot.name;
      art.decoding = 'async';
      const count = el('span', 'slot-count', String(slot.count));
      const ring = el('span', 'slot-ring');
      node.append(art, count, ring);
      parts.hand.append(node);
      slots.set(slot.commodity, { node, count, ring });
    }
  }

  /**
   * One block per seat, in seat order, built once. The seats do not change for
   * the length of a session, and **Next round** sits under a thumb: a node
   * replaced under a finger cancels the tap that was landing on it.
   */
  function buildReveal(panel) {
    const host = parts.panel.querySelector('.panel-seats');
    for (const seat of panel.seats) {
      const node = el('li', 'reveal');
      const head = el('div', 'reveal-head');
      const face = el('span', 'reveal-face');
      face.innerHTML = avatarSvg(faces[seat.playerId] ?? '', { size: 32 });
      const name = el('span', 'reveal-name', seat.name);
      const note = el('span', 'reveal-note');
      const score = el('span', 'reveal-score');
      head.append(face, name, note, score);

      const grid = el('div', 'reveal-hand');
      const cells = new Map();
      for (const slot of seat.hand) {
        const cell = el('span', 'rslot');
        cell.style.setProperty('--tint', slot.tint);
        const art = el('img', 'rslot-art');
        art.src = slot.art;
        art.alt = slot.name;
        art.decoding = 'async';
        const count = el('span', 'rslot-count');
        cell.append(art, count);
        grid.append(cell);
        cells.set(slot.commodity, { cell, count });
      }

      const counts = el('p', 'reveal-counts');
      node.append(head, grid, counts);
      host.append(node);
      blocks.set(seat.playerId, { node, name, note, score, cells, counts });
    }
  }

  function paintReveal(panel) {
    if (blocks.size === 0) buildReveal(panel);
    for (const seat of panel.seats) {
      const block = blocks.get(seat.playerId);
      block.node.classList.toggle('is-you', seat.you);
      block.node.classList.toggle('is-harvester', seat.harvester);
      block.name.textContent = seat.name;
      block.score.textContent = String(seat.score);
      block.note.textContent = seat.note ?? '';
      for (const slot of seat.hand) {
        const cell = block.cells.get(slot.commodity);
        cell.count.textContent = String(slot.count);
        cell.cell.classList.toggle('is-empty', slot.count === 0);
        cell.cell.classList.toggle('is-ringed', slot.ringed);
      }
      // Six words of screen, and the only place a round's counts sit still
      // long enough to be read. A seat that offered nothing shows nothing.
      block.counts.textContent = seat.counts.length
        ? `offered ${seat.counts.join(' · ')}${seat.more ? ' …' : ''}`
        : '';
    }
  }

  /* ------------------------------------------------------------- painting */

  function paintStrip(screen) {
    for (const seat of screen.seats) {
      const chip = chips.get(seat.playerId);
      chip.chip.classList.toggle('is-you', seat.you);
      chip.chip.classList.toggle('is-bot', seat.isBot || seat.takenOver);
      chip.chip.classList.toggle('is-taken', seat.takenOver);
      chip.chip.classList.toggle('is-forfeited', seat.forfeited);
      chip.chip.classList.toggle('is-away', seat.away);
      chip.name.textContent = seat.takenOver ? 'Bot playing' : seat.name;
      chip.score.textContent = String(seat.score);
      chip.away.textContent = seat.away ? `away ${seat.awaySeconds}` : '';
      chip.chip.style.setProperty('--cards', String(seat.cards));

      // Armed once, when the warning first appears: a duration reset on every
      // push is a bar that never actually sweeps.
      if (seat.away && !chip.armed) {
        chip.armed = true;
        chip.bar.style.animation = 'none';
        void chip.bar.offsetWidth;
        const left = seat.takeoverAt - Date.now();
        chip.bar.style.animation = MOTION() ? `sweep ${Math.max(0, left)}ms linear forwards` : '';
      } else if (!seat.away && chip.armed) {
        chip.armed = false;
        chip.bar.style.animation = 'none';
      }
    }
  }

  function paintBoard(screen) {
    const live = new Set(screen.offers.map((offer) => offer.id));
    for (const [id, row] of rows) {
      if (live.has(id)) continue;
      row.node.remove();
      rows.delete(id);
    }

    screen.offers.forEach((offer, index) => {
      let row = rows.get(offer.id);
      if (!row) {
        const node = el('li', 'row');
        node.dataset.target = 'offer';
        node.dataset.id = offer.id;
        const face = el('span', 'row-face');
        face.innerHTML = avatarSvg(faces[offer.playerId] ?? '', { size: 32 });
        const name = el('span', 'row-name', offer.name);
        const what = el('span', 'row-what');
        const count = el('span', 'row-count', String(offer.count));
        const left = el('span', 'row-left');
        const bar = el('span', 'row-bar');
        const take = el('button', 'row-take', 'Withdraw');
        take.type = 'button';
        take.dataset.target = 'withdraw';
        node.append(face, name, what, count, left, take, bar);
        // Started once, from the time this row had left when it appeared. The
        // driver pushes only when something changed, so an animation is the
        // only countdown that costs nothing between pushes.
        if (MOTION()) bar.style.animation = `sweep ${offer.msLeft}ms linear forwards`;
        parts.board.append(node);
        row = { node, what, count, left, take, bar };
        rows.set(offer.id, row);
      }
      row.node.style.order = String(index);
      row.count.textContent = String(offer.count);
      // Only ever your own, and only because it is yours.
      row.what.textContent = offer.commodityName ?? '';
      row.left.textContent = String(Math.ceil(offer.msLeft / 1000));
      row.node.classList.toggle('is-mine', offer.mine);
      row.node.classList.toggle('is-grey', offer.greyed);
      row.node.classList.toggle('is-selected', offer.selected);
      row.node.classList.toggle('is-tappable', offer.tappable);
      row.take.hidden = !offer.mine;
    });
  }

  function paintHand(screen) {
    for (const slot of screen.hand) {
      const node = slots.get(slot.commodity);
      node.count.textContent = String(slot.count);
      node.node.classList.toggle('is-empty', slot.count === 0);
      node.node.classList.toggle('is-selected', slot.selected);
      node.node.classList.toggle('is-ringed', slot.ringed);
      node.node.disabled = !slot.tappable;
      node.ring.textContent = slot.progress ?? '';
    }
  }

  let counted = '';

  function paintLine(screen) {
    // Rebuilt only when the row actually changes. A view push lands about once
    // a second while somebody is choosing a count, and a button replaced under
    // a finger cancels the tap that was landing on it.
    const key = screen.counts.join(',');
    if (key !== counted) {
      counted = key;
      parts.counts.replaceChildren();
      for (const n of screen.counts) {
        const button = el('button', 'count', String(n));
        button.type = 'button';
        button.dataset.target = 'count';
        button.dataset.n = String(n);
        parts.counts.append(button);
      }
    }
    parts.line.textContent = screen.counts.length ? '' : screen.line.text;
    parts.line.dataset.kind = screen.line.kind;
  }

  function paintOverlays(screen) {
    parts.scrim.hidden = !screen.paused;
    parts.sheet.hidden = !screen.menu;
    parts.banner.hidden = screen.abandon === null;
    if (screen.abandon) {
      parts.banner.querySelector('.banner-text').textContent = screen.abandon.yours
        ? 'You asked to end the game.'
        : `${screen.abandon.name} wants to end the game.`;
      // The same action means two things, so only one of the two is ever
      // offered: a second press from the proposing seat cancels, and a press
      // from any other seat ends it. An unseconded proposal clears itself.
      parts.banner.querySelector('.banner-end').hidden = screen.abandon.yours;
      parts.banner.querySelector('.banner-keep').hidden = !screen.abandon.yours;
    }

    parts.panel.hidden = screen.roundEnd === null;
    if (screen.roundEnd === null) {
      celebrated = null;
    } else {
      const panel = screen.roundEnd;
      const card = parts.panel.querySelector('.panel-card');
      if (card.getAttribute('src') !== panel.card) {
        card.src = panel.card;
        card.alt = panel.commodityName;
      }
      parts.panel.style.setProperty('--tint', panel.tint);
      parts.panel.querySelector('.panel-headline').textContent = panel.headline;
      parts.panel.querySelector('.panel-note').textContent = panel.note;
      const next = parts.panel.querySelector('.panel-next');
      next.disabled = !panel.canReady;
      next.textContent = panel.ready ? 'Waiting…' : 'Next round';
      paintReveal(panel);

      // Once, as the panel opens, and nothing waits on it: the button above is
      // already live and the backstop is already running.
      if (celebrated !== screen.round) {
        celebrated = screen.round;
        card.classList.remove('is-dealt');
        void card.offsetWidth;
        if (MOTION()) card.classList.add('is-dealt');
        // The blocks are the scroller, and a round that opens halfway down the
        // one before it is a panel nobody trusts.
        parts.panel.querySelector('.panel-seats').scrollTop = 0;
      }
    }
  }

  /* ------------------------------------------------------------ animation */

  // Motion only. No state is derived from an event, ever — the view is the
  // truth, and a client that joined mid-pause never saw the `paused` event.
  function animate(event) {
    if (!MOTION()) return;
    if (event.kind === 'offer' || event.kind === 'withdraw' || event.kind === 'expired') {
      pulse(chips.get(event.playerId));
      return;
    }
    if (event.kind === 'takeover' || event.kind === 'reclaim') {
      pulse(chips.get(event.playerId));
      return;
    }
    if (event.kind !== 'trade') return;
    const from = chips.get(event.a);
    const to = chips.get(event.b);
    if (!from || !to) return;
    flick(from.chip, to.chip);
  }

  function pulse(chip) {
    if (!chip) return;
    chip.chip.classList.remove('pulse');
    void chip.chip.offsetWidth;
    chip.chip.classList.add('pulse');
  }

  /** A card back between two chips. 320ms, and nothing waits on it. */
  function flick(from, to) {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const card = el('img', 'flick');
    card.src = CARD_BACK;
    card.alt = '';
    card.style.left = `${a.left + a.width / 2}px`;
    card.style.top = `${a.top + a.height / 2}px`;
    card.style.setProperty('--dx', `${b.left - a.left}px`);
    card.style.setProperty('--dy', `${b.top - a.top}px`);
    document.body.append(card);
    card.addEventListener('animationend', () => card.remove(), { once: true });
  }

  return {
    /** @param {object} screen */
    paint(screen) {
      if (!built) {
        buildStrip(screen);
        buildHand(screen);
        built = true;
      }
      paintStrip(screen);
      paintBoard(screen);
      paintLine(screen);
      paintHand(screen);
      parts.harvest.disabled = !screen.harvest.enabled;
      parts.harvest.textContent = screen.harvest.label;
      paintOverlays(screen);
      root.classList.toggle('is-paused', screen.paused);
    },
    animate,
  };
}
