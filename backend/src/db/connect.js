import mongoose from 'mongoose';

export async function connectMongo() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.warn('[db] MONGO_URI not set; running with in-memory game state only');
    return false;
  }

  try {
    await mongoose.connect(uri);
    console.log('[db] MongoDB connected');
    return true;
  } catch (error) {
    console.error('[db] MongoDB connection failed:', error.message);
    return false;
  }
}
