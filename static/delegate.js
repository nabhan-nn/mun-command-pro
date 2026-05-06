import { SESSION, formatTime, formatTimestamp, motionLabel,
         aiScoreBadge, updateNavCount,
         initTabs, updateClosedBanner, disableSubmitButtons,
         api, containsProfanity } from './app.js';

// ── STATE ──
let lastTimestamp = 0;
let allChits = [];
let currentThread = null;

// ── INITIALISE ──
document.addEventListener('DOMContentLoaded', async () => {

  if (!SESSION.roomId || SESSION.role !== 'delegate') {
    window.location.href = '/';
    return;
  }

  document.getElementById('del-room-code').textContent = SESSION.roomId;
  document.getElementById('del-country-display').textContent = SESSION.country;
  document.getElementById('del-code-display').textContent = SESSION.code;

  initTabs();
  await loadRecipients();
  startPolling();
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
    updateClosedBanner(isOpen, 'del-closed-banner');
    disableSubmitButtons(isOpen);

    updateSession(data.room, data.speakers);
    updateMotions(data.motions);
    updateMyAmendments(data.amendments);
    updateMyDocuments(data.documents);

    // Deduplicate chits
    if (data.chits.length > 0) {
      const existingIds = new Set(allChits.map(c => c.id));
      const newChits = data.chits.filter(c => !existingIds.has(c.id));
      if (newChits.length > 0) {
        allChits = [...allChits, ...newChits];
        renderConversations();
        if (currentThread) renderThread(currentThread);
      }
    }

    lastTimestamp = data.timestamp;

  } catch (err) {
    console.error('Poll failed:', err);
  }
}

// ── SESSION TAB ──
function updateSession(room, speakers) {
  const speakerEl = document.getElementById('del-current-speaker');
  speakerEl.textContent = room.current_speaker || 'Waiting for chair...';

  const timerEl = document.getElementById('del-timer');
  if (room.timer_value !== null && room.timer_value !== undefined) {
    timerEl.textContent = formatTime(room.timer_value);
    timerEl.className = 'timer-display';
    if (room.timer_value <= 15) timerEl.classList.add('warning');
    if (room.timer_value <= 5)  timerEl.classList.add('danger');
  }

  const queueEl = document.getElementById('del-speakers-queue');
  if (!speakers || !speakers.length) {
    queueEl.innerHTML = '<div class="empty-msg">No speakers queued</div>';
    return;
  }
  queueEl.innerHTML = speakers.map((s, i) => `
    <div class="list-row">
      <span style="font-size:10px;color:#aaa;margin-right:6px">${i + 1}.</span>
      <span class="row-main" style="display:inline">${s.country}</span>
    </div>
  `).join('');
}

// ── RAISE POINT (POO and PPP only — no POI) ──
window.raisePoint = async function(type) {
  await api('/api/point/raise', {
    room_id: SESSION.roomId,
    country: SESSION.country,
    type: type
  });
  const btn = event.target;
  btn.textContent = '✓ Raised';
  setTimeout(() => { btn.textContent = `Raise ${type}`; }, 2000);
}

// ── LOAD RECIPIENTS ──
async function loadRecipients() {
  try {
    const data = await api(`/api/delegates/${encodeURIComponent(SESSION.committee)}`);
    const select = document.getElementById('chit-recipient');
    select.innerHTML = '<option value="Chair">Chair</option>';
    (data.delegates || []).forEach(d => {
      if (d.country !== SESSION.country) {
        const opt = document.createElement('option');
        opt.value = d.country;
        opt.textContent = d.country;
        select.appendChild(opt);
      }
    });
  } catch (e) {
    console.error('Could not load recipients:', e);
  }
}

