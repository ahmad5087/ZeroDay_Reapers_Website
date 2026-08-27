-- 107_fk_indexes_hot_tables.sql — Covering indexes for foreign keys on HOT tables (Supabase perf lint:
-- unindexed_foreign_keys). Run after 106. Idempotent.
--
-- SAFETY: an index NEVER changes query results, RLS, or access — it only speeds up joins and cascade
-- deletes. So this cannot affect Website, Portfolio, or Portal behavior; it only makes some Portal queries
-- (chat, DMs, mentions, submission files) and user-deletion faster. Every statement is `create index if
-- not exists`, so re-running is a no-op.
--
-- SCOPE: the advisor flagged 53 unindexed FKs. We deliberately index only the ~16 on frequently
-- joined/filtered hot tables — indexing the cold/admin-audit ones (admin_actions, app_settings,
-- feature_flags, opportunities, posts, risk_cases, resources, office hours, etc.) would add write overhead
-- for little gain and could just re-appear as "unused index" warnings. Tables here are small today, so a
-- plain (non-concurrent) build is instant.

-- Chat + reactions/hides (hottest tables) --------------------------------------------------------------
create index if not exists idx_messages_user_id            on public.messages (user_id);
create index if not exists idx_messages_reply_to           on public.messages (reply_to);
create index if not exists idx_message_reactions_user_id   on public.message_reactions (user_id);
create index if not exists idx_message_hides_message_id    on public.message_hides (message_id);
create index if not exists idx_message_reports_message_id  on public.message_reports (message_id);

-- Direct messages --------------------------------------------------------------------------------------
create index if not exists idx_dm_messages_sender_id       on public.dm_messages (sender_id);
create index if not exists idx_dm_messages_reply_to        on public.dm_messages (reply_to);
create index if not exists idx_dm_reactions_user_id        on public.dm_reactions (user_id);
create index if not exists idx_dm_message_hides_dm_msg_id  on public.dm_message_hides (dm_message_id);

-- @mentions (looked up per message) --------------------------------------------------------------------
create index if not exists idx_mentions_message_id         on public.mentions (message_id);
create index if not exists idx_mentions_author_id          on public.mentions (author_id);
create index if not exists idx_mentions_domain_id          on public.mentions (domain_id);

-- Submission files (version history + per-user lookups) ------------------------------------------------
create index if not exists idx_submission_files_submission on public.submission_files (submission_id);
create index if not exists idx_submission_files_user_id    on public.submission_files (user_id);

-- Profiles: referred_by drives the referral leaderboard join; domain_id drives roster/domain filtering.
create index if not exists idx_profiles_referred_by        on public.profiles (referred_by);
create index if not exists idx_profiles_domain_id          on public.profiles (domain_id);
