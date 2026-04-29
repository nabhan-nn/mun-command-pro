import { db, formatTimestamp, aiClass, motionLabel } from './app.js';
import { ref, onValue, remove } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const secName = sessionStorage.getItem('mun_name');
const secRole = sessionStorage.getItem('mun_role_title');

window.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('mun_role') !== 'secretariat') {
    window.location.href = '/';
    return;
  }

  document.getElementById('sec-name-display').textContent = secName;
  document.getElementById('sec-role-display').textContent = secRole;

  // Listen to all rooms
  onValue(ref(db, 'rooms'), snap => {
    const rooms = snap.val() || {};
    renderOverview(rooms);
    renderAllChits(rooms);
    renderRooms(rooms);
  });
});

function renderOverview(rooms) {
  const roomKeys = Object.keys(rooms);
  let totalDelegates = 0;
  let totalChits = 0;
  let totalProfanity = 0;

  roomKeys.forEach(key => {
    const room = rooms[key];
    totalDelegates += Object.keys(room.delegates || {}).length;
    totalChits += Object.keys(room.chits || {}).length;
    totalProfanity += Object.keys(room.profanityAlerts || {}).length;
  });

  document.getElementById('stat-rooms').textContent = roomKeys.length;
  document.getElementById('stat-delegates').textContent = totalDelegates;
  document.getElementById('stat-chits').textContent = totalChits;
  document.getElementById('stat-profanity').textContent = totalProfanity;

  updateBadge('badge-sec-chits', totalChits);
  updateBadge('badge-profanity', totalProfanity);

  // Committee list
  const list = document.getElementById('sec-committees-list');
  if (!roomKeys.length) {
    list.innerHTML = '<div class="empty-state">No active rooms</div>';
    return;
  }
  list.innerHTML = roomKeys.map(key => {
    const room = rooms[key];
    const info = room.info || {};
    const dels = Object.keys(room.delegates || {}).length;
    const chits = Object.keys(room.chits || {}).length;
    return `
      <div class="list-row">
        <div>
          <div class="row-country">${info.committee || key}</div>
          <div class="row-detail">${dels} delegates · ${chits} chits</div>
        </div>
        <button class="btn-sm" onclick="closeRoomAdmin('${key}')">Close room</button>
      </div>
    `;
  }).join('');
}

function renderAllChits(rooms) {
  const list = document.getElementById('sec-all-chits');
  let allChits = [];
  Object.entries(rooms).forEach(([roomKey, room]) => {
    const info = room.info || {};
    Object.entries(room.chits || {}).forEach(([id, chit]) => {
      allChits.push({ id, roomKey, committee: info.committee || roomKey, ...chit });
    });
  });

  allChits.sort((a, b) => b.sentAt - a.sentAt);

  if (!allChits.length) {
    list.innerHTML = '<div class="empty-state">No chits yet</div>';
    return;
  }

  list.innerHTML = allChits.map(c => `
    <div class="chit-item">
      <div class="chit-header">
        <span class="chit-route"><strong>[${c.committee}]</strong> ${c.from} → ${c.to}</span>
        <span class="chit-time">${formatTimestamp(c.sentAt)}</span>
      </div>
      <div class="chit-body">${c.text}</div>
      <div class="chit-footer">
        <span class="ai-badge ${aiClass(c.aiScore)}">AI: ${c.aiScore}%</span>
      </div>
    </div>
  `).join('');
}

function renderRooms(rooms) {
  const list = document.getElementById('sec-rooms-list');
  const roomKeys = Object.keys(rooms);
  if (!roomKeys.length) {
    list.innerHTML = '<div class="empty-state">No active rooms</div>';
    return;
  }
  list.innerHTML = roomKeys.map(key => {
    const room = rooms[key];
    const info = room.info || {};
    return `
      <div class="list-row">
        <div>
          <div class="row-country">${info.committee || key}</div>
          <div class="row-detail">Chair: ${info.chairName || '—'}</div>
          <div class="row-detail">Room code: ${key}</div>
        </div>
        <button class="btn-sm" onclick="closeRoomAdmin('${key}')">Close room</button>
      </div>
    `;
  }).join('');
}

window.closeRoomAdmin = async function(roomKey) {
  if (!confirm('Close room ' + roomKey + '? This deletes all data.')) return;
  await remove(ref(db, 'rooms/' + roomKey));
}

function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('visible', count > 0);
}