import { SESSION, formatTime, formatTimestamp, motionLabel,
         aiScoreBadge, updateNavCount,
         openModal, closeModal, initTabs,
         updateClosedBanner, disableSubmitButtons, api } from './app.js';

// ── STATE ──
let timerInterval = null;
let timerSeconds = 90;
let allDelegates = [];
let speakersList = [];
let lastTimestamp = 0;
let allChits = [];

// ── INITIALISE ──
document.addEventListener('DOMContentLoaded', async () => {

  if (!SESSION.roomId || SESSION.role !== 'chair') {
    window.location.href = '/';
    return;
  }

  document.getElementById('room-code-display').textContent = SESSION.roomId;
  document.getElementById('chair-name-display').textContent = SESSION.name;
  document.getElementById('committee-display').textContent = SESSION.committee;
  document.getElementById('timer-display').textContent = formatTime(timerSeconds);

  initTabs();
  await loadDelegatesForDropdown();
  startPolling();

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) {
      document.getElementById('speaker-dropdown').classList.remove('open');
    }
  });
});

// ── POLLING ──
function startPolling() {
  poll();
  setInterval(poll, 2000);
}

async function poll() {
  try {
    const data = await api(`/api/poll/${SESSION.roomId}?since=${lastTimestamp}`);
    if (!data.room) return;

    const isOpen = data.room.is_open;
    updateClosedBanner(isOpen, 'closed-banner');
    disableSubmitButtons(isOpen);

    const toggle = document.getElementById('room-toggle-input');
    if (toggle && toggle.checked !== isOpen) toggle.checked = isOpen;
    document.getElementById('room-status-label').textContent =
      isOpen ? 'Room open' : 'Room closed';

    // Update current speaker display
    const speakerEl = document.getElementById('current-speaker-name');
    if (speakerEl) {
      speakerEl.textContent = data.room.current_speaker || 'No speaker';
    }

    // Update speakers queue
    renderSpeakers(data.speakers);

    updateMotions(data.motions);
    updateAmendments(data.amendments);
    updateDocuments(data.documents);
    updateDelegates(data.delegates);
    updatePoints(data.points);

    // Deduplicate chits using id
    if (data.chits.length > 0) {
      const existingIds = new Set(allChits.map(c => c.id));
      const newChits = data.chits.filter(c => !existingIds.has(c.id));
      if (newChits.length > 0) {
        allChits = [...allChits, ...newChits];
        renderChits();
      }
    }

    lastTimestamp = data.timestamp;

  } catch (err) {
    console.error('Poll failed:', err);
  }
}

// ── DELEGATES DROPDOWN ──
async function loadDelegatesForDropdown() {
  try {
    const data = await api(`/api/delegates/${encodeURIComponent(SESSION.committee)}`);
    allDelegates = data.delegates || [];
    renderDropdown(allDelegates);
  } catch (e) {
    console.error('Could not load delegates:', e);
  }
}

function renderDropdown(delegates) {
  const list = document.getElementById('speaker-dropdown');
  if (!delegates.length) {
    list.innerHTML = '<div class="dropdown-item" style="color:#aaa">No matches</div>';
    return;
  }
  list.innerHTML = delegates.map(d => `
    <div class="dropdown-item" onclick="addSpeakerFromDropdown('${d.country}')">
      ${d.country}
    </div>
  `).join('');
}

window.filterSpeakerSearch = function() {
  const query = document.getElementById('speaker-search').value.toLowerCase();
  const filtered = allDelegates.filter(d =>
    d.country.toLowerCase().includes(query)
  );
  renderDropdown(filtered);
  document.getElementById('speaker-dropdown').classList.add('open');
}

window.showDropdown = function() {
  renderDropdown(allDelegates);
  document.getElementById('speaker-dropdown').classList.add('open');
}

window.addSpeakerFromDropdown = async function(country) {
  document.getElementById('speaker-search').value = '';
  document.getElementById('speaker-dropdown').classList.remove('open');
  await api('/api/speaker/add', {
    room_id: SESSION.roomId,
    country: country
  });
}

// ── SPEAKERS ──
function renderSpeakers(speakers) {
  speakersList = speakers || [];
  const list = document.getElementById('speakers-queue');

  if (!speakersList.length) {
    list.innerHTML = '<div class="empty-msg">No speakers queued</div>';
    return;
  }

  list.innerHTML = speakersList.map((s, i) => `
    <div class="list-row">
      <div>
        <span style="font-size:10px;color:#aaa;margin-right:6px">${i + 1}.</span>
        <span class="row-main" style="display:inline">${s.country}</span>
      </div>
      <button class="btn-sm" onclick="removeSpeaker(${s.id})">✕</button>
    </div>
  `).join('');
}

