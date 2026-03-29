import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import firebaseConfig from "./firebase-config.js";
import { initDragAndDrop } from "./drag.js";

// ===== Firebase Init =====
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

enableIndexedDbPersistence(db).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Offline persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Offline persistence not supported in this browser');
  }
});

const BOARD_ID = "cafardland";
let tasksRef = null;
let unsubscribeSnapshot = null;

// ===== State =====
let tasks = new Map();
let isDragging = false;
let pendingSnapshot = null;
let activeTab = "todo";
let currentUser = null;
let dedupDone = false;

// ===== DOM Elements =====
const loginScreen = document.getElementById("loginScreen");
const appContainer = document.getElementById("appContainer");
const btnLogin = document.getElementById("btnLogin");
const loginError = document.getElementById("loginError");

const board = document.getElementById("board");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const inputTitle = document.getElementById("inputTitle");
const inputDesc = document.getElementById("inputDesc");
const inputWhen = document.getElementById("inputWhen");
const btnAdd = document.getElementById("btnAdd");
const btnSave = document.getElementById("btnSave");
const btnCancel = document.getElementById("btnCancel");
const btnDelete = document.getElementById("btnDelete");
const statusDot = document.getElementById("statusDot");
const tabBar = document.getElementById("tabBar");
const fab = document.getElementById("fab");

let editingTaskId = null;

// ===== Auth =====

// Start hidden — show nothing until auth state is known
loginScreen.classList.add("hidden");
appContainer.classList.add("hidden");

btnLogin.addEventListener("click", async () => {
  loginError.classList.add("hidden");
  btnLogin.disabled = true;
  btnLogin.style.opacity = "0.5";
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error("Auth error:", err);
    if (err.code === 'auth/popup-blocked') {
      loginError.textContent = "Popup bloquee. Autorise les popups pour ce site.";
    } else if (err.code === 'auth/popup-closed-by-user') {
      // User closed it, no error to show
    } else {
      loginError.textContent = "Erreur de connexion. Reessaie.";
    }
    loginError.classList.remove("hidden");
  } finally {
    btnLogin.disabled = false;
    btnLogin.style.opacity = "";
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    console.log("Connecte:", user.email, "| UID:", user.uid);
    loginScreen.classList.add("hidden");
    appContainer.classList.remove("hidden");
    startFirestore();
  } else {
    currentUser = null;
    loginScreen.classList.remove("hidden");
    appContainer.classList.add("hidden");
    stopFirestore();
  }
});

function startFirestore() {
  tasksRef = collection(db, "boards", BOARD_ID, "tasks");
  const q = query(tasksRef, orderBy("order"));
  unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
    if (isDragging) {
      pendingSnapshot = snapshot;
      return;
    }
    applySnapshot(snapshot);
  }, (error) => {
    console.error("Firestore error:", error);
  });
}

function stopFirestore() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
  tasks.clear();
}

// ===== Online/Offline Status =====
function updateOnlineStatus() {
  const online = navigator.onLine;
  statusDot.classList.toggle("offline", !online);
  statusDot.title = online ? "En ligne" : "Hors ligne";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ===== Mobile Tabs =====
function switchTab(column) {
  activeTab = column;
  tabBar.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === column);
  });
  document.querySelectorAll(".column").forEach(col => {
    col.classList.toggle("mobile-active", col.dataset.column === column);
  });
}

tabBar.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  switchTab(tab.dataset.tab);
});

switchTab("todo");

// ===== Render =====
function renderBoard() {
  const columns = { todo: [], doing: [], done: [] };

  for (const [id, task] of tasks) {
    const col = columns[task.column];
    if (col) col.push({ id, ...task });
  }

  for (const col of Object.keys(columns)) {
    columns[col].sort((a, b) => a.order - b.order);

    const container = document.querySelector(`[data-cards="${col}"]`);
    const countEl = document.querySelector(`[data-count="${col}"]`);
    const tabCountEl = document.querySelector(`[data-tab-count="${col}"]`);
    countEl.textContent = columns[col].length;
    if (tabCountEl) tabCountEl.textContent = columns[col].length;

    const existingIds = new Set();
    columns[col].forEach(task => existingIds.add(task.id));

    container.querySelectorAll(".card").forEach(card => {
      if (!existingIds.has(card.dataset.id)) card.remove();
    });

    let prevEl = null;
    for (const task of columns[col]) {
      let card = container.querySelector(`[data-id="${task.id}"]`);
      if (!card) {
        card = createCardElement(task);
        if (prevEl && prevEl.nextSibling) {
          container.insertBefore(card, prevEl.nextSibling);
        } else if (!prevEl) {
          container.prepend(card);
        } else {
          container.appendChild(card);
        }
      } else {
        updateCardElement(card, task);
        if (prevEl && prevEl.nextSibling !== card) {
          container.insertBefore(card, prevEl.nextSibling);
        } else if (!prevEl && container.firstChild !== card) {
          container.prepend(card);
        }
      }
      prevEl = card;
    }
  }
}

function createCardElement(task) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.id = task.id;
  updateCardElement(card, task);
  return card;
}

