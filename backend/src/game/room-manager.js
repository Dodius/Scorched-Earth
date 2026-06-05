import { nanoid } from 'nanoid';
import { getTankPositions } from './game-engine.js';

const games = new Map();

const DEFAULT_CONFIG = {
  fieldSize: 'medium',
  scenePreset: 'classic-grid',
  maxPlayers: 6,
  bombMode: 'normal'
};

function normalizeConfig(config = {}) {
  const maxPlayers = Math.min(6, Math.max(2, Number(config.maxPlayers || DEFAULT_CONFIG.maxPlayers)));

  return {
    fieldSize: ['small', 'medium', 'large'].includes(config.fieldSize) ? config.fieldSize : DEFAULT_CONFIG.fieldSize,
    scenePreset: ['classic-grid', 'pub-table', 'crater-field'].includes(config.scenePreset)
      ? config.scenePreset
      : DEFAULT_CONFIG.scenePreset,
    maxPlayers,
    bombMode: ['normal', 'leap-frog'].includes(config.bombMode) ? config.bombMode : DEFAULT_CONFIG.bombMode
  };
}

function publicGame(game) {
  return {
    id: game.id,
    venueId: game.venueId,
    tableNo: game.tableNo,
    config: game.config,
    players: game.players,
    playerCount: game.players.length,
    maxPlayers: game.config.maxPlayers,
    status: game.status,
    currentTurn: game.currentTurn,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
    winnerId: game.winnerId
  };
}

function assignPositions(game) {
  game.players = getTankPositions(game.players);
  game.players.forEach((player) => {
    if (game.status === 'lobby' || player.azimuth == null) {
      player.azimuth = ((Math.atan2(-player.position.x, player.position.z) * 180) / Math.PI + 360) % 360;
    }
  });
}

export function createGame(venueId, tableNo, config = {}) {
  const id = nanoid(6).replace(/[-_]/g, 'x');
  const game = {
    id,
    venueId,
    tableNo,
    config: normalizeConfig(config),
    players: [],
    status: 'lobby',
    currentTurn: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    winnerId: null
  };

  games.set(id, game);
  return publicGame(game);
}

export function getGame(gameId) {
  const game = games.get(gameId);
  return game ? publicGame(game) : null;
}

export function getMutableGame(gameId) {
  return games.get(gameId) || null;
}

export function getGames(venueId, tableNo) {
  return [...games.values()]
    .filter((game) => game.venueId === venueId && game.tableNo === tableNo && game.status !== 'ended')
    .map(publicGame);
}

export function endGame(gameId) {
  const game = games.get(gameId);
  if (!game) throw new Error('Game not found');

  game.status = 'ended';
  game.endedAt = new Date().toISOString();
  game.currentTurn = null;

  return publicGame(game);
}

export function clearTableGames(venueId, tableNo) {
  const removed = [];

  for (const [gameId, game] of games.entries()) {
    if (game.venueId === venueId && game.tableNo === tableNo) {
      removed.push(gameId);
      games.delete(gameId);
    }
  }

  return removed;
}

export function joinGame(gameId, player) {
  const game = games.get(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'lobby') throw new Error('Game already started');
  if (game.players.length >= game.config.maxPlayers) throw new Error('Game is full');

  const existing = game.players.find((item) => item.username.toLowerCase() === player.username.toLowerCase());
  if (existing) {
    return {
      game: publicGame(game),
      playerId: existing.id,
      tankIndex: game.players.findIndex((item) => item.id === existing.id)
    };
  }

  const id = nanoid(10);
  const avatarUrl = `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(player.username)}`;
  const newPlayer = {
    id,
    username: player.username,
    avatarUrl,
    alive: true,
    azimuth: 0,
    tankIndex: game.players.length
  };

  game.players.push(newPlayer);
  assignPositions(game);

  return {
    game: publicGame(game),
    playerId: id,
    tankIndex: newPlayer.tankIndex
  };
}

export function rejoinGame(gameId, playerId) {
  const game = games.get(gameId);
  if (!game) throw new Error('Game not found');
  const player = game.players.find((item) => item.id === playerId);
  if (!player) throw new Error('Player not found');

  return publicGame(game);
}

export function startGame(gameId) {
  const game = games.get(gameId);
  if (!game) throw new Error('Game not found');
  if (game.players.length < 2) throw new Error('At least 2 players required');

  game.status = 'playing';
  game.startedAt = game.startedAt || new Date().toISOString();
  game.players.forEach((player) => {
    player.alive = true;
  });
  assignPositions(game);
  game.currentTurn = game.players[0].id;

  return publicGame(game);
}

export function resetGame(gameId) {
  const game = games.get(gameId);
  if (!game) throw new Error('Game not found');

  game.status = 'lobby';
  game.currentTurn = null;
  game.startedAt = null;
  game.endedAt = null;
  game.winnerId = null;
  game.players.forEach((player) => {
    player.alive = true;
    player.azimuth = 0;
  });
  assignPositions(game);

  return publicGame(game);
}

export function setTankAzimuth(gameId, playerId, azimuth) {
  const game = games.get(gameId);
  if (!game) throw new Error('Game not found');
  const player = game.players.find((item) => item.id === playerId);
  if (!player) throw new Error('Player not found');
  player.azimuth = ((Number(azimuth) % 360) + 360) % 360;
  return publicGame(game);
}

export function eliminatePlayer(game, playerId) {
  const player = game.players.find((item) => item.id === playerId);
  if (player) {
    player.alive = false;
  }
}

export function getNextTurn(game) {
  const living = game.players.filter((player) => player.alive !== false);
  if (living.length <= 1) return null;
  const currentIndex = game.players.findIndex((player) => player.id === game.currentTurn);

  for (let offset = 1; offset <= game.players.length; offset += 1) {
    const candidate = game.players[(currentIndex + offset) % game.players.length];
    if (candidate.alive !== false) {
      game.currentTurn = candidate.id;
      return candidate.id;
    }
  }

  return null;
}

export function endIfWinner(game) {
  const living = game.players.filter((player) => player.alive !== false);
  if (living.length === 1) {
    game.status = 'ended';
    game.endedAt = new Date().toISOString();
    game.winnerId = living[0].id;
    game.currentTurn = null;
    return living[0];
  }

  return null;
}
