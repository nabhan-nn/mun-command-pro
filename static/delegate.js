import { db, containsProfanity, getAiScore, aiScoreClass, aiClass, formatTimestamp, motionLabel } from './app.js';
import { ref, onValue, push, set, remove, get }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const roomCode = sessionStorage.getItem('mun_room');
const country = sessionStorage.getItem('mun_country');
const delCode = sessionStorage.getItem('mun_code');
const committee = sessionStorage.getItem('mun_committee');

let currentThread = null;

window.addEventListener('DOMContentLoaded', () => {
  if (!roomCode || sessionStorage.getItem('mun_role') !== 'delegate') {
    window.location.href = '/';
    return;
  }

  document.getElementById('del-room-code').textContent = roomCode;
  document.getElementById('del-country-display').textContent = country;
  document.getElementById('del-code-display').textContent = delCode;

  // Populate chit recipient dropdown
  onValue(ref(db, 'rooms/' + roomCode + '/delegates'), snap => {
    const dels = snap.val() || {};
    const select = document.getElementById('chit-recipient');
    const current = select.value;
    select.innerHTML = '<option value="Chair">Chair</option>';
    Object.values(dels).forEach(d => {
      if (d.country !== country) {
        const opt = document.createElement('option');
        opt.value = d.country;
        opt.textContent = d.country;
        select.appendChild(opt);
      }
    });
    if (current) select.value = current;
  });

  // Current speaker
  onValue(ref(db, 'rooms/' + roomCode + '/currentSpeaker'), snap => {
    const el = document.getElementById('del-current-speaker');
    if (el) el.textContent = snap.val() || 'Waiting for chair...';
  });

  // Speakers queue
  onValue(ref(db, 'rooms/' + roomCode + '/speakers'), snap => {
    const speakers = snap.val() || {};
    const list = document.getElementById('del-speakers-queue');
    const arr = Object.values(speakers);
    if (!arr.length) {
      list.innerHTML = '<div class="empty-state">No speakers queued</div>';
      return;
    }
    list.innerHTML = arr.map((s, i) => `
      <div class="speaker-item">
        <span><span class="speaker-num">${i+1}.</span>${s.country}</span>
      </div>
    `).join('');
  });

  // Chit conversations — WhatsApp style
  onValue(ref(db, 'rooms/' + roomCode + '/chits'), snap => {
    const chits = snap.val() || {};
    const allChits = Object.entries(chits).map(([id, d]) => ({id, ...d}));

    // My chits = sent or received by me
    const myChits = allChits.filter(c => c.from === country || c.to === country);

    // Group into conversations
    const conversations = {};
    myChits.forEach(c => {
      const other = c.from === country ? c.to : c.from;
      if (!conversations[other]) conversations[other] = [];
      conversations[other].push(c);
    });

    // Sort each conversation by time
    Object.keys(conversations).forEach(k => {
      conversations[k].sort((a, b) => a.sentAt - b.sentAt);
    });

    // Render conversation list
    const convList = document.getElementById('del-conversations');
    const convKeys = Object.keys(conversations);
    if (!convKeys.length) {
      convList.innerHTML = '<div class="empty-state">No messages yet</div>';
    } else {
      convList.innerHTML = convKeys.map(other => {
        const msgs = conversations[other];
        const last = msgs[msgs.length - 1];
        const unread = msgs.filter(m => m.to === country && !m.readByDelegate).length;
        return `
          <div class="conversation-item" onclick="openThread('${other}')">
            <div>
              <div class="conv-name">${other}</div>
              <div class="conv-preview">${last.text.substring(0, 50)}${last.text.length > 50 ? '...' : ''}</div>
            </div>
            ${unread > 0 ? `<span class="conv-badge">${unread}</span>` : ''}
          </div>
        `;
      }).join('');
    }

    // Update thread view if open
    if (currentThread && conversations[currentThread]) {
      renderThread(currentThread, conversations[currentThread]);
    }

    // Badge
    const totalUnread = myChits.filter(m => m.to === country && !m.readByDelegate).length;
    const badge = document.getElementById('badge-inbox');
    if (badge) {
      badge.textContent = totalUnread;
      badge.classList.toggle('visible', totalUnread > 0);
    }

    window._conversations = conversations;
  });

  // Motions
  onValue(ref(db, 'rooms/' + roomCode + '/motions'), snap => {
    const motions = snap.val() || {};
    const list = document.getElementById('del-motions-display');
    const arr = Object.entries(motions).map(([id, d]) => ({id, ...d}));
    list.innerHTML = arr.length ? arr.map(m => `
      <div class="list-row">
        <div>
          <span class="row-tag tag-${m.type}">${motionLabel(m.type)}</span>
          <div class="row-country">${m.country}</div>
          ${m.details ? `<div class="row-detail">${m.details}</div>` : ''}
        </div>
      </div>
    `).join('') : '<div class="empty-state">No motions</div>';
  });

  // My documents
  onValue(ref(db, 'rooms/' + roomCode + '/documents'), snap => {
    const docs = snap.val() || {};
    const myDocs = Object.entries(docs)
      .map(([id, d]) => ({id, ...d}))
      .filter(d => d.country === country);
    const list = document.getElementById('del-my-docs');
    list.innerHTML = myDocs.length ? myDocs.map(d => `
      <div class="list-row">
        <div>
          <span class="row-tag tag-pp">${d.type}</span>
          <div class="row-country">${d.fileName}</div>
          <div class="row-detail">Submitted · waiting for chair</div>
          <span class="ai-badge ${aiClass(d.aiScore)}">AI: ${d.aiScore}%</span>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No documents submitted</div>';
  });

  // File input preview
  const docFileInput = document.getElementById('doc-file');
  if (docFileInput) {
    docFileInput.addEventListener('change', function() {
      const file = this.files[0];
      const preview = document.getElementById('doc-ai-preview');
      const label = document.querySelector('.file-upload-area label');
      if (file) {
        if (label) label.style.display = 'none';
        preview.style.display = 'block';
        preview.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#f7f6f3;border:1.5px solid #ccc;border-radius:6px">
            <span style="font-size:13px">📄 ${file.name}</span>
            <button class="mx" type="button" onclick="clearUploadPreview()">✕</button>
          </div>
        `;
      }
    });
  }

  // Room closed listener
  onValue(ref(db, 'rooms/' + roomCode), snap => {
    if (!snap.exists()) {
      alert('This session has been closed by the chair.');
      sessionStorage.clear();
      window.location.href = '/';
    }
  });
});