function updateCardElement(card, task) {
  card.innerHTML = `
    <div class="card-actions">
      <button class="card-btn" data-action="edit" title="Modifier">&#9998;</button>
    </div>
    <div class="card-title">${escapeHtml(task.title)}</div>
    ${task.description ? `<div class="card-description">${escapeHtml(task.description)}</div>` : ""}
    ${task.when ? `<span class="card-when">${escapeHtml(task.when)}</span>` : ""}
  `;
  card.querySelector('[data-action="edit"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openEditModal(task.id);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== Firestore CRUD =====
export async function addTask(title, description = "", column = "todo", when = "") {
  if (!tasksRef) return;
  const colTasks = [...tasks.values()].filter(t => t.column === column);
  const maxOrder = colTasks.reduce((max, t) => Math.max(max, t.order || 0), 0);

  await addDoc(tasksRef, {
    title,
    description,
    column,
    when,
    order: maxOrder + 1000,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function moveTask(taskId, newColumn, newOrder) {
  const task = tasks.get(taskId);
  const taskRef = doc(db, "boards", BOARD_ID, "tasks", taskId);

  const updates = {
    column: newColumn,
    order: newOrder,
    updatedAt: serverTimestamp()
  };

  // Save previous position when changing column (for restore on move-back)
  if (task && task.column !== newColumn) {
    updates.previousColumn = task.column;
    updates.previousOrder = task.order;
  }

  await updateDoc(taskRef, updates);
}

export async function moveTaskColumn(taskId, newColumn, direction) {
  const task = tasks.get(taskId);
  if (!task) return;

  const currentColumn = task.column;
  const currentOrder = task.order;

  // Check if we're moving back to the previous column — restore original position
  let newOrder;
  if (task.previousColumn === newColumn && task.previousOrder != null) {
    newOrder = task.previousOrder;
  } else {
    const targetTasks = [...tasks.values()].filter(t => t.column === newColumn);
    const maxOrder = targetTasks.reduce((max, t) => Math.max(max, t.order || 0), 0);
    newOrder = maxOrder + 1000;
  }

  const taskRef = doc(db, "boards", BOARD_ID, "tasks", taskId);
  await updateDoc(taskRef, {
    column: newColumn,
    order: newOrder,
    previousColumn: currentColumn,
    previousOrder: currentOrder,
    updatedAt: serverTimestamp()
  });

  if (window.matchMedia("(max-width: 768px)").matches) {
    setTimeout(() => switchTab(newColumn), 150);
  }
}

async function editTask(taskId, updates) {
  const taskRef = doc(db, "boards", BOARD_ID, "tasks", taskId);
  await updateDoc(taskRef, { ...updates, updatedAt: serverTimestamp() });
}

async function removeTask(taskId) {
  const taskRef = doc(db, "boards", BOARD_ID, "tasks", taskId);
  await deleteDoc(taskRef);
}

// ===== Snapshot =====
function applySnapshot(snapshot) {
  tasks.clear();
  snapshot.forEach(docSnap => {
    tasks.set(docSnap.id, docSnap.data());
  });

  // One-time dedup: remove duplicate tasks created by seed race condition
  if (!dedupDone && tasks.size > 0) {
    dedupDone = true;
    deduplicateTasks();
  }

  renderBoard();
}

export function onDragEnd() {
  isDragging = false;
  if (pendingSnapshot) {
    applySnapshot(pendingSnapshot);
    pendingSnapshot = null;
  }
}

export function onDragStart() {
  isDragging = true;
}

export function getTasksInColumn(column) {
  const colTasks = [];
  for (const [id, task] of tasks) {
    if (task.column === column) colTasks.push({ id, ...task });
  }
  return colTasks.sort((a, b) => a.order - b.order);
}

// ===== Modal =====
function openAddModal() {
  editingTaskId = null;
  modalTitle.textContent = "Nouvelle tache";
  inputTitle.value = "";
  inputDesc.value = "";
  inputWhen.value = "";
  btnDelete.classList.add("hidden");
  modal.classList.remove("hidden");
  inputTitle.focus();
}

function openEditModal(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;
  editingTaskId = taskId;
  modalTitle.textContent = "Modifier la tache";
  inputTitle.value = task.title || "";
  inputDesc.value = task.description || "";
  inputWhen.value = task.when || "";
  btnDelete.classList.remove("hidden");
  modal.classList.remove("hidden");
  inputTitle.focus();
}

function closeModal() {
  modal.classList.add("hidden");
  editingTaskId = null;
}

async function handleSave() {
  const title = inputTitle.value.trim();
  if (!title) return;

  if (editingTaskId) {
    await editTask(editingTaskId, {
      title,
      description: inputDesc.value.trim(),
      when: inputWhen.value.trim()
    });
  } else {
    const column = window.matchMedia("(max-width: 768px)").matches ? activeTab : "todo";
    await addTask(title, inputDesc.value.trim(), column, inputWhen.value.trim());
  }
  closeModal();
}

async function handleDelete() {
  if (!editingTaskId) return;
  await removeTask(editingTaskId);
  closeModal();
}

btnAdd.addEventListener("click", openAddModal);
fab.addEventListener("click", openAddModal);
btnCancel.addEventListener("click", closeModal);
btnSave.addEventListener("click", handleSave);
btnDelete.addEventListener("click", handleDelete);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ===== Dedup (one-time cleanup) =====
async function deduplicateTasks() {
  // Group tasks by title+description (catches seed duplicates)
  const groups = new Map();
  for (const [id, task] of tasks) {
    const key = `${task.title}|||${task.description || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id, ...task });
  }

  const toDelete = [];
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    // Keep the one with the lowest order (original), delete the rest
    group.sort((a, b) => (a.order || 0) - (b.order || 0));
    for (let i = 1; i < group.length; i++) {
      toDelete.push(group[i].id);
    }
  }

  if (toDelete.length === 0) return;
  console.log(`Dedup: removing ${toDelete.length} duplicate tasks`);

  const batch = writeBatch(db);
  for (const id of toDelete) {
    batch.delete(doc(db, "boards", BOARD_ID, "tasks", id));
  }
  await batch.commit();
}

// ===== Init Drag & Drop =====
initDragAndDrop(board, { moveTask, moveTaskColumn, getTasksInColumn, onDragStart, onDragEnd });
