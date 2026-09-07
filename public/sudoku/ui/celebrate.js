// The finish. A solved grid used to change one line of status text, which is
// nothing to a 5-year-old and not much more to a 12-year-old, so completion
// gets the middle of the screen: a modal dialog, a loud line, and confetti.
//
// It owns nothing about the game. `show` is handed the words to print and the
// two things the player can do next; app.js decides when a puzzle is finished.

// Read once. A reduced-motion phone gets the dialog and the words with none of
// the movement — the celebration is not carried by the animation.
const STILL = window.matchMedia('(prefers-reduced-motion: reduce)');

// Said out loud by an 11-year-old and a 4-year-old alike. Mixed registers on
// purpose: the same popup has to land for both, and one of them thinks "great
// job" is what you say to a toddler.
const LINES = [
  'Great job!',
  'Nice work!',
  'Bruh, you slayed!',
  'Boom. Solved.',
  'You got it!',
  'Big brain!',
  'Nailed it!',
  'Absolute legend.',
  'Too easy for you.',
  'Sudoku destroyed.',
];

const MARKS = ['🎉', '🌟', '🔥', '🏆', '💥', '🚀'];

const CONFETTI_COLORS = ['#ffb02e', '#1a56b8', '#1f8a4c', '#e0457b', '#7b4ce0', '#2ec5c5'];
const CONFETTI_COUNT = 26;

// The last line shown, so the next win is never the same words twice running —
// which is the fastest way to make a celebration read as a canned dialog.
let lastLine = '';

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickLine() {
  if (LINES.length < 2) return LINES[0];
  let line = pick(LINES);
  while (line === lastLine) line = pick(LINES);
  lastLine = line;
  return line;
}

function fillConfetti(host) {
  host.replaceChildren();
  if (STILL.matches) return;
  const pieces = document.createDocumentFragment();
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = pick(CONFETTI_COLORS);
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.animationDuration = `${1.2 + Math.random() * 0.8}s`;
    pieces.append(piece);
  }
  host.append(pieces);
}

/**
 * Wires the win dialog once and returns its controls.
 *
 * @param {object} options
 * @param {() => void} options.onAgain deal the next puzzle
 * @param {() => void} options.onClose focus went to the dialog; put it back
 * @returns {{ show: (subtitle: string) => void, close: () => void }}
 */
export function createCelebration({ onAgain, onClose }) {
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('win'));
  const line = document.getElementById('win-line');
  const mark = document.getElementById('win-mark');
  const sub = document.getElementById('win-sub');
  const confetti = document.getElementById('confetti');

  function close() {
    if (dialog.open) dialog.close();
  }

  // Closing by any route — the buttons, Escape, a tap on the ground — stops the
  // confetti and hands focus back to the board.
  dialog.addEventListener('close', () => {
    confetti.replaceChildren();
    onClose();
  });

  // The dialog fills the viewport and the card is a child of it, so a click
  // that lands on the dialog itself landed outside the card.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  document.getElementById('win-again').addEventListener('click', () => {
    close();
    onAgain();
  });
  document.getElementById('win-close').addEventListener('click', close);

  return {
    show(subtitle) {
      if (dialog.open) return;
      line.textContent = pickLine();
      mark.textContent = pick(MARKS);
      sub.textContent = subtitle;
      fillConfetti(confetti);
      dialog.showModal();
    },
    close,
  };
}
