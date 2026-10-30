# Game Night Rooms

Host a Cambio, Spades or Poker table, share a 5-letter code or invite link, and friends join from any phone or laptop. No sign-up needed.

## Run it on your computer

1. Install Node.js 18 or newer from https://nodejs.org
2. In this folder, run:
   ```
   npm install
   npm start
   ```
3. Open http://localhost:3000

Friends on the same Wi-Fi can join at `http://<your-computer's-IP>:3000`.

## Put it online (free) with Render

1. Create a GitHub repository and upload this folder (without `node_modules`).
2. Go to https://render.com, sign in with GitHub, and choose **New → Web Service**.
3. Pick your repository and set:
   - Build command: `npm install`
   - Start command: `npm start`
4. Press **Create Web Service**. After a minute or two you get a link like `https://game-night-xxxx.onrender.com`.
5. Send that link to your friends. Host a game, then tap **Send invite link** to share the room.

Free hosting sleeps after a while with no visitors. The first visit after that can take about a minute to load, and any open rooms are cleared.

## Files

- `server.js`: the server. It keeps the rooms and syncs everyone with Socket.IO. The game rules will plug into the `GAMES` table here.
- `public/index.html`: the website your friends see.
