import { SESSION, formatTimestamp, aiScoreBadge,
         initTabs, api } from './app.js';

// ── INITIALISE ──
document.addEventListener('DOMContentLoaded', async () => {

  // Guard — if not logged in as secretariat, go back to login
  if (SESSION.role !== 'secretariat') {
    window.location.href = '/';
    return;
  }

  // Fill in sidebar info
  document.getElementById('sec-name-display').textContent = SESSION.name;
  document.getElementById('sec-role-display').textContent = SESSION.roleTitle;

  // Set up tab switching
  initTabs();

  // Start polling — secretariat polls all rooms every 3 seconds
  // Slightly slower than chair/delegate since it's an overview
  loadAllRooms();
  setInterval(loadAllRooms, 3000);
});

// ── LOAD ALL ROOMS ──
// This is the secretariat's version of poll.
// Instead of one room, it fetches every room at once.
async function loadAllRooms() {
  try {
    const rooms = await api('/api/secretariat/all-rooms');
    if (!Array.isArray(rooms)) return;

    updateStats(rooms);
    updateOverview(rooms);
    updateChitMonitor(rooms);
    updateRoomControls(rooms);

  } catch (err) {
    console.error('Secretariat poll failed:', err);
  }
}

// ── STATS ROW ──
function updateStats(rooms) {
  const totalDelegates = rooms.reduce((sum, r) => sum + r.delegate_count, 0);
  const totalChits = rooms.reduce((sum, r) => sum + r.chit_count, 0);
  const totalMarked = rooms.reduce((sum, r) => sum + r.marked_count, 0);

  document.getElementById('stat-rooms').textContent = rooms.length;
  document.getElementById('stat-delegates').textContent = totalDelegates;
  document.getElementById('stat-chits').textContent = totalChits;
  document.getElementById('stat-marked').textContent = totalMarked;
}

// reduce() works like a running total.
// It goes through every room and adds that room's count
// to the running sum, starting from 0.

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
          ${r.delegate_count} delegates ·
          ${r.chit_count} chits ·
          ${r.marked_count} marked
        </div>
        <div style="margin-top:4px">
          <span style="
            display:inline-block;
            font-size:10px;
            font-weight:600;
            padding:2px 8px;
            border-radius:10px;
            background:${r.is_open ? '#E1F5EE' : '#FAEEDA'};
            color:${r.is_open ? '#085041' : '#633806'}
          ">
            ${r.is_open ? 'Open' : 'Closed'}
          </span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <button class="btn-sm"
          onclick="toggleRoomFromSec('${r.id}', ${!r.is_open})">
          ${r.is_open ? 'Close room' : 'Open room'}
        </button>
        <button class="btn-sm reject"
          onclick="deleteMarkedForRoom('${r.id}', '${r.committee}')">
          Delete marked
        </button>
      </div>
    </div>
  `).join('');
}

// The open/closed badge uses inline styles here rather than
// CSS classes because the colour depends on a value from the
// database — we can't write a static CSS class for that.
// Inline styles are fine for dynamic one-off cases like this.

// ── CHIT MONITOR TAB ──
// Shows all chits from every committee in one live feed
async function updateChitMonitor(rooms) {
  const list = document.getElementById('all-chits-monitor');

  // We need to fetch chits from all rooms.
  // We do this by calling poll on each room separately
  // and combining the results.
  const allChitPromises = rooms.map(r =>
    api(`/api/poll/${r.id}?since=0`).then(data => {
      // Tag each chit with its committee name
      return (data.chits || []).map(c => ({
        ...c,
        committee: r.committee
      }));
    }).catch(() => [])
  );

  // Wait for all polls to finish simultaneously
  const chitArrays = await Promise.all(allChitPromises);

  // Flatten the array of arrays into one array
  const allChits = chitArrays.flat()
    .sort((a, b) => b.sent_at - a.sent_at); // newest first

  if (!allChits.length) {
    list.innerHTML = '<div class="empty-msg">No chits yet</div>';
    return;
  }

  list.innerHTML = allChits.map(c => `
    <div class="chit-item ${c.is_marked ? 'marked' : ''}">
      <div class="chit-header">
        <span class="chit-route">
          <strong>[${c.committee}]</strong>
          <strong>${c.from_country}</strong> → <strong>${c.to_country}</strong>
        </span>
        <span class="chit-time">${formatTimestamp(c.sent_at)}</span>
      </div>
      <div class="chit-body">${c.text}</div>
      <div class="chit-footer">
        ${aiScoreBadge(c.ai_score)}
        ${c.is_marked ? '<span style="font-size:10px;color:#888">Marked</span>' : ''}
      </div>
    </div>
  `).join('');
}

// Promise.all runs multiple async operations simultaneously
// instead of one after another. If you have 25 committees,
// it fires all 25 poll requests at the same time and waits
// for all of them to finish — much faster than doing them
// one by one.

// .flat() takes [[chit1, chit2], [chit3], [chit4, chit5]]
// and returns [chit1, chit2, chit3, chit4, chit5].

// ── ROOM CONTROLS TAB ──
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
        <div class="row-sub">
          Room ID: ${r.id} ·
          Chair: ${r.chair_name || '—'}
        </div>
        <div class="row-sub">
          ${r.delegate_count} delegates connected
        </div>
      </div>
      <div class="row-actions">
        <button class="btn-sm ${r.is_open ? 'reject' : 'accept'}"
          onclick="toggleRoomFromSec('${r.id}', ${!r.is_open})">
          ${r.is_open ? 'Close' : 'Open'}
        </button>
        <button class="btn-sm reject"
          onclick="deleteMarkedForRoom('${r.id}', '${r.committee}')">
          Delete marked
        </button>
      </div>
    </div>
  `).join('');
}

// ── TOGGLE ROOM ──
window.toggleRoomFromSec = async function(roomId, isOpen) {
  await api('/api/room/toggle', {
    room_id: roomId,
    is_open: isOpen
  });
  // Refresh immediately instead of waiting for next poll
  await loadAllRooms();
}

// ── DELETE MARKED CHITS FOR ONE COMMITTEE ──
window.deleteMarkedForRoom = async function(roomId, committeeName) {
  const confirmed = confirm(
    `Delete all marked chits for ${committeeName}? This cannot be undone.`
  );
  if (!confirmed) return;

  await api('/api/secretariat/delete-marked', { room_id: roomId });
  await loadAllRooms();
}

// ── CONFERENCE OVER ──
window.confirmConferenceOver = function() {
  // Two-step confirmation because this is irreversible
  const first = confirm(
    'Are you sure you want to end the conference?\n\n' +
    'This will permanently delete ALL data from ALL committees — ' +
    'every chit, motion, amendment, document and delegate record.'
  );
  if (!first) return;

  const second = confirm(
    'FINAL WARNING: This cannot be undone.\n\n' +
    'Type OK in the next prompt to confirm.'
  );
  if (!second) return;

  const typed = prompt('Type CONFIRM to proceed:');
  if (typed !== 'CONFIRM') {
    alert('Conference Over cancelled — you did not type CONFIRM');
    return;
  }

  endConference();
}

async function endConference() {
  try {
    await api('/api/secretariat/conference-over', {});
    alert('Conference ended. All data has been deleted.');
    // Clear session and go back to login
    sessionStorage.clear();
    window.location.href = '/';
  } catch (e) {
    alert('Error ending conference: ' + e.message);
  }
}

// Three-step confirmation for conference over:
// 1. First confirm() — "are you sure?"
// 2. Second confirm() — "final warning"
// 3. prompt() — must type CONFIRM exactly
// This prevents accidental clicks from wiping everything.