const API_BASE = window.SE_API_URL || '';
const socket = io(`${API_BASE}/game`);
const pathParts = window.location.pathname.split('/').filter(Boolean);
const venueId = pathParts[1] || new URLSearchParams(window.location.search).get('venueId') || 'demo';
const tableNo = pathParts[3] || new URLSearchParams(window.location.search).get('tableNo') || '1';
const deepLinkedGameId = pathParts[5] || new URLSearchParams(window.location.search).get('gameId') || '';

let selectedGame = null;
let currentPlayer = null;

const els = {
  tableLabel: document.querySelector('#tableLabel'),
  connectionStatus: document.querySelector('#connectionStatus'),
  gamesList: document.querySelector('#gamesList'),
  refreshGames: document.querySelector('#refreshGames'),
  createForm: document.querySelector('#createForm'),
  joinPanel: document.querySelector('#joinPanel'),
  joinForm: document.querySelector('#joinForm'),
  selectedGameCode: document.querySelector('#selectedGameCode'),
  usernameInput: document.querySelector('#usernameInput'),
  avatarPreview: document.querySelector('#avatarPreview'),
  lobbyPanel: document.querySelector('#lobbyPanel'),
  lobbyGameCode: document.querySelector('#lobbyGameCode'),
  playersList: document.querySelector('#playersList'),
  startGameButton: document.querySelector('#startGameButton'),
  lobbyHint: document.querySelector('#lobbyHint'),
  toast: document.querySelector('#toast')
};

els.tableLabel.textContent = `${venueId} / table ${tableNo}`;
setAvatarPreview('Tank Pilot');

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function avatarUrl(username) {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(username || 'Tank Pilot')}`;
}

function setAvatarPreview(username) {
  els.avatarPreview.src = avatarUrl(username);
}

function requestGames() {
  socket.emit('request-games', { venueId, tableNo });
}

function renderGames(games) {
  if (!games.length) {
    els.gamesList.innerHTML = '<p class="empty">No active games. Create one with the host init panel.</p>';
    return;
  }

  els.gamesList.innerHTML = games
    .map(
      (game) => `
        <div class="game-row">
          <div>
            <strong>${game.id}</strong>
            <small>${game.playerCount}/${game.maxPlayers} players · ${game.status} · ${game.config.scenePreset}</small>
          </div>
          <button class="secondary" data-join="${game.id}">Join</button>
        </div>
      `
    )
    .join('');
}

function selectGame(gameId) {
  selectedGame = gameId;
  els.joinPanel.hidden = false;
  els.selectedGameCode.textContent = gameId;
  els.usernameInput.focus();
}

function renderPlayers(players = []) {
  els.playersList.innerHTML = players
    .map(
      (player) => `
        <div class="player-row">
          <img src="${player.avatarUrl}" alt="" />
          <div>
            <strong>${player.username}</strong>
            <small>${player.alive === false ? 'Eliminated' : `Tank ${player.tankIndex + 1}`}</small>
          </div>
          ${player.id === currentPlayer?.playerId ? '<small>You</small>' : ''}
        </div>
      `
    )
    .join('');
  els.lobbyHint.textContent = players.length >= 2 ? 'Ready when the host starts.' : 'Waiting for at least two players.';
}

function enterLobby(game, playerData) {
  currentPlayer = playerData || currentPlayer;
  selectedGame = game.id;
  els.lobbyPanel.hidden = false;
  els.lobbyGameCode.textContent = game.id;
  renderPlayers(game.players);
}

socket.on('connect', () => {
  els.connectionStatus.textContent = 'Online';
  requestGames();
});

socket.on('disconnect', () => {
  els.connectionStatus.textContent = 'Offline';
});

socket.on('games-list', ({ games }) => {
  renderGames(games || []);
  if (deepLinkedGameId && !selectedGame) {
    selectGame(deepLinkedGameId);
  }
});

socket.on('joined', ({ playerId, tankIndex, game }) => {
  const username = els.usernameInput.value.trim();
  const player = game.players.find((item) => item.id === playerId);
  const playerData = {
    playerId,
    tankIndex,
    gameId: game.id,
    username,
    avatarUrl: player?.avatarUrl || avatarUrl(username)
  };
  localStorage.setItem('se-player', JSON.stringify(playerData));
  enterLobby(game, playerData);
});

socket.on('player-joined', ({ players }) => {
  renderPlayers(players || []);
});

socket.on('game-state', ({ game }) => {
  if (game?.id === selectedGame && currentPlayer) {
    enterLobby(game, currentPlayer);
  }
});

socket.on('game-started', ({ game }) => {
  const stored = JSON.parse(localStorage.getItem('se-player') || '{}');
  const playerId = currentPlayer?.playerId || stored.playerId;
  if (!playerId || game.id !== selectedGame) return;
  window.location.href = `/ar/game.html?gameId=${encodeURIComponent(game.id)}&playerId=${encodeURIComponent(playerId)}`;
});

socket.on('error-message', ({ error }) => toast(error));

els.refreshGames.addEventListener('click', requestGames);

els.gamesList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-join]');
  if (button) selectGame(button.dataset.join);
});

els.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(els.createForm);
  const body = {
    fieldSize: form.get('fieldSize'),
    scenePreset: form.get('scenePreset'),
    maxPlayers: Number(form.get('maxPlayers')),
    bombMode: form.get('bombMode')
  };

  const response = await fetch(`${API_BASE}/api/venue/${encodeURIComponent(venueId)}/table/${encodeURIComponent(tableNo)}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    toast(data.error || 'Could not create game');
    return;
  }
  requestGames();
  selectGame(data.gameId);
});

els.usernameInput.addEventListener('input', () => setAvatarPreview(els.usernameInput.value));

els.joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!selectedGame) return toast('Choose a game first');
  socket.emit('join-game', {
    gameId: selectedGame,
    username: els.usernameInput.value.trim()
  });
});

els.startGameButton.addEventListener('click', () => {
  if (!selectedGame) return;
  socket.emit('start-game', { gameId: selectedGame }, (reply) => {
    if (!reply?.ok) toast(reply?.error || 'Could not start game');
  });
});
