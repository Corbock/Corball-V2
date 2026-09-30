create table if not exists public.corball_leaderboard (
	player_id text primary key,
	display_name text not null check (char_length(display_name) between 1 and 20),
	total_goals integer not null default 0 check (total_goals >= 0),
	battle_pass_level integer not null default 1 check (battle_pass_level >= 1),
	updated_at timestamptz not null default now()
);

alter table public.corball_leaderboard enable row level security;

grant usage on schema public to anon;
grant select, insert, update on public.corball_leaderboard to anon;

drop policy if exists "Anyone can view leaderboard" on public.corball_leaderboard;
drop policy if exists "Anyone can submit leaderboard scores" on public.corball_leaderboard;
drop policy if exists "Anyone can update leaderboard scores" on public.corball_leaderboard;

create policy "Anyone can view leaderboard"
	on public.corball_leaderboard for select
	to anon using (true);

create policy "Anyone can submit leaderboard scores"
	on public.corball_leaderboard for insert
	to anon with check (true);

create policy "Anyone can update leaderboard scores"
	on public.corball_leaderboard for update
	to anon using (true) with check (true);
7