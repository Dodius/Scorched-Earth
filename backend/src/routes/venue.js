import express from 'express';
import { clearTableGames, createGame, getGames } from '../game/room-manager.js';

export const venueRouter = express.Router();

venueRouter.get('/venue/:venueId/table/:tableNo/games', (req, res) => {
  const { venueId, tableNo } = req.params;
  res.json({ games: getGames(venueId, tableNo) });
});

venueRouter.post('/venue/:venueId/table/:tableNo/games', (req, res) => {
  const { venueId, tableNo } = req.params;
  const game = createGame(venueId, tableNo, req.body || {});
  res.status(201).json({ gameId: game.id, game });
});

venueRouter.delete('/venue/:venueId/table/:tableNo/games', (req, res) => {
  const { venueId, tableNo } = req.params;
  const removed = clearTableGames(venueId, tableNo);
  res.json({ removed });
});
