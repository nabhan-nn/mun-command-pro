import { db, formatTime, formatTimestamp, motionLabel, aiClass, aiScoreClass } from './app.js';
import { ref, onValue, push, set, remove }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const roomCode = sessionStorage.getItem('mun_room');
const committee = sessionStorage.getItem('mun_committee');
const chairName = sessionStorage.getItem('mun_name');

let timerInterval, timerSeconds = 90;
let allDelegates = [];
let speakersList = [];

// ─── INIT ────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (!roomCode) { window.location.href = '/'; return; }

  document.getElementById('room-code-display').textContent = roomCode;
  document.getElementById('chair-name-display').textContent = chairName;
  document.getElementById('committee-display').textContent = committee;
  document.getElementById('timer-display').textContent = formatTime(timerSeconds);

  // Load delegates from Google Sheet for searchable dropdown
  await loadDelegatesFromSheet();

  // Firebase listeners
  onValue(ref(db, 'rooms/' + roomCode + '/chits'), snap => {
    const chits = snap.val() || {};
    const arr = Object.entries(chits).map(([id,d]) => ({id,...d}));
    renderChits(arr);
    updateBadge('badge-chits', arr.length);
  });

  onValue(ref(db, 'rooms/' + roomCode + '/motions'), snap => {
    const motions = snap.val() || {};
    const arr = Object.entries(motions).map(([id,d]) => ({id,...d}));
    renderMotions(arr);
    updateBadge('badge-motions', arr.length);
  });

  onValue(ref(db, 'rooms/' + roomCode + '/documents'), snap => {
    const docs = snap.val() || {};
    const arr = Object.entries(docs).map(([id,d]) => ({id,...d}));
    renderDocuments(arr);
    updateBadge('badge-documents', arr.length);
  });

  onValue(ref(db, 'rooms/' + roomCode + '/delegates'), snap => {
    const dels = snap.val() || {};
    renderDelegates(Object.values(dels));
    document.getElementById('delegate-count').textContent = Object.keys(dels).length + ' online';
  });

  onValue(ref(db, 'rooms/' + roomCode + '/speakers'), snap => {
    const speakers = snap.val() || {};
    speakersList = Object.entries(speakers).map(([id,d]) => ({id,...d}));
    renderSpeakers(speakersList);
  });

  onValue(ref(db, 'rooms/' + roomCode + '/currentSpeaker'), snap => {
    document.getElementById('current-speaker-name').textContent = snap.val() || 'No speaker selected';
  });

  onValue(ref(db, 'rooms/' + roomCode + '/pois'), snap => {
    const pois = snap.val() || {};
    renderPOIs(Object.entries(pois).map(([id,d]) => ({id,...d})));
  });
});

// ─── LOAD DELEGATES FROM SHEET ───────────
async function loadDelegatesFromSheet() {
  try {
    const res = await fetch('/api/delegates/' + encodeURIComponent(committee));
    const data = await res.json();
    allDelegates = data.delegates || [];
    renderDropdown(allDelegates);
  } catch (e) {
    console.error('Could not load delegates:', e);
  }
}

// ─── SEARCHABLE DROPDOWN ─────────────────
window.filterDelegates = function() {
  const query = document.getElementById('speaker-search').value.toLowerCase();
  const filtered = allDelegates.filter(d =>
    d.country.toLowerCase().includes(query)
  );
  renderDropdown(filtered);
}

function renderDropdown(delegates) {
  const list = document.getElementById('delegate-dropdown');
  if (!delegates.length) {
    list.innerHTML = '<div class="dropdown-item empty">No matches</div>';
    list.style.display = 'block';
    return;
  }
  list.innerHTML = delegates.map(d => `
    <div class="dropdown-item" onclick="addSpeakerFromDropdown('${d.country}')">
      ${d.country}
    </div>
  `).join('');
  list.style.display = document.getElementById('speaker-search').value ? 'block' : 'none';
}