window.removeSpeaker = async function(id) {
  await api('/api/speaker/remove', { speaker_id: id });
}

window.nextSpeaker = async function() {
  if (!speakersList.length) return;
  const next = speakersList[0];
  await api('/api/room/set-speaker', {
    room_id: SESSION.roomId,
    speaker: next.country
  });
  await api('/api/speaker/remove', { speaker_id: next.id });
  resetTimer();
}

// ── TIMER ──
window.startTimer = function() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(async () => {
    timerSeconds--;
    const el = document.getElementById('timer-display');
    el.textContent = formatTime(timerSeconds);
    el.className = 'timer-display';
    if (timerSeconds <= 15) el.classList.add('warning');
    if (timerSeconds <= 5)  el.classList.add('danger');
    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    await api('/api/room/set-timer', {
      room_id: SESSION.roomId,
      timer: timerSeconds
    });
  }, 1000);
}

window.pauseTimer = function() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

window.resetTimer = function() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerSeconds = parseInt(document.getElementById('speaker-time').value) || 90;
  const el = document.getElementById('timer-display');
  el.textContent = formatTime(timerSeconds);
  el.className = 'timer-display';
  api('/api/room/set-timer', {
    room_id: SESSION.roomId,
    timer: timerSeconds
  });
}

// ── ROOM TOGGLE ──
window.toggleRoom = async function(isOpen) {
  await api('/api/room/toggle', {
    room_id: SESSION.roomId,
    is_open: isOpen
  });
  document.getElementById('room-status-label').textContent =
    isOpen ? 'Room open' : 'Room closed';
}

// ── MOTIONS ──
window.submitMotionFromChair = async function() {
  const type = document.getElementById('motion-type').value;
  const country = document.getElementById('motion-country').value.trim();
  const details = document.getElementById('motion-details').value.trim();

  if (!country) { alert('Please enter the proposing country'); return; }

  await api('/api/motion/submit', {
    room_id: SESSION.roomId,
    country, type, details
  });

  document.getElementById('motion-country').value = '';
  document.getElementById('motion-details').value = '';
  closeModal('modal-motion');
}

function updateMotions(motions) {
  const list = document.getElementById('motions-list');
  updateNavCount('count-motions', motions.length);

  if (!motions.length) {
    list.innerHTML = '<div class="empty-msg">No motions</div>';
    return;
  }

  list.innerHTML = motions.map(m => `
    <div class="list-row">
      <div>
        <span class="row-tag tag-${m.type}">${motionLabel(m.type)}</span>
        <div class="row-main">${m.country}</div>
        ${m.details ? `<div class="row-sub">${m.details}</div>` : ''}
      </div>
      <div class="row-actions">
        <button class="btn-sm accept" onclick="resolveMotion(${m.id})">Accept</button>
        <button class="btn-sm reject" onclick="resolveMotion(${m.id})">Reject</button>
      </div>
    </div>
  `).join('');
}

window.resolveMotion = async function(id) {
  await api('/api/motion/delete', { motion_id: id });
}

