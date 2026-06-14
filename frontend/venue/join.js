const API_BASE = window.API_URL || window.VITE_API_URL || window.SE_API_URL || '';
const socket = io(`${API_BASE}/game`);

const parts = window.location.pathname.split('/').filter(Boolean);
const venueId = parts[1] || new URLSearchParams(window.location.search).get('venueId') || 'demo';
const tableNo = parts[3] || new URLSearchParams(window.location.search).get('tableNo') || '1';
const deepLinkedGameId = parts[5] || new URLSearchParams(window.location.search).get('gameId') || '';

let selectedGameId = null;
let myPlayerId = null;
let amHost = false;

const stored = JSON.parse(localStorage.getItem('se-player') || 'null');

const $ = (id) => document.getElementById(id);
const usernameInput = $('usernameInput');

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
}

function avatarUrl(name) {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(name || 'Pilot')}`;
}

function updateAvatar() {
  $('avatarPreview').src = avatarUrl(usernameInput.value.trim() || 'Pilot');
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3000);
}

// ── Rejoin card ───────────────────────────────────────────────────────────────
if (stored?.gameId && stored?.playerId) {
  $('rejoinAvatar').src = stored.avatarUrl || avatarUrl(stored.username);
  $('rejoinName').textContent = stored.username || 'Pilot';
  $('rejoinGameLabel').textContent = `Game ${stored.gameId}`;
  $('rejoinCard').hidden = false;
}

if (deepLinkedGameId) $('gameCodeInput').value = deepLinkedGameId;

// ── Connection ────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  const el = $('connStatus');
  el.textContent = '● Online';
  el.classList.add('online');
  socket.emit('request-games', { venueId, tableNo });
});

socket.on('disconnect', () => {
  const el = $('connStatus');
  el.textContent = '○ Offline';
  el.classList.remove('online');
});

// ── Lobby helpers ─────────────────────────────────────────────────────────────
function renderPlayers(players) {
  $('playersList').innerHTML = players.map((p, i) => `
    <div class="player-row">
      <img src="${p.avatarUrl}" alt="" />
      <div>
        <strong>${p.username}${p.id === myPlayerId ? ' (you)' : ''}${i === 0 ? ' 👑' : ''}</strong>
        <small>${p.alive === false ? 'Eliminated' : `Slot ${i + 1}`}</small>
      </div>
    </div>
  `).join('') || '<p class="hint">Waiting for players…</p>';
}

function enterLobby(game) {
  selectedGameId = game.id;
  $('lobbyCode').textContent = game.id;
  renderPlayers(game.players);
  $('startBtn').hidden = !amHost;
  $('lobbyHint').textContent = amHost
    ? `${game.players.length} / ${game.config.maxPlayers} players joined`
    : 'Waiting for host to start…';
  showScreen('screenLobby');
}

// ── Screen navigation ─────────────────────────────────────────────────────────
$('hostBtn').addEventListener('click', () => {
  if (!usernameInput.value.trim()) { usernameInput.focus(); return toast('Enter your callsign first'); }
  amHost = true;
  showScreen('screenHost');
});

$('joinBtn').addEventListener('click', () => {
  if (!usernameInput.value.trim()) { usernameInput.focus(); return toast('Enter your callsign first'); }
  amHost = false;
  showScreen('screenJoin');
  if (deepLinkedGameId) $('gameCodeInput').focus();
});

$('backFromHost').addEventListener('click', () => { amHost = false; showScreen('screenStart'); });
$('backFromJoin').addEventListener('click', () => showScreen('screenStart'));

$('leaveBtn').addEventListener('click', () => {
  selectedGameId = null;
  myPlayerId = null;
  amHost = false;
  localStorage.removeItem('se-player');
  showScreen('screenStart');
});

// ── Rejoin ────────────────────────────────────────────────────────────────────
$('rejoinBtn').addEventListener('click', () => {
  if (!stored?.gameId || !stored?.playerId) return;
  socket.emit('rejoin-game', { gameId: stored.gameId, playerId: stored.playerId }, (reply) => {
    if (!reply?.ok) {
      localStorage.removeItem('se-player');
      $('rejoinCard').hidden = true;
      return toast('Game no longer available');
    }
    myPlayerId = stored.playerId;
    amHost = reply.game.players[0]?.id === stored.playerId;
    enterLobby(reply.game);
  });
});

// ── Create game (host) ────────────────────────────────────────────────────────
$('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const fd = new FormData(e.target);
    const res = await fetch(
      `${API_BASE}/api/venue/${encodeURIComponent(venueId)}/table/${encodeURIComponent(tableNo)}/games`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldSize:   fd.get('fieldSize')   || 'medium',
          scenePreset: fd.get('scenePreset') || 'classic-grid',
          maxPlayers:  Number(fd.get('maxPlayers') || 6),
          bombMode:    fd.get('bombMode')    || 'normal',
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Could not create game');
    // Auto-join as host immediately after creation
    socket.emit('join-game', { gameId: data.gameId, username: usernameInput.value.trim() });
  } catch {
    toast('Network error — check connection');
  } finally {
    btn.disabled = false;
  }
});

// ── Join by code ──────────────────────────────────────────────────────────────
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('gameCodeInput').value.trim();
  if (!code) return toast('Enter a game code');
  socket.emit('join-game', { gameId: code, username: usernameInput.value.trim() });
});

// ── Start game ────────────────────────────────────────────────────────────────
$('startBtn').addEventListener('click', () => {
  socket.emit('start-game', { gameId: selectedGameId }, (reply) => {
    if (!reply?.ok) toast(reply?.error || 'Could not start game');
  });
});

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('joined', ({ playerId, game }) => {
  myPlayerId = playerId;
  const player = game.players.find(p => p.id === playerId);
  localStorage.setItem('se-player', JSON.stringify({
    playerId,
    gameId: game.id,
    username: usernameInput.value.trim(),
    avatarUrl: player?.avatarUrl || avatarUrl(usernameInput.value.trim()),
  }));
  enterLobby(game);
});

socket.on('player-joined', ({ players }) => {
  if (!selectedGameId) return;
  renderPlayers(players);
  const count = players.length;
  if (amHost) $('lobbyHint').textContent = `${count} player${count === 1 ? '' : 's'} joined`;
});

socket.on('game-state', ({ game }) => {
  if (game?.id === selectedGameId && myPlayerId) renderPlayers(game.players);
});

socket.on('game-started', ({ game }) => {
  if (game.id !== selectedGameId || !myPlayerId) return;
  window.location.href = `/ar/game.html?gameId=${encodeURIComponent(game.id)}&playerId=${encodeURIComponent(myPlayerId)}`;
});

socket.on('error-message', ({ error }) => toast(error));

// ── Avatar live preview ───────────────────────────────────────────────────────
usernameInput.addEventListener('input', updateAvatar);
$('tableLabel').textContent = `${venueId} / table ${tableNo}`;
updateAvatar();