// ─── THREAD FUNCTIONS ────────────────────
window.openThread = function(other) {
  currentThread = other;
  document.getElementById('thread-panel').style.display = 'block';
  document.getElementById('thread-title').textContent = other;
  const msgs = window._conversations?.[other] || [];
  renderThread(other, msgs);

  // Mark as read
  msgs.filter(m => m.to === country && !m.readByDelegate).forEach(async m => {
    await set(ref(db, 'rooms/' + roomCode + '/chits/' + m.id + '/readByDelegate'), true);
  });
}

window.closeThread = function() {
  currentThread = null;
  document.getElementById('thread-panel').style.display = 'none';
}

function renderThread(other, msgs) {
  const container = document.getElementById('thread-messages');
  container.innerHTML = msgs.map(m => {
    const isSent = m.from === country;
    return `
      <div>
        <div class="thread-msg ${isSent ? 'sent' : 'received'}">
          ${m.text}
          <div class="thread-msg-meta">
            ${m.aiScore !== undefined && m.aiScore > 0 ? `AI: ${m.aiScore}% · ` : ''}${formatTimestamp(m.sentAt)}
          </div>
        </div>
      </div>
    `;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

window.sendReply = async function() {
  if (!currentThread) return;
  const text = document.getElementById('thread-reply-text').value.trim();
  if (!text) return;

  if (containsProfanity(text)) {
    alert('Message blocked — inappropriate language.');
    return;
  }

  const aiScore = await getAiScore(text);
  await push(ref(db, 'rooms/' + roomCode + '/chits'), {
    from: country,
    to: currentThread,
    text,
    aiScore,
    sentAt: Date.now()
  });

  document.getElementById('thread-reply-text').value = '';
}

// ─── SEND CHIT ───────────────────────────
window.sendChit = async function() {
  const text = document.getElementById('chit-text').value.trim();
  const recipient = document.getElementById('chit-recipient').value;
  const warningEl = document.getElementById('chit-warning');

  if (!text) return;

  if (containsProfanity(text)) {
    warningEl.style.display = 'block';
    warningEl.textContent = '⛔ Chit blocked — inappropriate language detected.';
    await push(ref(db, 'rooms/' + roomCode + '/profanityAlerts'), {
      country, text, blockedAt: Date.now()
    });
    return;
  }

  warningEl.style.display = 'none';
  const aiScore = await getAiScore(text);

  await push(ref(db, 'rooms/' + roomCode + '/chits'), {
    from: country,
    to: recipient,
    text,
    aiScore,
    sentAt: Date.now()
  });

  document.getElementById('chit-text').value = '';
}

// ─── MARK CHIT ───────────────────────────
window.markChit = async function(id) {
  await remove(ref(db, 'rooms/' + roomCode + '/chits/' + id));
}

// ─── UPLOAD DOCUMENT ─────────────────────
window.uploadDocument = async function() {
  const fileInput = document.getElementById('doc-file');
  const docType = document.getElementById('doc-type').value;
  const file = fileInput.files[0];
  const btn = document.querySelector('#tab-documents .btn-solid');

  if (!file) { alert('Choose a PDF file first'); return; }
  if (file.type !== 'application/pdf') { alert('Only PDF files allowed'); return; }

  btn.textContent = 'Uploading...';
  btn.disabled = true;

  try {
    const cloudName = 'dl9npvvln';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'mun_documents');
    formData.append('resource_type', 'raw');

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
      { method: 'POST', body: formData }
    );
    const data = await res.json();

    if (data.error) { alert('Upload failed: ' + data.error.message); return; }

    const aiScore = await getAiScore(docType + ' submitted by ' + country);

    await push(ref(db, 'rooms/' + roomCode + '/documents'), {
      country,
      type: docType,
      fileName: file.name,
      publicId: data.public_id,
      downloadURL: data.secure_url,
      aiScore,
      uploadedAt: Date.now()
    });

    const preview = document.getElementById('doc-ai-preview');
    const label = document.querySelector('.file-upload-area label');
    if (label) label.style.display = 'none';
    preview.style.display = 'block';
    preview.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#E1F5EE;border:1.5px solid #1D9E75;border-radius:6px">
        <span style="font-size:13px">✅ ${file.name} uploaded</span>
        <span class="ai-badge ${aiScoreClass(aiScore)}">AI: ${aiScore}%</span>
        <button class="mx" type="button" onclick="clearUploadPreview()">✕</button>
      </div>
    `;

  } catch (e) {
    alert('Upload error: ' + e.message);
  } finally {
    btn.textContent = 'Submit Document';
    btn.disabled = false;
  }
}

// ─── CLEAR UPLOAD PREVIEW ────────────────
window.clearUploadPreview = function() {
  document.getElementById('doc-file').value = '';
  const preview = document.getElementById('doc-ai-preview');
  preview.style.display = 'none';
  preview.innerHTML = '';
  const label = document.querySelector('.file-upload-area label');
  if (label) label.style.display = 'block';
}

// ─── RAISE POI ───────────────────────────
window.raisePOI = async function() {
  await push(ref(db, 'rooms/' + roomCode + '/pois'), {
    country, raisedAt: Date.now()
  });
}

// ─── SUBMIT MOTION ───────────────────────
window.submitMotion = async function() {
  const type = document.getElementById('motion-type').value;
  const details = document.getElementById('motion-details').value.trim();
  await push(ref(db, 'rooms/' + roomCode + '/motions'), {
    country, type, details, submittedAt: Date.now()
  });
  document.getElementById('motion-details').value = '';
}

// ─── SUBMIT AMENDMENT ────────────────────
window.submitAmendment = async function() {
  const resolution = document.getElementById('amend-resolution').value.trim();
  const clause = document.getElementById('amend-clause').value.trim();
  const type = document.getElementById('amend-type').value;
  const text = document.getElementById('amend-text').value.trim();

  if (!resolution || !text) { alert('Fill in all fields'); return; }

  await push(ref(db, 'rooms/' + roomCode + '/chits'), {
    from: country,
    to: 'Chair',
    text: `[AMENDMENT — ${type}] Resolution: ${resolution} | Clause: ${clause} | Proposed text: ${text}`,
    aiScore: 0,
    isAmendment: true,
    amendType: type,
    sentAt: Date.now()
  });

  document.getElementById('amend-resolution').value = '';
  document.getElementById('amend-clause').value = '';
  document.getElementById('amend-text').value = '';
  alert('Amendment submitted to chair');
}