import express from 'express';
import { getGame, resetGame, startGame } from '../game/room-manager.js';

export const gamesRouter = express.Router();

gamesRouter.get('/games/:gameId', (req, res) => {
  const game = getGame(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  return res.json({ game });
});

gamesRouter.post('/games/:gameId/start', (req, res) => {
  try {
    const game = startGame(req.params.gameId);
    return res.json({ game });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

gamesRouter.post('/games/:gameId/reset', (req, res) => {
  try {
    const game = resetGame(req.params.gameId);
    return res.json({ game });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
