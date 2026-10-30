// Game Night Rooms — server
// Holds rooms in memory and keeps every player in a room in sync with Socket.IO.
// Game logic for Cambio / Spades / Poker plugs into the GAMES table later.

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server);

// ---- Games -----------------------------------------------------------------
// Each game will get its own rules module later (deal, turns, scoring).
const GAMES = {
  cambio: { name: "Cambio", minPlayers: 2, maxPlayers: 6 },
  spades: { name: "Spades", minPlayers: 4, maxPlayers: 4 },
  poker:  { name: "Poker",  minPlayers: 2, maxPlayers: 9 },
};

// ---- Rooms -----------------------------------------------------------------
// rooms: code -> { code, game, hostId, status, players: [{id, name, online}], createdAt }
const rooms = new Map();
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups

function newCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 20);
}

function publicRoom(room) {
  return {
    code: room.code,
    game: room.game,
    gameName: GAMES[room.game].name,
    minPlayers: GAMES[room.game].minPlayers,
    maxPlayers: GAMES[room.game].maxPlayers,
    hostId: room.hostId,
    status: room.status,
    players: room.players.map(p => ({ id: p.id, name: p.name, online: p.online })),
  };
}

function broadcast(room) {
  io.to(room.code).emit("room", publicRoom(room));
}

// Remove rooms where nobody has been connected for 30 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyoneOnline = room.players.some(p => p.online);
    if (!anyoneOnline && now - room.lastActive > 30 * 60 * 1000) rooms.delete(code);
  }
}, 5 * 60 * 1000);

// ---- Socket events ---------------------------------------------------------
io.on("connection", socket => {
  // Each browser keeps a stable playerId in localStorage so a refresh keeps your seat.
  let me = null; // { playerId, code }

  function seat(room, playerId, name) {
    let p = room.players.find(x => x.id === playerId);
    if (p) {
      p.online = true;
      if (name) p.name = name;
    } else {
      p = { id: playerId, name, online: true };
      room.players.push(p);
    }
    room.lastActive = Date.now();
    socket.join(room.code);
    me = { playerId, code: room.code };
  }

  socket.on("host", ({ game, name, playerId }, reply = () => {}) => {
    name = cleanName(name);
    if (!GAMES[game]) return reply({ error: "Unknown game." });
    if (!name) return reply({ error: "Add your name first." });
    if (!playerId) return reply({ error: "Missing player id. Refresh the page." });
    leaveCurrent();
    const room = { code: newCode(), game, hostId: playerId, status: "lobby", players: [], createdAt: Date.now(), lastActive: Date.now() };
    rooms.set(room.code, room);
    seat(room, playerId, name);
    reply({ ok: true, room: publicRoom(room) });
    broadcast(room);
  });

  socket.on("join", ({ code, name, playerId }, reply = () => {}) => {
    code = String(code || "").toUpperCase().trim();
    name = cleanName(name);
    const room = rooms.get(code);
    if (!room) return reply({ error: `No room with code ${code}. Check the code with your host.` });
    if (!name) return reply({ error: "Add your name first, then join." });
    if (!playerId) return reply({ error: "Missing player id. Refresh the page." });
    const already = room.players.some(p => p.id === playerId);
    if (!already && room.players.length >= GAMES[room.game].maxPlayers)
      return reply({ error: `This ${GAMES[room.game].name} table is full.` });
    if (!already && room.status === "playing")
      return reply({ error: "This game has already started. Ask the host to go back to the lobby." });
    if (me && me.code !== code) leaveCurrent();
    seat(room, playerId, name);
    reply({ ok: true, room: publicRoom(room) });
    broadcast(room);
  });

  socket.on("rename", ({ name }) => {
    const room = me && rooms.get(me.code);
    if (!room) return;
    const p = room.players.find(x => x.id === me.playerId);
    if (p && cleanName(name)) { p.name = cleanName(name); broadcast(room); }
  });

  socket.on("start", (_, reply = () => {}) => {
    const room = me && rooms.get(me.code);
    if (!room || room.hostId !== me.playerId) return reply({ error: "Only the host can start." });
    const n = room.players.length, g = GAMES[room.game];
    if (n < g.minPlayers) return reply({ error: `${g.name} needs at least ${g.minPlayers} players.` });
    room.status = "playing";
    reply({ ok: true });
    broadcast(room);
  });

  socket.on("lobby", (_, reply = () => {}) => {
    const room = me && rooms.get(me.code);
    if (!room || room.hostId !== me.playerId) return reply({ error: "Only the host can do that." });
    room.status = "lobby";
    reply({ ok: true });
    broadcast(room);
  });

  socket.on("leave", (_, reply = () => {}) => {
    leaveCurrent();
    reply({ ok: true });
  });

  socket.on("close", (_, reply = () => {}) => {
    const room = me && rooms.get(me.code);
    if (!room || room.hostId !== me.playerId) return reply({ error: "Only the host can close the room." });
    io.to(room.code).emit("closed", { code: room.code });
    io.in(room.code).socketsLeave(room.code);
    rooms.delete(room.code);
    me = null;
    reply({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = me && rooms.get(me.code);
    if (!room) return;
    const p = room.players.find(x => x.id === me.playerId);
    if (p) p.online = false;
    room.lastActive = Date.now();
    broadcast(room);
  });

  function leaveCurrent() {
    const room = me && rooms.get(me.code);
    if (!room) { me = null; return; }
    room.players = room.players.filter(p => p.id !== me.playerId);
    socket.leave(room.code);
    if (room.players.length === 0) {
      rooms.delete(room.code);
    } else {
      if (room.hostId === me.playerId) room.hostId = room.players[0].id; // pass host on
      broadcast(room);
    }
    me = null;
  }
});

server.listen(PORT, () => console.log(`Game Night Rooms running on http://localhost:${PORT}`));
