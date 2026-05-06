// ── SHARED STATE ──
// These variables are available across the whole file
export const SESSION = {
  code: sessionStorage.getItem('mun_code'),
  role: sessionStorage.getItem('mun_role'),
  name: sessionStorage.getItem('mun_name'),
  committee: sessionStorage.getItem('mun_committee'),
  roomId: sessionStorage.getItem('mun_room_id'),
  country: sessionStorage.getItem('mun_country'),
  roleTitle: sessionStorage.getItem('mun_role_title'),
};

// sessionStorage stores data for the current browser session only.
// It's cleared when the tab is closed. Perfect for login state.
// We use it to remember who is logged in without a proper auth system.

// ── PROFANITY LIST ──
const PROFANITY = [
  'fuck', 'shit', 'damn', 'ass', 'bitch', 'crap', 'bastard',
  'piss', 'dick', 'cunt', 'cock', 'bollocks', 'wanker', 'arse', 'twat'
];

export function containsProfanity(text) {
  return PROFANITY.some(word =>
    new RegExp('\\b' + word + '\\b', 'i').test(text)
  );
}

// \\b is a word boundary — matches the edge of a word.
// This means 'ass' matches as a standalone word but not
// inside 'class' or 'assistant'. The 'i' flag makes it
// case-insensitive so 'SHIT' is caught the same as 'shit'.

// ── AI SCORE BADGE ──
export function aiScoreClass(score) {
  if (score < 40) return 'ai-low';
  if (score < 70) return 'ai-mid';
  return 'ai-high';
}

export function aiScoreBadge(score) {
  return `<span class="ai-badge ${aiScoreClass(score)}">AI: ${score}%</span>`;
}

// These are exported so chair.js and delegate.js can import
// and use them without duplicating the code.

// ── TIME FORMATTER ──
export function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

export function formatTimestamp(ms) {
  const d = new Date(ms);
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

// padStart(2, '0') ensures numbers always have 2 digits.
// So 9 becomes '09' and 0 becomes '00'.
// Math.floor rounds down — 90 seconds = 1 minute 30 seconds.
// 90 % 60 = 30 (the remainder after dividing by 60).

// ── MOTION LABEL ──
export function motionLabel(type) {
  const labels = {
    mod: 'Moderated Caucus',
    unmod: 'Unmoderated Caucus',
    challenge: 'Challenge',
    suspension: 'Suspension of Debate',
    adjourn: 'Adjournment',
    extend: 'Extension of Speakers List',
    order: 'Point of Order'
  };
  return labels[type] || type;
}

// ── TAB SWITCHER ──
export function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Remove active from all buttons and panels
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      // Add active to clicked button and matching panel
      btn.classList.add('active');
      document.getElementById('tab-' + tab)?.classList.add('active');

      // Update the page title in the header
      const titleEl = document.getElementById('main-title') ||
                      document.getElementById('del-main-title') ||
                      document.getElementById('sec-main-title');
      if (titleEl) titleEl.textContent = btn.textContent.trim();
    });
  });
}

// querySelectorAll returns ALL matching elements as a list.
// forEach loops through each one.
// dataset.tab reads the data-tab="speakers" attribute from the HTML.
// classList.add/remove adds or removes CSS classes.
// The ? in ?.classList is optional chaining — if the element
// doesn't exist, it does nothing instead of crashing.

// ── MODAL HELPERS ──
export function openModal(id) {
  document.getElementById(id).classList.add('open');
}

export function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Make these available as window functions so HTML onclick
// attributes can call them directly
window.openModal = openModal;
window.closeModal = closeModal;

// ── NAV COUNT BADGE ──
export function updateNavCount(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('visible', count > 0);
}

// classList.toggle('visible', condition) adds the class
// if condition is true, removes it if false.
// So the badge only shows when count > 0.

// ── API HELPER ──
export async function api(endpoint, body = null) {
  const options = {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null
  };

  const res = await fetch(endpoint, options);
  return res.json();
}

// This is a wrapper around the browser's fetch API.
// Instead of writing the same fetch options every time,
// you just call api('/api/chit/send', { text: 'hello' })
// If body is provided it sends a POST request with JSON.
// If no body it sends a GET request.
// await means "wait for this to finish before continuing".

// ── LOGIN PAGE ──
const loginBtn = document.getElementById('login-btn');
const codeInput = document.getElementById('access-code');
const loginError = document.getElementById('login-error');

if (loginBtn) {
  // Only runs on the login page where login-btn exists

  loginBtn.addEventListener('click', handleLogin);

  codeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  // Pressing Enter also submits the code — better UX
}

async function handleLogin() {
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    loginError.textContent = 'Please enter your code';
    return;
  }

  loginBtn.textContent = 'Checking...';
  loginBtn.disabled = true;
  loginError.textContent = '';

  try {
    const data = await api('/api/verify-code', { code });

    if (!data.valid) {
      loginError.textContent = data.error || 'Invalid code';
      loginBtn.textContent = 'Continue';
      loginBtn.disabled = false;
      return;
    }

    // Save session info
    sessionStorage.setItem('mun_code', code);
    sessionStorage.setItem('mun_role', data.role);

    if (data.role === 'chair') {
      sessionStorage.setItem('mun_name', data.name);
      sessionStorage.setItem('mun_committee', data.committee);

      // Create room in database
      const roomData = await api('/api/room/create', {
        committee: data.committee,
        chair_name: data.name
      });
      sessionStorage.setItem('mun_room_id', roomData.room_id);
      window.location.href = '/chair';

    } else if (data.role === 'delegate') {
      sessionStorage.setItem('mun_name', data.country);
      sessionStorage.setItem('mun_country', data.country);
      sessionStorage.setItem('mun_committee', data.committee);

      // Room ID is the committee name formatted
      const roomId = data.committee.replace(/ /g, '-').toUpperCase();
      sessionStorage.setItem('mun_room_id', roomId);

      // Register delegate in database
      await api('/api/delegate/register', {
        code: code,
        country: data.country,
        committee: data.committee,
        room_id: roomId
      });

      window.location.href = '/delegate';

    } else if (data.role === 'secretariat') {
      sessionStorage.setItem('mun_name', data.name);
      sessionStorage.setItem('mun_role_title', data.role_title);
      window.location.href = '/secretariat';
    }

  } catch (err) {
    loginError.textContent = 'Connection error. Try again.';
    loginBtn.textContent = 'Continue';
    loginBtn.disabled = false;
  }
}

// ── ROOM STATUS BANNER ──
export function updateClosedBanner(isOpen, bannerId) {
  const banner = document.getElementById(bannerId);
  if (!banner) return;
  banner.style.display = isOpen ? 'none' : 'block';
}

export function disableSubmitButtons(isOpen) {
  // Find all submit buttons and disable/enable them based on room status
  document.querySelectorAll('.submit-btn').forEach(btn => {
    btn.disabled = !isOpen;
    btn.title = isOpen ? '' : 'Room is currently closed';
  });
}

// When room is closed, all buttons with class submit-btn
// get disabled automatically. No 403 errors shown to users.