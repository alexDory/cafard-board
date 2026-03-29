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
import firebaseConfig from "./firebase-config.js";
import { initDragAndDrop } from "./drag.js";

// ===== Firebase Init =====
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Offline persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Offline persistence not supported in this browser');
  }
});

const BOARD_ID = "cafardland";
const tasksRef = collection(db, "boards", BOARD_ID, "tasks");

// ===== State =====
let tasks = new Map();
let isDragging = false;
let pendingSnapshot = null;
let activeTab = "todo";

// ===== DOM Elements =====
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

  // Update tab UI
  tabBar.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === column);
  });

  // Show only active column
  document.querySelectorAll(".column").forEach(col => {
    col.classList.toggle("mobile-active", col.dataset.column === column);
  });
}

tabBar.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  switchTab(tab.dataset.tab);
});

// Init: show first tab on mobile
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

    // Remove cards that no longer belong
    container.querySelectorAll(".card").forEach(card => {
      if (!existingIds.has(card.dataset.id)) card.remove();
    });

    // Add or update cards
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
  const taskRef = doc(db, "boards", BOARD_ID, "tasks", taskId);
  await updateDoc(taskRef, {
    column: newColumn,
    order: newOrder,
    updatedAt: serverTimestamp()
  });
}

// Move task to adjacent column (for swipe), keeping same order
export async function moveTaskColumn(taskId, newColumn, direction) {
  const task = tasks.get(taskId);
  if (!task) return;

  // Calculate order: place at end of target column
  const targetTasks = [...tasks.values()].filter(t => t.column === newColumn);
  const maxOrder = targetTasks.reduce((max, t) => Math.max(max, t.order || 0), 0);

  const taskRef = doc(db, "boards", BOARD_ID, "tasks", taskId);
  await updateDoc(taskRef, {
    column: newColumn,
    order: maxOrder + 1000,
    updatedAt: serverTimestamp()
  });

  // On mobile: switch to the target column tab after swipe
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

// ===== Real-time Listener =====
const q = query(tasksRef, orderBy("order"));
onSnapshot(q, (snapshot) => {
  if (isDragging) {
    pendingSnapshot = snapshot;
    return;
  }
  applySnapshot(snapshot);
});

function applySnapshot(snapshot) {
  tasks.clear();
  snapshot.forEach(docSnap => {
    tasks.set(docSnap.id, docSnap.data());
  });

  if (tasks.size === 0) {
    seedInitialTasks();
    return;
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
    // On mobile, add to active tab's column
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

// Event listeners
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

// ===== Seed Data =====
async function seedInitialTasks() {
  const seedTasks = [
    { title: "One-pager + schema avant/apres", description: "Arme de vente prete", when: "Ce soir", order: 1000 },
    { title: "Cafe avec ingenieur d'affaires Alten", description: "2-3 noms a contacter", when: "Cette semaine", order: 2000 },
    { title: "Approcher le lead migration DOORS-Jama", description: "Premier prospect chaud", when: "Semaine 2", order: 3000 },
    { title: "Premiers RDV prospects via intros", description: "Demande validee ou angle ajuste", when: "Semaine 2-3", order: 4000 },
    { title: "Construire la demo + ouvrir micro-entreprise", description: "Livrer et facturer", when: "Quand quelqu'un dit oui", order: 5000 },
    { title: "Documenter avant/apres + proposer maintenance", description: "Premier cas + revenu recurrent", when: "Post-livraison", order: 6000 },
    { title: "Demander referrals a chaque client", description: "Effet boule de neige", when: "En continu", order: 7000 },
    { title: "Evaluer: quitter Alten ou rester", description: "Decision basee sur les donnees", when: "Mois 6+", order: 8000 }
  ];

  const batch = writeBatch(db);
  for (const task of seedTasks) {
    const ref = doc(tasksRef);
    batch.set(ref, {
      ...task,
      column: "todo",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
}

// ===== Init Drag & Drop =====
initDragAndDrop(board, { moveTask, moveTaskColumn, getTasksInColumn, onDragStart, onDragEnd });
