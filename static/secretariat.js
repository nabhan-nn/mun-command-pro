import { SESSION, formatTimestamp, aiScoreBadge,
         initTabs, api } from './app.js';

// ── INITIALISE ──
document.addEventListener('DOMContentLoaded', async () => {

  if (SESSION.role !== 'secretariat') {
    window.location.href = '/';
    return;
  }

  document.getElementById('sec-name-display').textContent = SESSION.name;
  document.getElementById('sec-role-display').textContent = SESSION.roleTitle;

  initTabs();
  loadAllRooms();
  setInterval(loadAllRooms, 3000);
});

// ── LOAD ALL ROOMS ──
async function loadAllRooms() {
  try {
    const rooms = await api('/api/secretariat/all-rooms');
    if (!Array.isArray(rooms)) return;
    updateStats(rooms);
    updateOverview(rooms);
    await updateChitMonitor(rooms);
    updateRoomControls(rooms);
  } catch (err) {
    console.error('Secretariat poll failed:', err);
  }
}

// ── STATS ──
function updateStats(rooms) {
  const totalDelegates = rooms.reduce((sum, r) => sum + r.delegate_count, 0);
  const totalChits = rooms.reduce((sum, r) => sum + r.chit_count, 0);

  document.getElementById('stat-rooms').textContent = rooms.length;
  document.getElementById('stat-delegates').textContent = totalDelegates;
  document.getElementById('stat-chits').textContent = totalChits;
  // stat-marked shows open vs closed rooms
  const openRooms = rooms.filter(r => r.is_open).length;
  document.getElementById('stat-marked').textContent = openRooms;
}

// ── OVERVIEW TAB ──
function updateOverview(rooms) {
  const list = document.getElementById('committees-overview');

  if (!rooms.length) {
    list.innerHTML = '<div class="empty-msg">No active rooms</div>';
    return;
  }

  list.innerHTML = rooms.map(r => `
    <div class="list-row">
      <div style="flex:1">
        <div class="row-main">${r.committee}</div>
        <div class="row-sub">
          ${r.delegate_count} delegates · ${r.chit_count} chits
        </div>
        <div style="margin-top:4px">
          <span style="
            display:inline-block;font-size:10px;font-weight:600;
            padding:2px 8px;border-radius:10px;
            background:${r.is_open ? '#E1F5EE' : '#FAEEDA'};
            color:${r.is_open ? '#085041' : '#633806'}
          ">${r.is_open ? 'Open' : 'Closed'}</span>
        </div>
      </div>
      <button class="btn-sm ${r.is_open ? 'reject' : 'accept'}"
        onclick="toggleRoomFromSec('${r.id}', ${!r.is_open})">
        ${r.is_open ? 'Close room' : 'Open room'}
      </button>
    </div>
  `).join('');
}

// ── CHIT MONITOR ──
async function updateChitMonitor(rooms) {
  const list = document.getElementById('all-chits-monitor');

  const allChitPromises = rooms.map(r =>
    api(`/api/poll/${r.id}?since=0`).then(data =>
      (data.chits || []).map(c => ({ ...c, committee: r.committee }))
    ).catch(() => [])
  );

  const chitArrays = await Promise.all(allChitPromises);
  const allChits = chitArrays.flat().sort((a, b) => b.sent_at - a.sent_at);

  if (!allChits.length) {
    list.innerHTML = '<div class="empty-msg">No chits yet</div>';
    return;
  }

  list.innerHTML = allChits.map(c => `
    <div class="chit-item">
      <div class="chit-header">
        <span class="chit-route">
          <strong>[${c.committee}]</strong>
          <strong>${c.from_country}</strong> → <strong>${c.to_country}</strong>
        </span>
        <span class="chit-time">${formatTimestamp(c.sent_at)}</span>
      </div>
      <div class="chit-body">${c.text}</div>
      <div class="chit-footer">${aiScoreBadge(c.ai_score)}</div>
    </div>
  `).join('');
}

// ── ROOM CONTROLS ──
function updateRoomControls(rooms) {
  const list = document.getElementById('rooms-control');

  if (!rooms.length) {
    list.innerHTML = '<div class="empty-msg">No active rooms</div>';
    return;
  }

  list.innerHTML = rooms.map(r => `
    <div class="list-row">
      <div>
        <div class="row-main">${r.committee}</div>
        <div class="row-sub">Room ID: ${r.id} · Chair: ${r.chair_name || '—'}</div>
        <div class="row-sub">${r.delegate_count} delegates connected</div>
      </div>
      <button class="btn-sm ${r.is_open ? 'reject' : 'accept'}"
        onclick="toggleRoomFromSec('${r.id}', ${!r.is_open})">
        ${r.is_open ? 'Close' : 'Open'}
      </button>
    </div>
  `).join('');
}

// ── TOGGLE ROOM ──
window.toggleRoomFromSec = async function(roomId, isOpen) {
  await api('/api/room/toggle', { room_id: roomId, is_open: isOpen });
  await loadAllRooms();
}

// ── CONFERENCE OVER (SEC-0001 only) ──
window.confirmConferenceOver = function() {
  if (SESSION.code !== 'SEC-0001') {
    alert('Only the Secretary General (SEC-0001) can end the conference.');
    return;
  }

  const first = confirm(
    'Are you sure you want to end the conference?\n\n' +
    'This permanently deletes ALL data from ALL committees.'
  );
  if (!first) return;

  const typed = prompt('Type CONFIRM to proceed:');
  if (typed !== 'CONFIRM') {
    alert('Cancelled — you did not type CONFIRM');
    return;
  }

  endConference();
}

async function endConference() {
  try {
    await api('/api/secretariat/conference-over', {});
    alert('Conference ended. All data has been deleted.');
    sessionStorage.clear();
    window.location.href = '/';
  } catch (e) {
    alert('Error ending conference: ' + e.message);
  }
}