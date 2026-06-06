import cors from 'cors';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { connectMongo } from './db/connect.js';
import { computeLeapFrogTrajectory, computeTrajectory, detectHit } from './game/game-engine.js';
import {
  createGame,
  clearTableGames,
  eliminatePlayer,
  endGame,
  endIfWinner,
  getGame,
  getGames,
  getMutableGame,
  getNextTurn,
  joinGame,
  rejoinGame,
  resetGame,
  setTankAzimuth,
  startGame
} from './game/room-manager.js';
import { gamesRouter } from './routes/games.js';
import { venueRouter } from './routes/venue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const frontendDir = path.join(rootDir, 'frontend');
const port = Number(process.env.PORT || 3001);
const corsOrigin = process.env.CORS_ORIGIN || '*';

await connectMongo();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use('/api', venueRouter);
app.use('/api', gamesRouter);
app.use(express.static(frontendDir));

app.get('/venue/:venueId/table/:tableNo', (req, res) => {
  res.sendFile(path.join(frontendDir, 'venue', 'index.html'));
});

app.get('/venue/:venueId/table/:tableNo/game/:gameId', (req, res) => {
  res.sendFile(path.join(frontendDir, 'venue', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(frontendDir, 'admin', 'index.html'));
});

app.get('/', (req, res) => {
  res.redirect('/venue/demo/table/1');
});

const gameNamespace = io.of('/game');
const turnTimers = new Map();
const TURN_TIMEOUT_MS = 30000;

function tableRoom(venueId, tableNo) {
  return `table:${venueId}:${tableNo}`;
}

function clearTurnTimer(gameId) {
  const timer = turnTimers.get(gameId);
  if (timer) {
    clearTimeout(timer);
    turnTimers.delete(gameId);
  }
}

function scheduleTurnTimeout(gameId) {
  clearTurnTimer(gameId);

  const game = getMutableGame(gameId);
  if (!game || game.status !== 'playing' || !game.currentTurn) return;

  const expectedPlayerId = game.currentTurn;
  const timer = setTimeout(() => {
    const currentGame = getMutableGame(gameId);
    if (!currentGame || currentGame.status !== 'playing' || currentGame.currentTurn !== expectedPlayerId) return;

    const player = currentGame.players.find((item) => item.id === expectedPlayerId);
    if (!player || player.alive === false) {
      const nextTurn = getNextTurn(currentGame);
      gameNamespace.to(currentGame.id).emit('your-turn', { playerId: nextTurn });
      gameNamespace.to(currentGame.id).emit('game-state', { game: getGame(currentGame.id) });
      scheduleTurnTimeout(currentGame.id);
      return;
    }

    gameNamespace.to(currentGame.id).emit('turn-timeout', { playerId: expectedPlayerId });
    launchShot(currentGame, player, {
      azimuth: player.azimuth || 0,
      elevation: 85,
      power: 20
    });
  }, TURN_TIMEOUT_MS);

  turnTimers.set(gameId, timer);
}

function launchShot(game, player, { azimuth, elevation, power }) {
  clearTurnTimer(game.id);

  player.azimuth = Number(azimuth);
  const origin = { ...player.position, y: 0.07 };
  const trajectoryFn = game.config.bombMode === 'leap-frog' ? computeLeapFrogTrajectory : computeTrajectory;
  const waypoints = trajectoryFn(origin, Number(azimuth), Number(elevation), Number(power));
  const result = detectHit(waypoints, game.players, player.id);
  const launchAt = Date.now(); // no intentional delay — clients start animation on receive

  gameNamespace.to(game.id).emit('projectile-launched', {
    waypoints,
    hit: result.hit,
    targetId: result.targetId,
    impactPoint: result.impactPoint,
    launchAt
  });

  setTimeout(() => {
    const currentGame = getMutableGame(game.id);
    if (!currentGame || currentGame.status !== 'playing') return;

    if (result.hit) {
      eliminatePlayer(currentGame, result.targetId);
      gameNamespace.to(currentGame.id).emit('player-eliminated', { playerId: result.targetId });
    }

    const winner = result.hit ? endIfWinner(currentGame) : null;

    if (winner) {
      clearTurnTimer(currentGame.id);
      gameNamespace.to(currentGame.id).emit('game-over', { winnerId: winner.id, game: getGame(currentGame.id) });
      return;
    }

    const nextTurn = getNextTurn(currentGame);
    gameNamespace.to(currentGame.id).emit('your-turn', { playerId: nextTurn });
    gameNamespace.to(currentGame.id).emit('game-state', { game: getGame(currentGame.id) });
    scheduleTurnTimeout(currentGame.id);
  }, Math.max(1600, waypoints.length * 45 + 650));
}

gameNamespace.on('connection', (socket) => {
  socket.on('request-games', ({ venueId, tableNo } = {}) => {
    const cleanVenueId = String(venueId || 'demo');
    const cleanTableNo = String(tableNo || '1');
    socket.join(tableRoom(cleanVenueId, cleanTableNo));
    socket.emit('games-list', { games: getGames(cleanVenueId, cleanTableNo) });
  });

  socket.on('create-game', ({ venueId, tableNo, config } = {}, ack) => {
    try {
      const game = createGame(String(venueId || 'demo'), String(tableNo || '1'), config || {});
      gameNamespace.to(tableRoom(game.venueId, game.tableNo)).emit('games-list', { games: getGames(game.venueId, game.tableNo) });
      ack?.({ ok: true, game });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on('join-game', ({ gameId, username } = {}, ack) => {
    try {
      const cleanName = String(username || '').trim().slice(0, 24);
      if (!cleanName) throw new Error('Username is required');
      const { game, playerId, tankIndex } = joinGame(String(gameId), { username: cleanName });
      socket.join(game.id);
      socket.emit('joined', { playerId, tankIndex, players: game.players, config: game.config, game });
      socket.to(game.id).emit('player-joined', {
        player: game.players.find((item) => item.id === playerId),
        players: game.players
      });
      gameNamespace.to(game.id).emit('game-state', { game });
      ack?.({ ok: true, playerId, tankIndex, game });
    } catch (error) {
      socket.emit('error-message', { error: error.message });
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on('rejoin-game', ({ gameId, playerId } = {}, ack) => {
    try {
      const game = rejoinGame(String(gameId), String(playerId));
      socket.join(game.id);
      socket.emit('game-state', { game });
      ack?.({ ok: true, game });
    } catch (error) {
      socket.emit('error-message', { error: error.message });
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on('start-game', ({ gameId } = {}, ack) => {
    try {
      const game = startGame(String(gameId));
      gameNamespace.to(game.id).emit('game-started', {
        players: game.players,
        currentTurn: game.currentTurn,
        config: game.config,
        game
      });
      gameNamespace.to(game.id).emit('your-turn', { playerId: game.currentTurn });
      scheduleTurnTimeout(game.id);
      ack?.({ ok: true, game });
    } catch (error) {
      socket.emit('error-message', { error: error.message });
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on('reset-game', ({ gameId } = {}, ack) => {
    try {
      const game = resetGame(String(gameId));
      clearTurnTimer(game.id);
      gameNamespace.to(game.id).emit('game-state', { game });
      ack?.({ ok: true, game });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on('end-game', ({ gameId } = {}, ack) => {
    try {
      const game = endGame(String(gameId));
      clearTurnTimer(game.id);
      gameNamespace.to(game.id).emit('game-state', { game });
      gameNamespace.to(tableRoom(game.venueId, game.tableNo)).emit('games-list', { games: getGames(game.venueId, game.tableNo) });
      ack?.({ ok: true, game });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on('clear-table-games', ({ venueId, tableNo } = {}, ack) => {
    const cleanVenueId = String(venueId || 'demo');
    const cleanTableNo = String(tableNo || '1');
    const removed = clearTableGames(cleanVenueId, cleanTableNo);
    removed.forEach(clearTurnTimer);
    gameNamespace.to(tableRoom(cleanVenueId, cleanTableNo)).emit('games-list', { games: [] });
    ack?.({ ok: true, removed });
  });

  socket.on('rotate-tank', ({ gameId, playerId, azimuth } = {}) => {
    try {
      const game = setTankAzimuth(String(gameId), String(playerId), Number(azimuth));
      gameNamespace.to(game.id).emit('tank-rotated', { playerId, azimuth: Number(azimuth) });
    } catch (error) {
      socket.emit('error-message', { error: error.message });
    }
  });

  socket.on('fire', ({ gameId, playerId, azimuth, elevation, power } = {}, ack) => {
    try {
      const game = getMutableGame(String(gameId));
      if (!game) throw new Error('Game not found');
      if (game.status !== 'playing') throw new Error('Game is not playing');
      if (game.currentTurn !== String(playerId)) throw new Error('Not your turn');
      const player = game.players.find((item) => item.id === String(playerId));
      if (!player || player.alive === false) throw new Error('Player cannot fire');

      launchShot(game, player, { azimuth, elevation, power });

      ack?.({ ok: true });
    } catch (error) {
      socket.emit('error-message', { error: error.message });
      ack?.({ ok: false, error: error.message });
    }
  });
});

server.listen(port, () => {
  console.log(`[server] Scorched Earth listening on http://localhost:${port}`);
});
