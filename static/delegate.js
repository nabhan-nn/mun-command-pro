import { SESSION, formatTime, formatTimestamp, motionLabel,
         aiScoreBadge, aiScoreClass, updateNavCount,
         initTabs, updateClosedBanner, disableSubmitButtons,
         api, containsProfanity } from './app.js';

// ── STATE ──
let lastTimestamp = 0;
let allChits = [];
let currentThread = null;

// allChits stores every chit involving this delegate.
// currentThread stores who the currently open conversation is with.

// ── INITIALISE ──
document.addEventListener('DOMContentLoaded', async () => {

  // Guard — if not logged in as delegate, go back to login
  if (!SESSION.roomId || SESSION.role !== 'delegate') {
    window.location.href = '/';
    return;
  }

  // Fill in sidebar info
  document.getElementById('del-room-code').textContent = SESSION.roomId;
  document.getElementById('del-country-display').textContent = SESSION.country;
  document.getElementById('del-code-display').textContent = SESSION.code;

  // Set up tab switching
  initTabs();

  // Populate the chit recipient dropdown with delegates from the same committee
  await loadRecipients();

  // Listen for file selection to show preview
  document.getElementById('doc-file').addEventListener('change', handleFileSelect);

  // Start polling
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

    // Update room open/closed state
    const isOpen = data.room.is_open;
    updateClosedBanner(isOpen, 'del-closed-banner');
    disableSubmitButtons(isOpen);

    // Update session tab
    updateSession(data.room, data.speakers);

    // Update motions
    updateMotions(data.motions);

    // Update amendments (delegate only sees their own)
    updateMyAmendments(data.amendments);

    // Update my documents
    updateMyDocuments(data.documents);

    // Add new chits to local state
    if (data.chits.length > 0) {
      allChits = [...allChits, ...data.chits];
      renderConversations();

      // If a thread is open, update it with new messages
      if (currentThread) renderThread(currentThread);
    }

    lastTimestamp = data.timestamp;

  } catch (err) {
    console.error('Poll failed:', err);
  }
}

// ── SESSION TAB ──
function updateSession(room, speakers) {
  // Current speaker
  const speakerEl = document.getElementById('del-current-speaker');
  speakerEl.textContent = room.current_speaker || 'Waiting for chair...';

  // Timer — show value broadcast by chair
  const timerEl = document.getElementById('del-timer');
  if (room.timer_value !== null && room.timer_value !== undefined) {
    timerEl.textContent = formatTime(room.timer_value);
    timerEl.className = 'timer-display';
    if (room.timer_value <= 15) timerEl.classList.add('warning');
    if (room.timer_value <= 5)  timerEl.classList.add('danger');
  }

  // Speakers queue
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

// The delegate sees the timer value that the chair broadcasts.
// The chair runs the actual countdown and saves each second
// to the database. The delegate just reads and displays it.
// This means all delegates see the exact same timer as the chair.

// ── RAISE POINT ──
window.raisePoint = async function(type) {
  await api('/api/point/raise', {
    room_id: SESSION.roomId,
    country: SESSION.country,
    type: type
  });

  // Brief visual feedback
  const btn = event.target;
  btn.textContent = '✓ Raised';
  setTimeout(() => {
    btn.textContent = `Raise ${type}`;
  }, 2000);
}

// event.target is the button that was clicked.
// We briefly change its text to confirm the action,
// then restore it after 2 seconds.

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

// We skip the delegate's own country so you can't send a chit to yourself.
// createElement creates a new HTML element in memory.
// appendChild adds it inside the select dropdown.

// ── SEND CHIT ──
window.sendChit = async function() {
  const text = document.getElementById('chit-text').value.trim();
  const recipient = document.getElementById('chit-recipient').value;
  const warningEl = document.getElementById('profanity-warning');

  if (!text) return;

  // Check profanity before sending
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

  if (result.closed) {
    alert('Room is currently closed');
    return;
  }

  // Clear the input on success
  document.getElementById('chit-text').value = '';
}

// ── CONVERSATIONS ──
// Groups all chits into conversation threads by who you're talking to
function renderConversations() {
  const list = document.getElementById('conversations-list');

  // Only show chits involving this delegate
  const myChits = allChits.filter(c =>
    c.from_country === SESSION.country || c.to_country === SESSION.country
  );

  if (!myChits.length) {
    list.innerHTML = '<div class="empty-msg">No messages yet</div>';
    return;
  }

  // Group by the other person in the conversation
  const threads = {};
  myChits.forEach(c => {
    const other = c.from_country === SESSION.country ? c.to_country : c.from_country;
    if (!threads[other]) threads[other] = [];
    threads[other].push(c);
  });

  // Count unread — chits sent TO you that you haven't opened yet
  // We track this by whether you've opened that thread
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

  // Update inbox badge count
  const totalUnread = Object.entries(threads).reduce((sum, [other, chits]) => {
    return sum + chits.filter(c =>
      c.to_country === SESSION.country && !openedThreads[other]
    ).length;
  }, 0);
  updateNavCount('del-count-chits', totalUnread);
}

// reduce() accumulates a value across an array.
// It's like a running total — starts at 0 and adds
// unread count from each thread.

// ── THREAD VIEW ──
window.openThread = function(other) {
  currentThread = other;

  // Mark this thread as opened (clears unread badge)
  const openedThreads = JSON.parse(sessionStorage.getItem('opened_threads') || '{}');
  openedThreads[other] = true;
  sessionStorage.setItem('opened_threads', JSON.stringify(openedThreads));

  document.getElementById('thread-card').style.display = 'block';
  document.getElementById('thread-title').textContent = other;

  renderThread(other);
  renderConversations(); // re-render to clear unread badge
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

  // Sort by time so messages appear in chronological order
  // a.sent_at - b.sent_at: negative = a first, positive = b first

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

  // Auto-scroll to bottom of thread
  container.scrollTop = container.scrollHeight;
}

// scrollTop = scrollHeight scrolls to the very bottom.
// This means new messages always appear visible
// without the user having to scroll down manually.

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

  if (result.closed) {
    alert('Room is currently closed');
    return;
  }

  document.getElementById('reply-text').value = '';
}

