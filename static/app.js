import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, onValue, push, set, remove, get }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'YOUR-API-KEY',
  authDomain: 'mun-command-pro.firebaseapp.com',
  databaseURL: 'https://mun-command-pro-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'mun-command-pro',
  storageBucket: 'mun-command-pro.firebasestorage.app',
  messagingSenderId: 'YOUR-SENDER-ID',
  appId: 'YOUR-APP-ID'
};

const firebaseApp = initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);

// ─── LOGIN ───────────────────────────────
async function login() {
  const code = document.getElementById('access-code').value.trim().toUpperCase();
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  if (!code) { errorEl.textContent = 'Please enter your code'; return; }

  btn.textContent = 'Checking...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (!data.valid) {
      errorEl.textContent = data.error || 'Invalid code. Try again.';
      btn.textContent = 'Continue';
      btn.disabled = false;
      return;
    }

    // Store session info
    sessionStorage.setItem('mun_code', code);
    sessionStorage.setItem('mun_role', data.role);
    sessionStorage.setItem('mun_committee', data.committee || '');

    if (data.role === 'chair') {
      sessionStorage.setItem('mun_name', data.name);
      // Create room in Firebase using committee as room key
      const roomKey = data.committee.replace(/\s+/g, '-').toUpperCase();
      sessionStorage.setItem('mun_room', roomKey);
      await set(ref(db, 'rooms/' + roomKey + '/info'), {
        committee: data.committee,
        chairName: data.name,
        createdAt: Date.now()
      });
      window.location.href = '/chair';

    } else if (data.role === 'delegate') {
      sessionStorage.setItem('mun_name', data.country);
      sessionStorage.setItem('mun_country', data.country);
      const roomKey = data.committee.replace(/\s+/g, '-').toUpperCase();
      sessionStorage.setItem('mun_room', roomKey);
      // Register delegate in Firebase
      await set(ref(db, 'rooms/' + roomKey + '/delegates/' + code), {
        country: data.country,
        code: code,
        joinedAt: Date.now()
      });
      window.location.href = '/delegate';

    } else if (data.role === 'secretariat') {
      sessionStorage.setItem('mun_name', data.name);
      sessionStorage.setItem('mun_role_title', data.role_title);
      window.location.href = '/secretariat';
    }

  } catch (err) {
    errorEl.textContent = 'Connection error. Try again.';
    btn.textContent = 'Continue';
    btn.disabled = false;
  }
}

// ─── PROFANITY ───────────────────────────
const PROFANITY = ['fuck','shit','damn','ass','bitch','crap',
  'bastard','hell','piss','dick','cunt','cock',
  'bollocks','wanker','arse','twat'];

export function containsProfanity(text) {
  return PROFANITY.some(word =>
    new RegExp('\\b' + word + '\\b', 'i').test(text)
  );
}

// ─── AI SCORE ────────────────────────────
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

export function aiScoreClass(score) {
  if (score < 40) return 'ai-low';
  if (score < 70) return 'ai-mid';
  return 'ai-high';
}

// ─── TAB SWITCHER ────────────────────────
window.showTab = function(tabName, el) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const tab = document.getElementById('tab-' + tabName);
  if (tab) tab.classList.add('active');
  if (el) el.classList.add('active');
  const labels = {
    speakers:'Speakers', motions:'Motions', documents:'Documents',
    chits:'Chits', delegates:'Delegates', session:'Session',
    amendments:'Amendments', overview:'Overview', rooms:'Rooms', profanity:'Profanity Alerts'
  };
  const titleEl = document.getElementById('page-title') ||
                  document.getElementById('del-page-title') ||
                  document.getElementById('sec-page-title');
  if (titleEl && labels[tabName]) titleEl.textContent = labels[tabName];
}

window.openModal = function(id) {
  document.getElementById(id).classList.add('open');
}
window.closeModal = function(id) {
  document.getElementById(id).classList.remove('open');
}

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

// ─── INIT LOGIN PAGE ─────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('login-btn');
  if (btn) btn.addEventListener('click', login);
  const input = document.getElementById('access-code');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
});