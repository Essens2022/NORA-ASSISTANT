-- conv_lang used to be silently auto-written to whatever language was last
-- detected in conversation, so a value there never meant "the user deliberately
-- fixed this language" - it was just a stale, inert guess. Now that the app
-- treats a non-null conv_lang as a real, sticky user choice (never overridden by
-- auto-detection), any conv_lang set by the old behavior must be cleared so
-- everyone starts clean in "Automat" mode; a real pin only comes from an explicit
-- pick in Profile from now on.
update public.profiles set conv_lang = null where conv_lang is not null;
