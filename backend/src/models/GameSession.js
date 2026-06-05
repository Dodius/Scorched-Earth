import mongoose from 'mongoose';

const GameSessionSchema = new mongoose.Schema(
  {
    gameId: { type: String, required: true, index: true },
    venueId: { type: String, required: true, index: true },
    tableNo: { type: String, required: true, index: true },
    status: { type: String, default: 'lobby' },
    config: { type: Object, default: {} },
    players: { type: Array, default: [] },
    winnerId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const GameSession = mongoose.model('GameSession', GameSessionSchema);
