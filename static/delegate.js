import { db, fbStorage, containsProfanity, getAiScore, aiScoreClass }
  from './app.js';
import { ref, onValue, push, set, remove }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { ref as sRef, uploadBytes, getDownloadURL }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const roomCode = sessionStorage.getItem('mun_room');
const country = sessionStorage.getItem('mun_name');
const delCode = sessionStorage.getItem('del_code');

// ─── SEND CHIT ──────────────────────────
window.sendChit = async function() {
  const text = document.getElementById('chit-text').value.trim();
  const recipient = document.getElementById('chit-recipient').value;
  const warningEl = document.getElementById('chit-warning');

  if (!text) return;

  // Block if profanity found
  if (containsProfanity(text)) {
    warningEl.style.display = 'block';
    warningEl.textContent = 'Chit blocked — inappropriate language detected.';
    return;
  }
  warningEl.style.display = 'none';

  // Get AI score before sending
  const aiScore = await getAiScore(text);

  // Push chit to Firebase
  await push(ref(db, 'rooms/' + roomCode + '/chits'), {
    from: country, to: recipient, text,
    aiScore, sentAt: Date.now()
  });

  document.getElementById('chit-text').value = '';
};

// ─── MARK CHIT (DELETES IT) ─────────────
window.markChit = async function(chitId) {
  await remove(ref(db, 'rooms/' + roomCode + '/chits/' + chitId));
};

// ─── UPLOAD DOCUMENT ────────────────────
window.uploadDocument = async function() {
  const fileInput = document.getElementById('doc-file');
  const docType = document.getElementById('doc-type').value;
  const file = fileInput.files[0];

  if (!file) { alert('Choose a file first'); return; }
  if (file.type !== 'application/pdf') { alert('Only PDF files are allowed'); return; }

  // Upload to Firebase Storage
  const path = roomCode + '/' + Date.now() + '_' + file.name;
  const fileRef = sRef(fbStorage, 'documents/' + path);
  await uploadBytes(fileRef, file);
  const downloadURL = await getDownloadURL(fileRef);

  // Get AI score on the file name + type as a proxy
  const aiScore = await getAiScore(docType + ' document submitted by ' + country);

  // Save record to Realtime Database
  await push(ref(db, 'rooms/' + roomCode + '/documents'), {
    country, type: docType, fileName: file.name,
    storagePath: path, downloadURL, aiScore, uploadedAt: Date.now()
  });

  fileInput.value = '';
  alert('Document uploaded successfully');
};

// ─── SUBMIT MOTION ───────────────────────
window.submitMotion = async function() {
  const motionType = document.getElementById('motion-type').value;
  const details = document.getElementById('motion-details').value.trim();

  await push(ref(db, 'rooms/' + roomCode + '/motions'), {
    country, type: motionType, details, submittedAt: Date.now()
  });

  document.getElementById('motion-details').value = '';
};

// ─── RAISE POI ───────────────────────────
window.raisePOI = async function() {
  await push(ref(db, 'rooms/' + roomCode + '/pois'), {
    country, raisedAt: Date.now()
  });
};