window.addSpeakerFromDropdown = async function(country) {
  await push(ref(db, 'rooms/' + roomCode + '/speakers'), {
    country, addedAt: Date.now()
  });
  document.getElementById('speaker-search').value = '';
  document.getElementById('delegate-dropdown').style.display = 'none';
}

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.searchable-dropdown')) {
    const dd = document.getElementById('delegate-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

// ─── SPEAKERS ────────────────────────────
function renderSpeakers(speakers) {
  const list = document.getElementById('speakers-queue');
  if (!speakers.length) {
    list.innerHTML = '<div class="empty-state">No speakers queued</div>';
    return;
  }
  list.innerHTML = speakers.map((s, i) => `
    <div class="speaker-item">
      <span><span class="speaker-num">${i+1}.</span>${s.country}</span>
      <button class="mx" onclick="removeSpeaker('${s.id}')">✕</button>
    </div>
  `).join('');
}

window.removeSpeaker = async function(id) {
  await remove(ref(db, 'rooms/' + roomCode + '/speakers/' + id));
}

window.nextSpeakerBtn = async function() {
  if (!speakersList.length) return;
  const next = speakersList[0];
  await set(ref(db, 'rooms/' + roomCode + '/currentSpeaker'), next.country);
  await remove(ref(db, 'rooms/' + roomCode + '/speakers/' + next.id));
  timerSeconds = parseInt(document.getElementById('speaker-time').value);
  const el = document.getElementById('timer-display');
  el.textContent = formatTime(timerSeconds);
  el.className = 'timer';
  clearInterval(timerInterval);
}

// ─── TIMER ───────────────────────────────
window.startTimer = function() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSeconds--;
    const el = document.getElementById('timer-display');
    el.textContent = formatTime(timerSeconds);
    el.className = 'timer' + (timerSeconds <= 15 ? ' warning' : '') + (timerSeconds <= 5 ? ' danger' : '');
    if (timerSeconds <= 0) clearInterval(timerInterval);
  }, 1000);
}

window.pauseTimer = function() { clearInterval(timerInterval); }

window.resetTimer = function() {
  clearInterval(timerInterval);
  timerSeconds = parseInt(document.getElementById('speaker-time').value);
  const el = document.getElementById('timer-display');
  el.textContent = formatTime(timerSeconds);
  el.className = 'timer';
}

// ─── MOTIONS ─────────────────────────────
window.addMotionChair = async function() {
  const type = document.getElementById('motion-type-chair').value;
  const country = document.getElementById('motion-country-chair').value.trim();
  const details = document.getElementById('motion-details-chair').value.trim();
  if (!country) return;
  await push(ref(db, 'rooms/' + roomCode + '/motions'), {
    type, country, details, submittedAt: Date.now()
  });
  document.getElementById('motion-country-chair').value = '';
  document.getElementById('motion-details-chair').value = '';
  closeModal('modal-add-motion');
}

function renderMotions(motions) {
  const list = document.getElementById('motions-list');
  if (!motions.length) { list.innerHTML = '<div class="empty-state">No motions</div>'; return; }
  list.innerHTML = motions.map(m => `
    <div class="list-row">
      <div>
        <span class="row-tag tag-${m.type}">${motionLabel(m.type)}</span>
        <div class="row-country">${m.country}</div>
        ${m.details ? `<div class="row-detail">${m.details}</div>` : ''}
      </div>
      <div class="row-btns">
        <button class="btn-sm" onclick="removeMotion('${m.id}')">Accept</button>
        <button class="btn-sm" onclick="removeMotion('${m.id}')">Reject</button>
      </div>
    </div>
  `).join('');
}

window.removeMotion = async function(id) {
  await remove(ref(db, 'rooms/' + roomCode + '/motions/' + id));
}

