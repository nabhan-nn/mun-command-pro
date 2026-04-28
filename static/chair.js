import { db, fbStorage } from './app.js';
import { ref, onValue, push, set, remove }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { ref as sRef, deleteObject }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const roomCode = sessionStorage.getItem('mun_room');

// ─── REAL-TIME LISTENERS ─────────────────
// These fire instantly whenever data changes in Firebase

onValue(ref(db, 'rooms/' + roomCode + '/chits'), snap => {
  const chits = snap.val() || {};
  renderChits(Object.entries(chits).map(([id,d])=>({id,...d})));
});

onValue(ref(db, 'rooms/' + roomCode + '/motions'), snap => {
  const motions = snap.val() || {};
  renderMotions(Object.entries(motions).map(([id,d])=>({id,...d})));
});

onValue(ref(db, 'rooms/' + roomCode + '/documents'), snap => {
  const docs = snap.val() || {};
  renderDocuments(Object.entries(docs).map(([id,d])=>({id,...d})));
});

onValue(ref(db, 'rooms/' + roomCode + '/delegates'), snap => {
  const dels = snap.val() || {};
  renderDelegates(Object.values(dels));
});

onValue(ref(db, 'rooms/' + roomCode + '/speakers'), snap => {
  const speakers = snap.val() || {};
  renderSpeakers(Object.entries(speakers).map(([id,d])=>({id,...d})));
});

onValue(ref(db, 'rooms/' + roomCode + '/pois'), snap => {
  const pois = snap.val() || {};
  renderPOIs(Object.entries(pois).map(([id,d])=>({id,...d})));
});

// ─── DOWNLOAD THEN DELETE DOCUMENT ───────
window.downloadDoc = async function(docId, storagePath, downloadURL, fileName) {
  // Trigger download in browser
  const a = document.createElement('a');
  a.href = downloadURL;
  a.download = fileName;
  a.click();

  // Wait 1 second then delete from Firebase
  setTimeout(async () => {
    await deleteObject(sRef(fbStorage, 'documents/' + storagePath));
    await remove(ref(db, 'rooms/' + roomCode + '/documents/' + docId));
  }, 1000);
};

// ─── MARK CHIT ────────────────────────────
window.markChit = async function(chitId) {
  await remove(ref(db, 'rooms/' + roomCode + '/chits/' + chitId));
};

// ─── ACCEPT / REJECT MOTION ───────────────
window.acceptMotion = async function(motionId) {
  await remove(ref(db, 'rooms/' + roomCode + '/motions/' + motionId));
};
window.rejectMotion = async function(motionId) {
  await remove(ref(db, 'rooms/' + roomCode + '/motions/' + motionId));
};

// ─── DISMISS POI ─────────────────────────
window.dismissPOI = async function(poiId) {
  await remove(ref(db, 'rooms/' + roomCode + '/pois/' + poiId));
};

// ─── ADD SPEAKER ─────────────────────────
window.addSpeaker = async function() {
  const country = document.getElementById('speaker-input').value.trim();
  if (!country) return;
  await push(ref(db, 'rooms/' + roomCode + '/speakers'), {
    country, addedAt: Date.now()
  });
  document.getElementById('speaker-input').value = '';
};

// ─── NEXT SPEAKER ────────────────────────
window.nextSpeaker = async function(speakers) {
  if (!speakers || speakers.length === 0) return;
  const next = speakers[0];
  await set(ref(db, 'rooms/' + roomCode + '/currentSpeaker'), next.country);
  await remove(ref(db, 'rooms/' + roomCode + '/speakers/' + next.id));
};
