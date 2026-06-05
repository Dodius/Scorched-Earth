const API_BASE = window.API_URL || window.VITE_API_URL || window.SE_API_URL || '';
const socket = io(`${API_BASE}/game`);
const status = document.querySelector('#status');
const form = document.querySelector('#adminForm');
const gameIdInput = document.querySelector('#gameIdInput');
const startButton = document.querySelector('#startButton');
const output = document.querySelector('#gameOutput');

let currentGameId = '';

socket.on('connect', () => {
  status.textContent = 'Online';
});

socket.on('disconnect', () => {
  status.textContent = 'Offline';
});

socket.on('game-state', ({ game }) => {
  if (game?.id === currentGameId) output.textContent = JSON.stringify(game, null, 2);
});

socket.on('game-started', ({ game }) => {
  if (game?.id === currentGameId) output.textContent = JSON.stringify(game, null, 2);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  currentGameId = gameIdInput.value.trim();
  const response = await fetch(`${API_BASE}/api/games/${encodeURIComponent(currentGameId)}`);
  const data = await response.json();
  output.textContent = JSON.stringify(data.game || data, null, 2);
});

startButton.addEventListener('click', () => {
  currentGameId = gameIdInput.value.trim();
  if (!currentGameId) return;
  socket.emit('start-game', { gameId: currentGameId }, (reply) => {
    output.textContent = JSON.stringify(reply, null, 2);
  });
});