// ── SEND CHIT ──
window.sendChit = async function() {
  const text = document.getElementById('chit-text').value.trim();
  const recipient = document.getElementById('chit-recipient').value;
  const warningEl = document.getElementById('profanity-warning');

  if (!text) return;

  if (containsProfanity(text)) {
    warningEl.style.display = 'block';
    return;
  }

  warningEl.style.display = 'none';

  const result = await api('/api/chit/send', {
    room_id: SESSION.roomId,
    from_country: SESSION.country,
    to_country: recipient,
    text: text
  });

  if (result.closed) { alert('Room is currently closed'); return; }

  document.getElementById('chit-text').value = '';
}

// ── CONVERSATIONS ──
function renderConversations() {
  const list = document.getElementById('conversations-list');

  const myChits = allChits.filter(c =>
    c.from_country === SESSION.country || c.to_country === SESSION.country
  );

  if (!myChits.length) {
    list.innerHTML = '<div class="empty-msg">No messages yet</div>';
    return;
  }

  const threads = {};
  myChits.forEach(c => {
    const other = c.from_country === SESSION.country ? c.to_country : c.from_country;
    if (!threads[other]) threads[other] = [];
    threads[other].push(c);
  });

  const openedThreads = JSON.parse(sessionStorage.getItem('opened_threads') || '{}');

  list.innerHTML = Object.entries(threads).map(([other, chits]) => {
    const lastChit = chits[chits.length - 1];
    const unread = chits.filter(c =>
      c.to_country === SESSION.country && !openedThreads[other]
    ).length;

    return `
      <div class="conv-item" onclick="openThread('${other}')">
        <div>
          <div class="conv-name">${other}</div>
          <div class="conv-preview">
            ${lastChit.text.substring(0, 45)}${lastChit.text.length > 45 ? '...' : ''}
          </div>
        </div>
        ${unread > 0 ? `<span class="conv-unread">${unread}</span>` : ''}
      </div>
    `;
  }).join('');

  const totalUnread = Object.entries(threads).reduce((sum, [other, chits]) => {
    return sum + chits.filter(c =>
      c.to_country === SESSION.country && !openedThreads[other]
    ).length;
  }, 0);
  updateNavCount('del-count-chits', totalUnread);
}

// ── THREAD VIEW ──
window.openThread = function(other) {
  currentThread = other;
  const openedThreads = JSON.parse(sessionStorage.getItem('opened_threads') || '{}');
  openedThreads[other] = true;
  sessionStorage.setItem('opened_threads', JSON.stringify(openedThreads));

  document.getElementById('thread-card').style.display = 'block';
  document.getElementById('thread-title').textContent = other;
  renderThread(other);
  renderConversations();
}

window.closeThread = function() {
  currentThread = null;
  document.getElementById('thread-card').style.display = 'none';
}

