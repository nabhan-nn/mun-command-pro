import { db, containsProfanity, getAiScore, aiScoreClass, aiClass, formatTimestamp, motionLabel } from './app.js';
import { ref, onValue, push, set, remove, get }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const roomCode = sessionStorage.getItem('mun_room');
const country = sessionStorage.getItem('mun_country');
const delCode = sessionStorage.getItem('mun_code');
const committee = sessionStorage.getItem('mun_committee');

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

  // Inbox — chits addressed to this delegate
  onValue(ref(db, 'rooms/' + roomCode + '/chits'), snap => {
    const chits = snap.val() || {};
    const inbox = Object.entries(chits)
      .map(([id, d]) => ({id, ...d}))
      .filter(c => c.to === country);
    const sent = Object.entries(chits)
      .map(([id, d]) => ({id, ...d}))
      .filter(c => c.from === country);

    const inboxEl = document.getElementById('del-inbox');
    const sentEl = document.getElementById('del-sent');

    inboxEl.innerHTML = inbox.length ? inbox.map(c => `
      <div class="chit-item">
        <div class="chit-header">
          <span class="chit-route">From <strong>${c.from}</strong></span>
          <span class="chit-time">${formatTimestamp(c.sentAt)}</span>
        </div>
        <div class="chit-body">${c.text}</div>
        <div class="chit-footer">
          <span class="ai-badge ${aiClass(c.aiScore)}">AI: ${c.aiScore}%</span>
          <button class="mark-btn" onclick="markChit('${c.id}')">Mark</button>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No chits received</div>';

    sentEl.innerHTML = sent.length ? sent.map(c => `
      <div class="chit-item">
        <div class="chit-header">
          <span class="chit-route">To <strong>${c.to}</strong></span>
          <span class="chit-time">${formatTimestamp(c.sentAt)}</span>
        </div>
        <div class="chit-body">${c.text}</div>
        <div class="chit-footer">
          <span class="ai-badge ${aiClass(c.aiScore)}">AI: ${c.aiScore}%</span>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No chits sent</div>';

    const badge = document.getElementById('badge-inbox');
    if (badge) {
      badge.textContent = inbox.length;
      badge.classList.toggle('visible', inbox.length > 0);
    }
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

  // ── ROOM CLOSED LISTENER ──
  // If room is deleted, redirect delegate to landing page
  onValue(ref(db, 'rooms/' + roomCode), snap => {
    if (!snap.exists()) {
      alert('This session has been closed by the chair.');
      sessionStorage.clear();
      window.location.href = '/';
    }
  });
});

// ─── SEND CHIT ───────────────────────────
window.sendChit = async function() {
  const text = document.getElementById('chit-text').value.trim();
  const recipient = document.getElementById('chit-recipient').value;
  const warningEl = document.getElementById('chit-warning');

  if (!text) return;

  if (containsProfanity(text)) {
    warningEl.style.display = 'block';
    warningEl.textContent = '⛔ Chit blocked — inappropriate language detected.';
    // Log profanity alert to Firebase for secretariat
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
    // Get your Cloudinary cloud name from a meta tag or hardcode it
    const cloudName = 'dl9npvvln'; // replace with yours
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

    fileInput.value = '';
    alert('Document uploaded successfully');
  } catch (e) {
    alert('Upload error: ' + e.message);
  } finally {
    btn.textContent = 'Submit Document';
    btn.disabled = false;
  }
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

  await push(ref(db, 'rooms/' + roomCode + '/documents'), {
    country,
    type: 'Amendment',
    fileName: `Amendment to ${resolution} — ${clause}`,
    amendType: type,
    text,
    aiScore: 0,
    uploadedAt: Date.now()
  });

  document.getElementById('amend-resolution').value = '';
  document.getElementById('amend-clause').value = '';
  document.getElementById('amend-text').value = '';
  alert('Amendment submitted');
}