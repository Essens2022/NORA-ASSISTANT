-- Widen memory_items.kind so NORA can hold richer memories than just
-- "preference"/"fact": ideas, personal notes and moments the user asks to
-- keep, matching the "Amintirile mele" (memory) screen's categories.
alter table public.memory_items drop constraint memory_items_kind_check;
alter table public.memory_items add constraint memory_items_kind_check check (kind in ('preference', 'fact', 'idea', 'note', 'moment'));