function renderThread(other) {
  const container = document.getElementById('thread-messages');

  const threadChits = allChits.filter(c =>
    (c.from_country === SESSION.country && c.to_country === other) ||
    (c.from_country === other && c.to_country === SESSION.country)
  ).sort((a, b) => a.sent_at - b.sent_at);

  if (!threadChits.length) {
    container.innerHTML = '<div class="empty-msg">No messages yet</div>';
    return;
  }

  container.innerHTML = threadChits.map(c => {
    const isSent = c.from_country === SESSION.country;
    return `
      <div>
        <div class="thread-msg ${isSent ? 'sent' : 'received'}">
          ${c.text}
          <div class="thread-msg-meta">
            ${aiScoreBadge(c.ai_score)}
            ${formatTimestamp(c.sent_at)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

window.sendReply = async function() {
  if (!currentThread) return;
  const text = document.getElementById('reply-text').value.trim();
  if (!text) return;

  if (containsProfanity(text)) {
    alert('Message blocked — inappropriate language');
    return;
  }

  const result = await api('/api/chit/send', {
    room_id: SESSION.roomId,
    from_country: SESSION.country,
    to_country: currentThread,
    text: text
  });

  if (result.closed) { alert('Room is currently closed'); return; }
  document.getElementById('reply-text').value = '';
}

// ── SUBMIT DOCUMENT (text-based) ──
window.submitDocument = async function() {
  const docType = document.getElementById('doc-type').value;
  const title = document.getElementById('doc-title').value.trim();
  const content = document.getElementById('doc-content').value.trim();
  const btn = document.getElementById('upload-btn');

  if (!title || !content) { alert('Please fill in the title and content'); return; }

  btn.textContent = 'Submitting...';
  btn.disabled = true;

  try {
    const result = await api('/api/document/submit', {
      room_id: SESSION.roomId,
      country: SESSION.country,
      doc_type: docType,
      title: title,
      content: content
    });

    if (result.closed) { alert('Room is currently closed'); return; }

    document.getElementById('doc-title').value = '';
    document.getElementById('doc-content').value = '';
    alert('Document submitted successfully');

  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.textContent = 'Submit';
    btn.disabled = false;
  }
}

// ── MY DOCUMENTS ──
function updateMyDocuments(documents) {
  const list = document.getElementById('my-documents');
  const myDocs = documents.filter(d => d.country === SESSION.country);

  if (!myDocs.length) {
    list.innerHTML = '<div class="empty-msg">Nothing submitted yet</div>';
    return;
  }

  const tagMap = {
    'Position Paper': 'pp', 'Draft Resolution': 'dr',
    'Working Paper': 'wp', 'Private Directive': 'pd', 'Public Directive': 'pd'
  };

  list.innerHTML = myDocs.map(d => `
    <div class="list-row">
      <div>
        <span class="row-tag tag-${tagMap[d.type] || 'pp'}">${d.type}</span>
        <div class="row-main">${d.title || '—'}</div>
        <div class="row-sub">Submitted · waiting for chair</div>
        <div style="margin-top:4px">${aiScoreBadge(d.ai_score)}</div>
      </div>
    </div>
  `).join('');
}

// ── AMENDMENTS ──
window.submitAmendment = async function() {
  const resolution = document.getElementById('amend-resolution').value.trim();
  const clause = document.getElementById('amend-clause').value.trim();
  const type = document.getElementById('amend-type').value;
  const text = document.getElementById('amend-text').value.trim();

  if (!resolution || !text) { alert('Please fill in all fields'); return; }

  const result = await api('/api/amendment/submit', {
    room_id: SESSION.roomId,
    country: SESSION.country,
    resolution, clause, type, text
  });

  if (result.closed) { alert('Room is currently closed'); return; }

  document.getElementById('amend-resolution').value = '';
  document.getElementById('amend-clause').value = '';
  document.getElementById('amend-text').value = '';
  alert('Amendment submitted');
}

function updateMyAmendments(amendments) {
  const list = document.getElementById('my-amendments');
  const mine = amendments.filter(a => a.country === SESSION.country);

  if (!mine.length) {
    list.innerHTML = '<div class="empty-msg">No amendments submitted</div>';
    return;
  }

  list.innerHTML = mine.map(a => `
    <div class="list-row">
      <div>
        <span class="row-tag tag-${a.status}">${a.status}</span>
        <div class="row-main">${a.type} — ${a.resolution}</div>
        <div class="row-sub">Clause: ${a.clause}</div>
        <div class="row-sub" style="margin-top:4px">${a.text}</div>
      </div>
    </div>
  `).join('');
}

// ── MOTIONS ──
window.submitMotion = async function() {
  const type = document.getElementById('del-motion-type').value;
  const details = document.getElementById('del-motion-details').value.trim();

  const result = await api('/api/motion/submit', {
    room_id: SESSION.roomId,
    country: SESSION.country,
    type, details
  });

  if (result.closed) { alert('Room is currently closed'); return; }

  document.getElementById('del-motion-details').value = '';
  alert('Motion submitted');
}

function updateMotions(motions) {
  const list = document.getElementById('del-motions-list');

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
    </div>
  `).join('');
}