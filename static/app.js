// Firebase imports
import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, onValue, push, set, remove, get }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// Your Firebase config — paste your actual values here
const firebaseConfig = {
  apiKey: "AIzaSyAvnDPAhPz6kl9Df-fHtmoThhLKnE04VuI",
  authDomain: "mun-command-pro.firebaseapp.com",
  databaseURL: "https://mun-command-pro-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mun-command-pro",
  storageBucket: "mun-command-pro.firebasestorage.app",
  messagingSenderId: "1035076483383",
  appId: "1:1035076483383:web:cec71404cfdb59e41cc2b2"
};

const firebaseApp = initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);

// ─── ROOM CODE GENERATORS ───────────────
export function generateRoomCode() {
  return 'MUN-' + Math.floor(1000 + Math.random() * 9000);
}
export function generateDelCode() {
  return 'DEL-' + Math.floor(1000 + Math.random() * 9000);
}

// ─── PROFANITY CHECKER ──────────────────
const PROFANITY = ['fuck','shit','damn','ass','bitch','crap',
  'bastard','hell','piss','dick','cunt','cock',
  'bollocks','wanker','arse','twat'];

export function containsProfanity(text) {
  return PROFANITY.some(word =>
    new RegExp('\\b' + word + '\\b', 'i').test(text)
  );
}

// ─── AI SCORE ───────────────────────────
export async function getAiScore(text) {
  await new Promise(r => setTimeout(r, Math.random() * 500));
  try {
    const res = await fetch('/api/ai-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    return data.ai_probability ?? 0;
  } catch { return 0; }
}

// ─── BADGE HELPER ───────────────────────
export function aiScoreClass(score) {
  if (score < 40) return 'ai-low';
  if (score < 70) return 'ai-mid';
  return 'ai-high';
}

// ─── CREATE ROOM ────────────────────────
export async function createRoom() {
  const chairName = document.getElementById('chair-name').value.trim();
  const committee = document.getElementById('committee').value.trim();
  if (!chairName || !committee) { alert('Fill in all fields'); return; }

  const code = generateRoomCode();
  await set(ref(db, 'rooms/' + code), {
    code, chairName, committee, createdAt: Date.now(), currentSpeaker: null
  });

  sessionStorage.setItem('mun_room', code);
  sessionStorage.setItem('mun_role', 'chair');
  sessionStorage.setItem('mun_name', chairName);

  document.getElementById('code-display').textContent = code;
  document.getElementById('created-code').style.display = 'block';
}

export function goToChair() { window.location.href = '/chair'; }

// ─── JOIN ROOM ───────────────────────────
export async function joinRoom() {
  const code = document.getElementById('room-code').value.trim().toUpperCase();
  const country = document.getElementById('country').value.trim();
  if (!code || !country) { alert('Fill in all fields'); return; }

  const snapshot = await get(ref(db, 'rooms/' + code));
  if (!snapshot.exists()) {
    document.getElementById('join-error').textContent = 'Room not found. Check the code.';
    return;
  }

  const delCode = generateDelCode();
  await push(ref(db, 'rooms/' + code + '/delegates'), {
    name: country, delCode, joinedAt: Date.now()
  });

  sessionStorage.setItem('mun_room', code);
  sessionStorage.setItem('mun_role', 'delegate');
  sessionStorage.setItem('mun_name', country);
  sessionStorage.setItem('del_code', delCode);
  window.location.href = '/delegate';
}

window.createRoom = createRoom;
window.goToChair = goToChair;
window.joinRoom = joinRoom;

// ── TAB SWITCHER ──
window.showTab = function(tabName, el) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const tab = document.getElementById('tab-' + tabName);
  if (tab) tab.classList.add('active');
  if (el) el.classList.add('active');
  const titles = {
    speakers: 'Speakers', motions: 'Motions', documents: 'Documents',
    chits: 'Chits', delegates: 'Delegates', session: 'Session',
    amendments: 'Amendments'
  };
  const titleEl = document.getElementById('page-title') || document.getElementById('del-page-title');
  if (titleEl && titles[tabName]) titleEl.textContent = titles[tabName];
}

window.openAddSpeaker = () => openModal('modal-add-speaker');
window.openAddMotion  = () => openModal('modal-add-motion');

window.openModal = function(id) {
  document.getElementById(id).classList.add('open');
}
window.closeModal = function(id) {
  document.getElementById(id).classList.remove('open');
}

// ── HELPERS ──
export function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

export function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

export function motionLabel(type) {
  const map = {
    mod: 'Moderated Caucus', unmod: 'Unmoderated Caucus',
    challenge: 'Challenge', suspension: 'Suspension of Debate',
    adjourn: 'Adjournment', extend: 'Extension of Speakers List', order: 'Point of Order'
  };
  return map[type] || type;
}

export function aiClass(score) {
  if (score < 40) return 'ai-low';
  if (score < 70) return 'ai-mid';
  return 'ai-high';
}