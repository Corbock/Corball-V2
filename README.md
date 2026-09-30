# Corball-V2

## Global leaderboard setup

The title-screen leaderboard uses Supabase and stays offline until configured. Create a Supabase project, run the SQL in [`TheCode/leaderboard.sql`](TheCode/leaderboard.sql) in the SQL Editor, then copy the project URL and anon/public key into `LEADERBOARD_SUPABASE_URL` and `LEADERBOARD_SUPABASE_ANON_KEY` near the top of `TheCode/Script.js`.

The game submits the existing local profile's career goals and battle-pass level under a random ID stored in that browser. Split-screen players do not receive separate leaderboard profiles. This is a casual, client-submitted board: players can alter local data or submit fabricated scores, so it is not suitable for prizes or competitive rankings. Never put a Supabase service-role key in browser code.