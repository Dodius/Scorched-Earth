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
  eliminatePlayer,
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

gameNamespace.on('connection', (socket) => {
  socket.on('request-games', ({ venueId, tableNo } = {}) => {
    socket.emit('games-list', { games: getGames(String(venueId || 'demo'), String(tableNo || '1')) });
  });

  socket.on('create-game', ({ venueId, tableNo, config } = {}, ack) => {
    try {
      const game = createGame(String(venueId || 'demo'), String(tableNo || '1'), config || {});
      gameNamespace.emit('games-list', { games: getGames(game.venueId, game.tableNo) });
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
      ack?.({ ok: true, game });
    } catch (error) {
      socket.emit('error-message', { error: error.message });
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on('reset-game', ({ gameId } = {}, ack) => {
    try {
      const game = resetGame(String(gameId));
      gameNamespace.to(game.id).emit('game-state', { game });
      ack?.({ ok: true, game });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
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

      player.azimuth = Number(azimuth);
      const origin = { ...player.position, y: 0.07 };
      const trajectoryFn = game.config.bombMode === 'leap-frog' ? computeLeapFrogTrajectory : computeTrajectory;
      const waypoints = trajectoryFn(origin, Number(azimuth), Number(elevation), Number(power));
      const result = detectHit(waypoints, game.players, String(playerId));
      const launchAt = Date.now() + 300;

      if (result.hit) {
        eliminatePlayer(game, result.targetId);
      }

      gameNamespace.to(game.id).emit('projectile-launched', {
        waypoints,
        hit: result.hit,
        targetId: result.targetId,
        impactPoint: result.impactPoint,
        launchAt
      });

      setTimeout(() => {
        const winner = result.hit ? endIfWinner(game) : null;

        if (result.hit) {
          gameNamespace.to(game.id).emit('player-eliminated', { playerId: result.targetId });
        }

        if (winner) {
          gameNamespace.to(game.id).emit('game-over', { winnerId: winner.id, game: getGame(game.id) });
          return;
        }

        const nextTurn = getNextTurn(game);
        gameNamespace.to(game.id).emit('your-turn', { playerId: nextTurn });
        gameNamespace.to(game.id).emit('game-state', { game: getGame(game.id) });
      }, Math.max(1600, waypoints.length * 45 + 650));

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
