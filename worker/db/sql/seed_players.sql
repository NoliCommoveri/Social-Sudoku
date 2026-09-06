-- Placeholder profiles, one per household member. Six rows, because there are
-- six of you.
--
-- This file is the seed mechanism demonstrating itself: change a screen_name or
-- an avatar here in the GitHub web editor, press Run seed, and the row appears.
-- What it will NOT do is change a row that already exists -- every statement is
-- ON CONFLICT DO NOTHING, which is what makes pressing the button twice safe.
-- Renaming a player who already exists is the picker's job, not this file's.
--
-- The ids are arbitrary and permanent. Nothing shows them, everything keys on
-- them, and changing one after a game has been played orphans that game.
--
-- The avatar keys must exist in the built-in set that Session C commits. If a
-- name here is not in that set, change it here rather than adding a glyph
-- nobody chose.

INSERT INTO players (id, screen_name, avatar, created_at)
VALUES ('p1', 'Grown-up One', 'owl', strftime('%s', 'now') * 1000)
ON CONFLICT DO NOTHING;

INSERT INTO players (id, screen_name, avatar, created_at)
VALUES ('p2', 'Grown-up Two', 'fox', strftime('%s', 'now') * 1000)
ON CONFLICT DO NOTHING;

INSERT INTO players (id, screen_name, avatar, created_at)
VALUES ('p3', 'Twelve', 'dragon', strftime('%s', 'now') * 1000)
ON CONFLICT DO NOTHING;

INSERT INTO players (id, screen_name, avatar, created_at)
VALUES ('p4', 'Eleven', 'rocket', strftime('%s', 'now') * 1000)
ON CONFLICT DO NOTHING;

INSERT INTO players (id, screen_name, avatar, created_at)
VALUES ('p5', 'Five', 'cat', strftime('%s', 'now') * 1000)
ON CONFLICT DO NOTHING;

INSERT INTO players (id, screen_name, avatar, created_at)
VALUES ('p6', 'Four', 'frog', strftime('%s', 'now') * 1000)
ON CONFLICT DO NOTHING;
