# Corball-V2

## Global leaderboard setup

The title-screen leaderboard uses Supabase and stays offline until configured. Create a Supabase project, run the SQL in [`TheCode/leaderboard.sql`](TheCode/leaderboard.sql) in the SQL Editor, then copy the project URL and anon/public key into `LEADERBOARD_SUPABASE_URL` and `LEADERBOARD_SUPABASE_ANON_KEY` near the top of `TheCode/Script.js`.

The game submits the existing local profile's career goals and battle-pass level under a random ID stored in that browser. Split-screen players do not receive separate leaderboard profiles. This is a casual, client-submitted board: players can alter local data or submit fabricated scores, so it is not suitable for prizes or competitive rankings. Never put a Supabase service-role key in browser code.

## Online matches on GitHub Pages

GitHub Pages only hosts the static game files; online rooms require the Node.js WebSocket server. This repository includes a Render Blueprint in [`render.yaml`](render.yaml). In Render, create a Blueprint Instance from this repository and deploy the `corball-v2-online` web service. The GitHub Pages client connects to `wss://corball-v2-online.onrender.com`; if Render assigns a different service URL, update `ONLINE_SERVER_URL` near the top of `TheCode/Script.js` to that URL using the `wss://` scheme.

The free Render service may take about a minute to wake after inactivity. Room data is held in server memory, so restarting or redeploying the service clears existing rooms; the host should create a new room afterward.