// ── FILE UPLOAD ──
function handleFileSelect() {
  const file = document.getElementById('doc-file').files[0];
  const label = document.getElementById('file-label');
  const dropArea = document.getElementById('file-drop');

  if (file) {
    label.textContent = '📄 ' + file.name;
    dropArea.classList.add('has-file');
  } else {
    label.textContent = 'Choose PDF file';
    dropArea.classList.remove('has-file');
  }
}

window.uploadDocument = async function() {
  const fileInput = document.getElementById('doc-file');
  const docType = document.getElementById('doc-type').value;
  const file = fileInput.files[0];
  const btn = document.getElementById('upload-btn');

  if (!file) { alert('Choose a PDF file first'); return; }
  if (file.type !== 'application/pdf') { alert('Only PDF files are allowed'); return; }

  btn.textContent = 'Uploading...';
  btn.disabled = true;

  try {
    // Step 1 — Upload PDF directly to Cloudinary from the browser
    // The file goes browser → Cloudinary directly, not through your server
    // This is faster and doesn't use up your server's memory
    const cloudName = 'dl9npvvln'; // your Cloudinary cloud name
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'mun_documents');
    formData.append('resource_type', 'raw');

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
      { method: 'POST', body: formData }
    );
    const uploadData = await uploadRes.json();

    if (uploadData.error) {
      alert('Upload failed: ' + uploadData.error.message);
      return;
    }

    // Step 2 — Send metadata to your Flask backend
    // The backend saves the Cloudinary URL and calculates AI score
    const result = await api('/api/document/upload', {
      room_id: SESSION.roomId,
      country: SESSION.country,
      doc_type: docType,
      file_name: file.name,
      public_id: uploadData.public_id,
      download_url: uploadData.secure_url,
      text_sample: ''
      // text_sample is empty here since we can't easily extract
      // text from a PDF in the browser. The AI scorer will get
      // a low score for empty text — acceptable tradeoff.
    });

    if (result.closed) {
      alert('Room is currently closed');
      return;
    }

    // Reset the file input
    fileInput.value = '';
    document.getElementById('file-label').textContent = 'Choose PDF file';
    document.getElementById('file-drop').classList.remove('has-file');

    alert('Document submitted successfully');

  } catch (e) {
    alert('Upload error: ' + e.message);
  } finally {
    // finally always runs whether or not there was an error
    // This ensures the button is always re-enabled
    btn.textContent = 'Submit';
    btn.disabled = false;
  }
}

// ── MY DOCUMENTS ──
function updateMyDocuments(documents) {
  const list = document.getElementById('my-documents');

  // Only show this delegate's documents
  const myDocs = documents.filter(d => d.country === SESSION.country);

  if (!myDocs.length) {
    list.innerHTML = '<div class="empty-msg">Nothing submitted yet</div>';
    return;
  }

  const tagMap = {
    'Position Paper': 'pp',
    'Draft Resolution': 'dr',
    'Working Paper': 'wp',
    'Private Directive': 'pd',
    'Public Directive': 'pd'
  };

  list.innerHTML = myDocs.map(d => `
    <div class="list-row">
      <div>
        <span class="row-tag tag-${tagMap[d.type] || 'pp'}">${d.type}</span>
        <div class="row-main">${d.file_name}</div>
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

  if (!resolution || !text) {
    alert('Please fill in all fields');
    return;
  }

  const result = await api('/api/amendment/submit', {
    room_id: SESSION.roomId,
    country: SESSION.country,
    resolution,
    clause,
    type,
    text
  });

  if (result.closed) {
    alert('Room is currently closed');
    return;
  }

  // Clear form
  document.getElementById('amend-resolution').value = '';
  document.getElementById('amend-clause').value = '';
  document.getElementById('amend-text').value = '';
  alert('Amendment submitted');
}

function updateMyAmendments(amendments) {
  const list = document.getElementById('my-amendments');

  // Only show this delegate's amendments
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

// The status tag shows 'pending', 'accepted' or 'rejected'
// using the CSS classes tag-pending, tag-accepted, tag-rejected
// which we defined in style.css.

// ── MOTIONS ──
window.submitMotion = async function() {
  const type = document.getElementById('del-motion-type').value;
  const details = document.getElementById('del-motion-details').value.trim();

  const result = await api('/api/motion/submit', {
    room_id: SESSION.roomId,
    country: SESSION.country,
    type,
    details
  });

  if (result.closed) {
    alert('Room is currently closed');
    return;
  }

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