// ── CHITS ──
// Mark = delete immediately for everyone
function renderChits() {
  const list = document.getElementById('chits-list');
  updateNavCount('count-chits', allChits.length);

  if (!allChits.length) {
    list.innerHTML = '<div class="empty-msg">No chits</div>';
    return;
  }

  // Group into conversation threads
  const threads = {};
  allChits.forEach(c => {
    const key = [c.from_country, c.to_country].sort().join('↔');
    if (!threads[key]) {
      threads[key] = {
        label: `${c.from_country} ↔ ${c.to_country}`,
        chits: []
      };
    }
    threads[key].chits.push(c);
  });

  list.innerHTML = Object.values(threads).map(thread => `
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:600;color:#534AB7;
                  padding:5px 12px;background:#EEEDFE;
                  border-radius:6px;margin-bottom:4px">
        ${thread.label}
      </div>
      ${thread.chits.map(c => `
        <div class="chit-item">
          <div class="chit-header">
            <span class="chit-route">
              <strong>${c.from_country}</strong> → <strong>${c.to_country}</strong>
            </span>
            <span class="chit-time">${formatTimestamp(c.sent_at)}</span>
          </div>
          <div class="chit-body">${c.text}</div>
          <div class="chit-footer">
            ${aiScoreBadge(c.ai_score)}
            <button class="btn-sm reject" onclick="deleteChit(${c.id})">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

window.deleteChit = async function(chitId) {
  if (!confirm('Delete this chit? It will be removed for everyone.')) return;
  await api('/api/chit/mark', { chit_id: chitId });
  // Remove from local state immediately
  allChits = allChits.filter(c => c.id !== chitId);
  renderChits();
}

// ── AMENDMENTS ──
function updateAmendments(amendments) {
  const list = document.getElementById('amendments-list');
  const pending = amendments.filter(a => a.status === 'pending');
  updateNavCount('count-amendments', pending.length);

  if (!amendments.length) {
    list.innerHTML = '<div class="empty-msg">No amendments</div>';
    return;
  }

  list.innerHTML = amendments.map(a => `
    <div class="list-row">
      <div style="flex:1">
        <span class="row-tag tag-${a.status}">${a.status}</span>
        <span class="row-tag tag-pp" style="margin-left:4px">${a.type}</span>
        <div class="row-main">${a.country}</div>
        <div class="row-sub">${a.resolution} — ${a.clause}</div>
        <div class="row-sub" style="margin-top:4px">${a.text}</div>
      </div>
      ${a.status === 'pending' ? `
        <div class="row-actions">
          <button class="btn-sm accept"
            onclick="resolveAmendment(${a.id}, 'accepted')">Accept</button>
          <button class="btn-sm reject"
            onclick="resolveAmendment(${a.id}, 'rejected')">Reject</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

window.resolveAmendment = async function(id, status) {
  await api('/api/amendment/resolve', { amendment_id: id, status });
}

// ── DOCUMENTS ──
function updateDocuments(documents) {
  const list = document.getElementById('documents-list');
  updateNavCount('count-documents', documents.length);

  if (!documents.length) {
    list.innerHTML = '<div class="empty-msg">No documents</div>';
    return;
  }

  const tagMap = {
    'Position Paper': 'pp',
    'Draft Resolution': 'dr',
    'Working Paper': 'wp',
    'Private Directive': 'pd',
    'Public Directive': 'pd'
  };

  list.innerHTML = documents.map(d => `
    <div class="list-row" style="flex-direction:column;align-items:flex-start">
      <div style="display:flex;justify-content:space-between;width:100%;margin-bottom:8px">
        <div>
          <span class="row-tag tag-${tagMap[d.type] || 'pp'}">${d.type}</span>
          <div class="row-main">${d.country} — ${d.title || '—'}</div>
        </div>
        ${aiScoreBadge(d.ai_score)}
      </div>
      ${d.content ? `
        <div style="background:#f5f4f1;border-radius:6px;padding:10px;
                    font-size:12px;line-height:1.6;color:#333;
                    white-space:pre-wrap;width:100%;max-height:200px;
                    overflow-y:auto">${d.content}</div>
      ` : ''}
    </div>
  `).join('');
}

// ── DELEGATES ──
function updateDelegates(delegates) {
  const grid = document.getElementById('delegates-grid');
  document.getElementById('delegate-count').textContent = delegates.length;

  if (!delegates.length) {
    grid.innerHTML = '<div class="empty-msg">No delegates connected</div>';
    return;
  }

  grid.innerHTML = delegates.map(d => `
    <div class="delegate-chip">
      <div class="delegate-name">${d.country}</div>
      <div class="delegate-code">${d.code}</div>
    </div>
  `).join('');
}

// ── POINTS ──
function updatePoints(points) {
  const list = document.getElementById('points-list');

  if (!points.length) {
    list.innerHTML = '<div class="empty-msg">No points raised</div>';
    return;
  }

  list.innerHTML = points.map(p => `
    <div class="list-row">
      <div>
        <span class="row-tag tag-${p.type.toLowerCase()}">${p.type}</span>
        <div class="row-main">${p.country}</div>
        <div class="row-sub">${formatTimestamp(p.raised_at)}</div>
      </div>
      <div class="row-actions">
        <button class="btn-sm" onclick="acknowledgePoint(${p.id})">Acknowledge</button>
        <button class="btn-sm reject" onclick="dismissPoint(${p.id})">Dismiss</button>
      </div>
    </div>
  `).join('');
}

window.acknowledgePoint = async function(id) {
  await api('/api/point/dismiss', { point_id: id });
}

window.dismissPoint = async function(id) {
  await api('/api/point/dismiss', { point_id: id });
}