// ─── CHITS ───────────────────────────────
function renderChits(chits) {
  const list = document.getElementById('chits-list');
  if (!chits.length) { list.innerHTML = '<div class="empty-state">No chits</div>'; return; }
  list.innerHTML = chits.map(c => `
    <div class="chit-item" ${c.isAmendment ? 'style="border-left:3px solid #534AB7"' : ''}>
      <div class="chit-header">
        <span class="chit-route">
          ${c.isAmendment ? '<span class="row-tag tag-pp">Amendment</span> ' : ''}
          From <strong>${c.from}</strong> → <strong>${c.to}</strong>
        </span>
        <span class="chit-time">${formatTimestamp(c.sentAt)}</span>
      </div>
      <div class="chit-body">${c.text}</div>
      <div class="chit-footer">
        ${c.isAmendment ? '' : `<span class="ai-badge ${aiClass(c.aiScore)}">AI: ${c.aiScore}%</span>`}
        <button class="mark-btn" onclick="markChit('${c.id}')">Mark as read</button>
      </div>
    </div>
  `).join('');
}

window.markChit = async function(id) {
  await remove(ref(db, 'rooms/' + roomCode + '/chits/' + id));
}

// ─── DOCUMENTS ───────────────────────────
function renderDocuments(docs) {
  const list = document.getElementById('documents-list');
  if (!docs.length) { list.innerHTML = '<div class="empty-state">No documents</div>'; return; }
  list.innerHTML = docs.map(d => `
    <div class="list-row">
      <div style="flex:1">
        <span class="row-tag tag-pp">${d.type}</span>
        <div class="row-country">${d.country}</div>
        <div class="row-detail">${d.fileName}</div>
        <div style="margin-top:6px">
          <span class="ai-badge ${aiClass(d.aiScore)}">AI: ${d.aiScore}%</span>
        </div>
      </div>
      <div class="row-btns">
        <button class="btn-sm" onclick="downloadDoc('${d.id}','${d.publicId}','${d.downloadURL}','${d.fileName}')">Download</button>
      </div>
    </div>
  `).join('');
}

window.downloadDoc = async function(docId, publicId, downloadURL, fileName) {
  try {
    const response = await fetch(downloadURL);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    setTimeout(async () => {
      await fetch('/api/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_id: publicId })
      });
      await remove(ref(db, 'rooms/' + roomCode + '/documents/' + docId));
    }, 1000);
  } catch (e) {
    alert('Download failed: ' + e.message);
  }
}

// ─── DELEGATES ───────────────────────────
function renderDelegates(delegates) {
  const grid = document.getElementById('delegates-grid');
  if (!delegates.length) { grid.innerHTML = '<div class="empty-state">No delegates connected</div>'; return; }
  grid.innerHTML = delegates.map(d => `
    <div class="delegate-chip">
      <div class="delegate-chip-name"><span class="online-dot"></span>${d.country}</div>
      <div class="delegate-chip-code">${d.code}</div>
    </div>
  `).join('');
}

// ─── POIs ────────────────────────────────
function renderPOIs(pois) {
  const list = document.getElementById('poi-list');
  if (!pois.length) { list.innerHTML = '<div class="empty-state">No POI requests</div>'; return; }
  list.innerHTML = pois.map(p => `
    <div class="list-row">
      <div>
        <span class="row-tag tag-order">POI</span>
        <div class="row-country">${p.country}</div>
      </div>
      <div class="row-btns">
        <button class="btn-sm" onclick="dismissPOI('${p.id}')">Acknowledge</button>
        <button class="btn-sm" onclick="dismissPOI('${p.id}')">Dismiss</button>
      </div>
    </div>
  `).join('');
}

window.dismissPOI = async function(id) {
  await remove(ref(db, 'rooms/' + roomCode + '/pois/' + id));
}

// ─── CLOSE ROOM ──────────────────────────
window.closeRoom = async function() {
  if (!confirm('Close this room? This will end the session and delete all data.')) return;
  await remove(ref(db, 'rooms/' + roomCode));
  sessionStorage.clear();
  window.location.href = '/';
}

// ─── HELPERS ─────────────────────────────
function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('visible', count > 0);
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }