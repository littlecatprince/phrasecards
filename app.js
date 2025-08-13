// Phrase Cards app
// This script provides a lightweight, client-side application for
// managing audio phrases. Users can upload an audio file, define
// a start and end time for the phrase, annotate it with metadata,
// track practice sessions, and store everything in the browser via
// IndexedDB. The app is designed to run completely offline and can
// be installed on iOS/Android as a PWA.

let db = null;
let selectedFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Register service worker for offline support
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }
  // Show install prompt if not dismissed before
  if (!localStorage.getItem('installPromptDismissed')) {
    const promptEl = document.getElementById('installPrompt');
    if (promptEl) promptEl.classList.remove('hidden');
  }
  // Handle dismiss install prompt
  const dismissBtn = document.getElementById('dismissInstall');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      const promptEl = document.getElementById('installPrompt');
      if (promptEl) promptEl.classList.add('hidden');
      localStorage.setItem('installPromptDismissed', '1');
    });
  }
  // Open database and load cards
  await openDB();
  await loadCards();
  // Attach handler to Add New Card button
  const addBtn = document.getElementById('addCardBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      showAddView();
    });
  }
});

/* Database helper functions */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('phrasecards', 1);
    request.onupgradeneeded = e => {
      const dbRef = e.target.result;
      // Cards store holds card metadata and sessions
      if (!dbRef.objectStoreNames.contains('cards')) {
        dbRef.createObjectStore('cards', { keyPath: 'id' });
      }
      // Blobs store holds the audio blobs keyed by card id
      if (!dbRef.objectStoreNames.contains('blobs')) {
        dbRef.createObjectStore('blobs');
      }
    };
    request.onsuccess = e => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = e => {
      reject(e);
    };
  });
}

function getAllCards() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readonly');
    const store = tx.objectStore('cards');
    const req = store.getAll();
    req.onsuccess = () => {
      resolve(req.result || []);
    };
    req.onerror = () => reject(req.error);
  });
}

function getCard(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readonly');
    const store = tx.objectStore('cards');
    const req = store.get(id);
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function getBlob(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readonly');
    const store = tx.objectStore('blobs');
    const req = store.get(id);
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function saveCard(card, blob) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards', 'blobs'], 'readwrite');
    const cardStore = tx.objectStore('cards');
    const blobStore = tx.objectStore('blobs');
    if (blob) {
      const blobKey = card.id;
      blobStore.put(blob, blobKey);
      card.audioBlobId = blobKey;
    }
    // Always update updatedAt on save
    card.updatedAt = Date.now();
    cardStore.put(card);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteCard(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards', 'blobs'], 'readwrite');
    const cardStore = tx.objectStore('cards');
    const blobStore = tx.objectStore('blobs');
    cardStore.delete(id);
    blobStore.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* UI rendering functions */

async function loadCards() {
  const cards = await getAllCards();
  renderCardList(cards);
}

function renderCardList(cards) {
  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '';
  if (!cards || cards.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No cards yet. Click "Add New Card" to create one.';
    main.appendChild(p);
    return;
  }
  const list = document.createElement('div');
  list.className = 'card-list';
  // Sort by updatedAt desc
  cards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  cards.forEach(card => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    // Title
    const h3 = document.createElement('h3');
    h3.textContent = card.title || 'Untitled';
    h3.style.cursor = 'pointer';
    h3.addEventListener('click', () => viewCard(card.id));
    cardDiv.appendChild(h3);
    // Progress badges
    const progressDiv = document.createElement('div');
    progressDiv.className = 'progress';
    const circBadge = document.createElement('span');
    circBadge.className = 'badge ' + (card.mastery?.circleOfFifths || 'not_started');
    circBadge.textContent = 'Circle: ' + (card.mastery?.circleOfFifths || 'not_started');
    const chromBadge = document.createElement('span');
    chromBadge.className = 'badge ' + (card.mastery?.chromatic || 'not_started');
    chromBadge.textContent = 'Chromatic: ' + (card.mastery?.chromatic || 'not_started');
    progressDiv.appendChild(circBadge);
    progressDiv.appendChild(chromBadge);
    cardDiv.appendChild(progressDiv);
    // Max tempo
    let maxTempo = 0;
    if (Array.isArray(card.sessions)) {
      card.sessions.forEach(sess => {
        if (Array.isArray(sess.temposAchieved)) {
          const localMax = Math.max(...sess.temposAchieved, 0);
          if (localMax > maxTempo) maxTempo = localMax;
        }
      });
    }
    const tempoP = document.createElement('p');
    tempoP.textContent = maxTempo > 0 ? `Max Tempo: ${maxTempo} BPM` : 'No sessions';
    cardDiv.appendChild(tempoP);
    list.appendChild(cardDiv);
  });
  main.appendChild(list);
}

function showAddView() {
  const main = document.getElementById('main');
  if (!main) return;
  selectedFile = null;
  main.innerHTML = '';
  // Form container
  const container = document.createElement('div');
  // Header
  const h2 = document.createElement('h2');
  h2.textContent = 'Add New Card';
  container.appendChild(h2);
  // File input
  const fileGroup = document.createElement('div');
  fileGroup.className = 'form-group';
  const fileLabel = document.createElement('label');
  fileLabel.textContent = 'Audio File';
  fileLabel.setAttribute('for', 'fileInput');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  fileInput.id = 'fileInput';
  fileGroup.appendChild(fileLabel);
  fileGroup.appendChild(fileInput);
  container.appendChild(fileGroup);
  // Audio preview
  const audioPreview = document.createElement('audio');
  audioPreview.controls = true;
  audioPreview.id = 'audioPreview';
  audioPreview.classList.add('hidden');
  container.appendChild(audioPreview);
  // Trim inputs
  const trimGroup = document.createElement('div');
  trimGroup.className = 'form-group';
  const trimLabel = document.createElement('label');
  trimLabel.textContent = 'Trim Start & End (sec)';
  trimGroup.appendChild(trimLabel);
  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.step = '0.01';
  startInput.min = '0';
  startInput.id = 'startSec';
  startInput.value = '0';
  const endInput = document.createElement('input');
  endInput.type = 'number';
  endInput.step = '0.01';
  endInput.min = '0';
  endInput.id = 'endSec';
  endInput.value = '0';
  trimGroup.appendChild(startInput);
  trimGroup.appendChild(endInput);
  container.appendChild(trimGroup);
  // Title
  const titleGroup = document.createElement('div');
  titleGroup.className = 'form-group';
  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Title';
  titleLabel.setAttribute('for', 'titleInput');
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = 'titleInput';
  titleGroup.appendChild(titleLabel);
  titleGroup.appendChild(titleInput);
  container.appendChild(titleGroup);
  // Source
  const sourceGroup = document.createElement('div');
  sourceGroup.className = 'form-group';
  const sourceLabel = document.createElement('label');
  sourceLabel.textContent = 'Source (optional)';
  sourceLabel.setAttribute('for', 'sourceInput');
  const sourceInput = document.createElement('input');
  sourceInput.type = 'text';
  sourceInput.id = 'sourceInput';
  sourceGroup.appendChild(sourceLabel);
  sourceGroup.appendChild(sourceInput);
  container.appendChild(sourceGroup);
  // BPM Target
  const bpmGroup = document.createElement('div');
  bpmGroup.className = 'form-group';
  const bpmLabel = document.createElement('label');
  bpmLabel.textContent = 'Target BPM (optional)';
  bpmLabel.setAttribute('for', 'bpmTarget');
  const bpmInput = document.createElement('input');
  bpmInput.type = 'number';
  bpmInput.id = 'bpmTarget';
  bpmInput.min = '0';
  bpmGroup.appendChild(bpmLabel);
  bpmGroup.appendChild(bpmInput);
  container.appendChild(bpmGroup);
  // Comments
  const commentsGroup = document.createElement('div');
  commentsGroup.className = 'form-group';
  const commentsLabel = document.createElement('label');
  commentsLabel.textContent = 'Comments';
  commentsLabel.setAttribute('for', 'commentsInput');
  const commentsInput = document.createElement('textarea');
  commentsInput.id = 'commentsInput';
  commentsGroup.appendChild(commentsLabel);
  commentsGroup.appendChild(commentsInput);
  container.appendChild(commentsGroup);
  // Tags
  const tagsGroup = document.createElement('div');
  tagsGroup.className = 'form-group';
  const tagsLabel = document.createElement('label');
  tagsLabel.textContent = 'Tags (comma separated)';
  tagsLabel.setAttribute('for', 'tagsInput');
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.id = 'tagsInput';
  tagsGroup.appendChild(tagsLabel);
  tagsGroup.appendChild(tagsInput);
  container.appendChild(tagsGroup);
  // Mastery statuses
  const masteryGroup = document.createElement('div');
  masteryGroup.className = 'form-group';
  const masteryLabel = document.createElement('label');
  masteryLabel.textContent = 'Mastery';
  masteryGroup.appendChild(masteryLabel);
  // Circle
  const circleLabel = document.createElement('label');
  circleLabel.textContent = 'Circle of Fifths';
  circleLabel.setAttribute('for', 'circleStatus');
  const circleSelect = document.createElement('select');
  circleSelect.id = 'circleStatus';
  ['not_started','in_progress','mastered'].forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    circleSelect.appendChild(opt);
  });
  masteryGroup.appendChild(circleLabel);
  masteryGroup.appendChild(circleSelect);
  // Chromatic
  const chromLabel = document.createElement('label');
  chromLabel.textContent = 'Chromatic';
  chromLabel.setAttribute('for', 'chromStatus');
  const chromSelect = document.createElement('select');
  chromSelect.id = 'chromStatus';
  ['not_started','in_progress','mastered'].forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    chromSelect.appendChild(opt);
  });
  masteryGroup.appendChild(chromLabel);
  masteryGroup.appendChild(chromSelect);
  container.appendChild(masteryGroup);
  // Buttons
  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'button-group';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.type = 'button';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.type = 'button';
  buttonGroup.appendChild(saveBtn);
  buttonGroup.appendChild(cancelBtn);
  container.appendChild(buttonGroup);
  main.appendChild(container);
  // Event listeners
  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    selectedFile = file;
    const url = URL.createObjectURL(file);
    audioPreview.src = url;
    audioPreview.classList.remove('hidden');
    // Wait for metadata to set duration
    audioPreview.onloadedmetadata = () => {
      const duration = audioPreview.duration;
      startInput.value = '0';
      startInput.min = '0';
      startInput.max = duration.toFixed(2);
      endInput.value = duration.toFixed(2);
      endInput.min = '0';
      endInput.max = duration.toFixed(2);
    };
    audioPreview.load();
  });
  saveBtn.addEventListener('click', async () => {
    if (!selectedFile) {
      alert('Please choose an audio file.');
      return;
    }
    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const title = titleInput.value.trim();
    const source = sourceInput.value.trim();
    const bpmTarget = bpmInput.value ? parseInt(bpmInput.value, 10) : null;
    const comments = commentsInput.value.trim();
    const tags = tagsInput.value.trim() ? tagsInput.value.split(',').map(t => t.trim()).filter(t => t) : [];
    const startSecVal = parseFloat(startInput.value) || 0;
    const endSecVal = parseFloat(endInput.value) || 0;
    if (startSecVal < 0 || endSecVal <= 0 || endSecVal <= startSecVal) {
      alert('Please enter valid start and end times.');
      return;
    }
    const card = {
      id: id,
      title: title,
      source: source || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      audioBlobId: '',
      trim: { startSec: startSecVal, endSec: endSecVal },
      bpmTarget: bpmTarget || undefined,
      comments: comments || undefined,
      tags: tags,
      mastery: {
        circleOfFifths: circleSelect.value,
        chromatic: chromSelect.value
      },
      sessions: []
    };
    try {
      await saveCard(card, selectedFile);
      selectedFile = null;
      await loadCards();
    } catch (err) {
      console.error('Error saving card', err);
      alert('Failed to save card.');
    }
  });
  cancelBtn.addEventListener('click', () => {
    selectedFile = null;
    loadCards();
  });
}

async function viewCard(id) {
  const main = document.getElementById('main');
  if (!main) return;
  const card = await getCard(id);
  if (!card) {
    await loadCards();
    return;
  }
  const blob = await getBlob(card.audioBlobId);
  const url = blob ? URL.createObjectURL(blob) : '';
  main.innerHTML = '';
  const container = document.createElement('div');
  // Header with title and delete button
  const headerDiv = document.createElement('div');
  headerDiv.style.display = 'flex';
  headerDiv.style.justifyContent = 'space-between';
  headerDiv.style.alignItems = 'center';
  const h2 = document.createElement('h2');
  h2.textContent = card.title || 'Untitled';
  headerDiv.appendChild(h2);
  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.style.background = '#f44336';
  delBtn.style.color = 'white';
  delBtn.style.border = 'none';
  delBtn.style.padding = '6px 10px';
  delBtn.style.borderRadius = '4px';
  delBtn.style.cursor = 'pointer';
  headerDiv.appendChild(delBtn);
  container.appendChild(headerDiv);
  // Audio preview and play trimmed
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = url;
  audio.style.display = 'block';
  audio.style.marginBottom = '8px';
  container.appendChild(audio);
  const playTrimBtn = document.createElement('button');
  playTrimBtn.textContent = 'Play Trimmed Section';
  playTrimBtn.type = 'button';
  playTrimBtn.style.marginBottom = '12px';
  container.appendChild(playTrimBtn);
  // Edit metadata form
  const formDiv = document.createElement('div');
  formDiv.className = 'form-group';
  // Start & End editing
  const trimEditGroup = document.createElement('div');
  trimEditGroup.className = 'form-group';
  const trimEditLabel = document.createElement('label');
  trimEditLabel.textContent = 'Trim Start & End (sec)';
  trimEditGroup.appendChild(trimEditLabel);
  const startEdit = document.createElement('input');
  startEdit.type = 'number';
  startEdit.step = '0.01';
  startEdit.min = '0';
  startEdit.value = card.trim?.startSec ?? 0;
  const endEdit = document.createElement('input');
  endEdit.type = 'number';
  endEdit.step = '0.01';
  endEdit.min = '0';
  endEdit.value = card.trim?.endSec ?? 0;
  trimEditGroup.appendChild(startEdit);
  trimEditGroup.appendChild(endEdit);
  formDiv.appendChild(trimEditGroup);
  // Title
  const titleGroup = document.createElement('div');
  titleGroup.className = 'form-group';
  const titleLbl = document.createElement('label');
  titleLbl.textContent = 'Title';
  const titleEdit = document.createElement('input');
  titleEdit.type = 'text';
  titleEdit.value = card.title || '';
  titleGroup.appendChild(titleLbl);
  titleGroup.appendChild(titleEdit);
  formDiv.appendChild(titleGroup);
  // Source
  const sourceGroup = document.createElement('div');
  sourceGroup.className = 'form-group';
  const sourceLbl = document.createElement('label');
  sourceLbl.textContent = 'Source (optional)';
  const sourceEdit = document.createElement('input');
  sourceEdit.type = 'text';
  sourceEdit.value = card.source || '';
  sourceGroup.appendChild(sourceLbl);
  sourceGroup.appendChild(sourceEdit);
  formDiv.appendChild(sourceGroup);
  // BPM target
  const bpmGroup = document.createElement('div');
  bpmGroup.className = 'form-group';
  const bpmLbl = document.createElement('label');
  bpmLbl.textContent = 'Target BPM (optional)';
  const bpmEdit = document.createElement('input');
  bpmEdit.type = 'number';
  bpmEdit.min = '0';
  bpmEdit.value = card.bpmTarget || '';
  bpmGroup.appendChild(bpmLbl);
  bpmGroup.appendChild(bpmEdit);
  formDiv.appendChild(bpmGroup);
  // Comments
  const commentsGroup = document.createElement('div');
  commentsGroup.className = 'form-group';
  const commentsLbl = document.createElement('label');
  commentsLbl.textContent = 'Comments';
  const commentsEdit = document.createElement('textarea');
  commentsEdit.value = card.comments || '';
  commentsGroup.appendChild(commentsLbl);
  commentsGroup.appendChild(commentsEdit);
  formDiv.appendChild(commentsGroup);
  // Tags
  const tagsGroup = document.createElement('div');
  tagsGroup.className = 'form-group';
  const tagsLbl = document.createElement('label');
  tagsLbl.textContent = 'Tags (comma separated)';
  const tagsEdit = document.createElement('input');
  tagsEdit.type = 'text';
  tagsEdit.value = Array.isArray(card.tags) ? card.tags.join(', ') : '';
  tagsGroup.appendChild(tagsLbl);
  tagsGroup.appendChild(tagsEdit);
  formDiv.appendChild(tagsGroup);
  // Mastery statuses
  const masteryGroup = document.createElement('div');
  masteryGroup.className = 'form-group';
  const masteryLbl = document.createElement('label');
  masteryLbl.textContent = 'Mastery';
  masteryGroup.appendChild(masteryLbl);
  const circleSelect = document.createElement('select');
  ['not_started','in_progress','mastered'].forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    if (card.mastery?.circleOfFifths === val) opt.selected = true;
    circleSelect.appendChild(opt);
  });
  const chromSelect = document.createElement('select');
  ['not_started','in_progress','mastered'].forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    if (card.mastery?.chromatic === val) opt.selected = true;
    chromSelect.appendChild(opt);
  });
  const circleLbl = document.createElement('label');
  circleLbl.textContent = 'Circle of Fifths';
  const chromLbl = document.createElement('label');
  chromLbl.textContent = 'Chromatic';
  masteryGroup.appendChild(circleLbl);
  masteryGroup.appendChild(circleSelect);
  masteryGroup.appendChild(chromLbl);
  masteryGroup.appendChild(chromSelect);
  formDiv.appendChild(masteryGroup);
  // Save metadata button
  const metaBtnGroup = document.createElement('div');
  metaBtnGroup.className = 'button-group';
  const saveMetaBtn = document.createElement('button');
  saveMetaBtn.textContent = 'Save Changes';
  saveMetaBtn.type = 'button';
  metaBtnGroup.appendChild(saveMetaBtn);
  formDiv.appendChild(metaBtnGroup);
  container.appendChild(formDiv);
  // Sessions section
  const sessionSection = document.createElement('div');
  sessionSection.id = 'sessionSection';
  const sessionHeader = document.createElement('h3');
  sessionHeader.textContent = 'Practice Sessions';
  sessionSection.appendChild(sessionHeader);
  // Add Session button
  const addSessBtn = document.createElement('button');
  addSessBtn.textContent = 'Add Session';
  addSessBtn.type = 'button';
  addSessBtn.style.marginBottom = '10px';
  sessionSection.appendChild(addSessBtn);
  // Sessions list
  const sessList = document.createElement('div');
  if (Array.isArray(card.sessions) && card.sessions.length > 0) {
    card.sessions.sort((a,b) => (b.date || 0) - (a.date || 0));
    card.sessions.forEach(sess => {
      const sessDiv = document.createElement('div');
      sessDiv.style.borderBottom = '1px solid #ddd';
      sessDiv.style.padding = '6px 0';
      const date = new Date(sess.date);
      const dateStr = date.toLocaleString();
      const tempoStr = (sess.temposAchieved || []).join(', ');
      const p = document.createElement('p');
      p.innerHTML = `<strong>${dateStr}</strong> — Mode: ${sess.mode} — Tempos: ${tempoStr || '—'} — Errors: ${sess.errorRate || 0}%`;
      if (sess.notes) {
        const notesP = document.createElement('p');
        notesP.textContent = 'Notes: ' + sess.notes;
        notesP.style.fontSize = '0.9rem';
        sessDiv.appendChild(p);
        sessDiv.appendChild(notesP);
      } else {
        sessDiv.appendChild(p);
      }
      sessList.appendChild(sessDiv);
    });
  } else {
    const p = document.createElement('p');
    p.textContent = 'No sessions yet.';
    sessList.appendChild(p);
  }
  sessionSection.appendChild(sessList);
  container.appendChild(sessionSection);
  main.appendChild(container);
  // Event handlers
  delBtn.addEventListener('click', async () => {
    if (confirm('Delete this card?')) {
      await deleteCard(card.id);
      await loadCards();
    }
  });
  playTrimBtn.addEventListener('click', () => {
    if (!audio || !card.trim) return;
    const startT = parseFloat(startEdit.value) || 0;
    const endT = parseFloat(endEdit.value) || 0;
    if (endT <= startT) {
      alert('Invalid trim times.');
      return;
    }
    audio.currentTime = startT;
    audio.play();
    const onTime = () => {
      if (audio.currentTime >= endT) {
        audio.pause();
        audio.removeEventListener('timeupdate', onTime);
      }
    };
    audio.addEventListener('timeupdate', onTime);
  });
  saveMetaBtn.addEventListener('click', async () => {
    const newStart = parseFloat(startEdit.value) || 0;
    const newEnd = parseFloat(endEdit.value) || 0;
    if (newEnd <= newStart) {
      alert('End must be greater than start.');
      return;
    }
    card.title = titleEdit.value.trim() || '';
    card.source = sourceEdit.value.trim() || undefined;
    card.bpmTarget = bpmEdit.value ? parseInt(bpmEdit.value, 10) : undefined;
    card.comments = commentsEdit.value.trim() || undefined;
    const tgs = tagsEdit.value.trim() ? tagsEdit.value.split(',').map(t => t.trim()).filter(t => t) : [];
    card.tags = tgs;
    card.mastery = {
      circleOfFifths: circleSelect.value,
      chromatic: chromSelect.value
    };
    card.trim = { startSec: newStart, endSec: newEnd };
    try {
      await saveCard(card, null);
      // reload card
      await viewCard(card.id);
    } catch (err) {
      console.error('Error updating card', err);
      alert('Failed to update.');
    }
  });
  addSessBtn.addEventListener('click', () => {
    showAddSessionForm(card);
  });
}

function showAddSessionForm(card) {
  const main = document.getElementById('main');
  if (!main) return;
  // Create overlay or reuse session section
  const section = document.createElement('div');
  section.className = 'form-group';
  const h3 = document.createElement('h3');
  h3.textContent = 'New Practice Session';
  section.appendChild(h3);
  // Mode select
  const modeGroup = document.createElement('div');
  modeGroup.className = 'form-group';
  const modeLbl = document.createElement('label');
  modeLbl.textContent = 'Mode';
  const modeSelect = document.createElement('select');
  ['circleOfFifths','chromatic','free'].forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    modeSelect.appendChild(opt);
  });
  modeGroup.appendChild(modeLbl);
  modeGroup.appendChild(modeSelect);
  section.appendChild(modeGroup);
  // Tempos checkboxes
  const temposGroup = document.createElement('div');
  temposGroup.className = 'form-group';
  const temposLbl = document.createElement('label');
  temposLbl.textContent = 'Tempos Achieved';
  temposGroup.appendChild(temposLbl);
  const tempoValues = [];
  for (let bpm = 40; bpm <= 240; bpm += 10) {
    tempoValues.push(bpm);
  }
  const tempoContainer = document.createElement('div');
  tempoContainer.style.display = 'flex';
  tempoContainer.style.flexWrap = 'wrap';
  tempoContainer.style.gap = '6px';
  tempoValues.forEach(val => {
    const span = document.createElement('span');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = val;
    cb.name = 'tempo';
    const lbl = document.createElement('label');
    lbl.textContent = val;
    lbl.style.marginRight = '4px';
    span.appendChild(cb);
    span.appendChild(lbl);
    tempoContainer.appendChild(span);
  });
  temposGroup.appendChild(tempoContainer);
  section.appendChild(temposGroup);
  // Error rate
  const errGroup = document.createElement('div');
  errGroup.className = 'form-group';
  const errLbl = document.createElement('label');
  errLbl.textContent = 'Error Rate (%)';
  const errInput = document.createElement('input');
  errInput.type = 'number';
  errInput.min = '0';
  errInput.max = '100';
  errInput.value = '0';
  errGroup.appendChild(errLbl);
  errGroup.appendChild(errInput);
  section.appendChild(errGroup);
  // Notes
  const notesGroup = document.createElement('div');
  notesGroup.className = 'form-group';
  const notesLbl = document.createElement('label');
  notesLbl.textContent = 'Notes (optional)';
  const notesInput = document.createElement('textarea');
  notesGroup.appendChild(notesLbl);
  notesGroup.appendChild(notesInput);
  section.appendChild(notesGroup);
  // Buttons
  const btnGroup = document.createElement('div');
  btnGroup.className = 'button-group';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Session';
  saveBtn.type = 'button';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.type = 'button';
  btnGroup.appendChild(saveBtn);
  btnGroup.appendChild(cancelBtn);
  section.appendChild(btnGroup);
  // Render this section in main (replace existing content)
  main.innerHTML = '';
  main.appendChild(section);
  // Save handler
  saveBtn.addEventListener('click', async () => {
    const mode = modeSelect.value;
    const tempos = Array.from(tempoContainer.querySelectorAll('input[name="tempo"]:checked')).map(el => parseInt(el.value, 10));
    const errorRate = errInput.value ? parseFloat(errInput.value) : 0;
    const notes = notesInput.value.trim() || undefined;
    const session = {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      cardId: card.id,
      date: Date.now(),
      temposAchieved: tempos,
      errorRate: errorRate,
      mode: mode,
      notes: notes
    };
    card.sessions = Array.isArray(card.sessions) ? card.sessions : [];
    card.sessions.push(session);
    try {
      await saveCard(card, null);
      await viewCard(card.id);
    } catch (err) {
      console.error('Error saving session', err);
      alert('Failed to save session.');
    }
  });
  cancelBtn.addEventListener('click', async () => {
    await viewCard(card.id);
  });
}