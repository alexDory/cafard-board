// ===== Drag & Drop (desktop + mobile reorder) + Swipe (mobile column change) =====

let dragState = null;
let touchState = null;
let callbacks = null;

const SWIPE_THRESHOLD = 60;
const COLUMN_ORDER = ["todo", "doing", "done"];
const DECIDE_THRESHOLD = 10;

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

export function initDragAndDrop(board, cbs) {
  callbacks = cbs;
  board.addEventListener("pointerdown", onPointerDown);
}

function onPointerDown(e) {
  const card = e.target.closest(".card");
  if (!card || e.target.closest(".card-btn")) return;
  if (e.button !== 0 && e.pointerType === "mouse") return;

  if (isMobile()) {
    startTouch(e, card);
  } else {
    startDrag(e, card);
  }
}

// =============================================
// MOBILE: unified touch handler
// Decides between horizontal swipe and vertical reorder
// =============================================

function startTouch(e, card) {
  touchState = {
    card,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    taskId: card.dataset.id,
    column: card.closest(".column").dataset.column,
    mode: null, // "swipe" | "reorder" | null (undecided)
    ghost: null,
    indicator: null
  };

  card.addEventListener("pointermove", onTouchMove);
  card.addEventListener("pointerup", onTouchEnd);
  card.addEventListener("pointercancel", onTouchEnd);
}

function onTouchMove(e) {
  if (!touchState) return;

  const deltaX = e.clientX - touchState.startX;
  const deltaY = e.clientY - touchState.startY;

  // Decide mode once
  if (!touchState.mode && (Math.abs(deltaX) > DECIDE_THRESHOLD || Math.abs(deltaY) > DECIDE_THRESHOLD)) {
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      touchState.mode = "swipe";
      touchState.card.classList.add("swiping");
      touchState.card.setPointerCapture(e.pointerId);
      e.preventDefault();
      showSwipeHint();
    } else {
      touchState.mode = "reorder";
      touchState.card.setPointerCapture(e.pointerId);
      e.preventDefault();
      startMobileReorder(e);
    }
  }

  if (touchState.mode === "swipe") {
    onSwipeMove(e, deltaX);
  } else if (touchState.mode === "reorder") {
    onReorderMove(e);
  }
}

function onTouchEnd(e) {
  if (!touchState) return;

  const { card } = touchState;
  card.removeEventListener("pointermove", onTouchMove);
  card.removeEventListener("pointerup", onTouchEnd);
  card.removeEventListener("pointercancel", onTouchEnd);

  if (touchState.mode === "swipe") {
    finishSwipe(e);
  } else if (touchState.mode === "reorder") {
    finishMobileReorder(e);
  }

  touchState = null;
}

// =============================================
// MOBILE SWIPE (horizontal → change column)
// =============================================

function onSwipeMove(e, deltaX) {
  e.preventDefault();
  const { card, column } = touchState;

  const resistance = 0.6;
  const tx = deltaX * resistance;
  const opacity = Math.max(0.4, 1 - Math.abs(deltaX) / 300);
  card.style.transform = `translateX(${tx}px)`;
  card.style.opacity = opacity;

  const colIdx = COLUMN_ORDER.indexOf(column);
  if ((deltaX > SWIPE_THRESHOLD && colIdx < COLUMN_ORDER.length - 1) ||
      (deltaX < -SWIPE_THRESHOLD && colIdx > 0)) {
    card.style.borderColor = "rgba(255,255,255,0.15)";
  } else {
    card.style.borderColor = "";
  }
}

function finishSwipe(e) {
  const { card, startX, taskId, column } = touchState;
  const deltaX = e.clientX - startX;

  card.classList.remove("swiping");
  card.style.borderColor = "";

  const colIdx = COLUMN_ORDER.indexOf(column);

  if (deltaX > SWIPE_THRESHOLD && colIdx < COLUMN_ORDER.length - 1) {
    const newColumn = COLUMN_ORDER[colIdx + 1];
    card.classList.add("swipe-out-right");
    card.addEventListener("animationend", () => {
      callbacks.moveTaskColumn(taskId, newColumn, "right");
    }, { once: true });
  } else if (deltaX < -SWIPE_THRESHOLD && colIdx > 0) {
    const newColumn = COLUMN_ORDER[colIdx - 1];
    card.classList.add("swipe-out-left");
    card.addEventListener("animationend", () => {
      callbacks.moveTaskColumn(taskId, newColumn, "left");
    }, { once: true });
  } else {
    snapBack(card);
  }
}

function snapBack(card) {
  card.style.transition = "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s";
  card.style.transform = "";
  card.style.opacity = "";
  setTimeout(() => { card.style.transition = ""; }, 300);
}

// =============================================
// MOBILE REORDER (vertical → reorder within column)
// =============================================

function startMobileReorder(e) {
  const { card } = touchState;
  const rect = card.getBoundingClientRect();

  const ghost = card.cloneNode(true);
  ghost.className = "card drag-ghost";
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.appendChild(ghost);

  card.classList.add("dragging");
  touchState.ghost = ghost;
  touchState.offsetX = e.clientX - rect.left;
  touchState.offsetY = e.clientY - rect.top;

  callbacks.onDragStart();
}

function onReorderMove(e) {
  if (!touchState || !touchState.ghost) return;
  e.preventDefault();

  const { ghost, offsetX, offsetY, column } = touchState;
  ghost.style.left = (e.clientX - offsetX) + "px";
  ghost.style.top = (e.clientY - offsetY) + "px";

  // Show drop indicator within the same column
  const col = document.querySelector(`.column[data-column="${column}"]`);
  if (col) {
    showMobileDropIndicator(col, e.clientY);
  }
}

function finishMobileReorder(e) {
  const { card, ghost, taskId, column } = touchState;

  // Calculate new order
  const col = document.querySelector(`.column[data-column="${column}"]`);
  if (col) {
    const newOrder = calculateDropOrder(col, e.clientY, taskId);
    callbacks.moveTask(taskId, column, newOrder);
  }

  card.classList.remove("dragging");
  if (ghost) ghost.remove();
  removeMobileDropIndicator();
  callbacks.onDragEnd();
}

function showMobileDropIndicator(column, clientY) {
  removeMobileDropIndicator();

  const cardsContainer = column.querySelector(".column-cards");
  const cards = [...cardsContainer.querySelectorAll(".card:not(.dragging)")];

  let insertBefore = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      insertBefore = card;
      break;
    }
  }

  const indicator = document.createElement("div");
  indicator.className = "drop-indicator";
  touchState.indicator = indicator;

  if (insertBefore) {
    cardsContainer.insertBefore(indicator, insertBefore);
  } else {
    cardsContainer.appendChild(indicator);
  }
}

function removeMobileDropIndicator() {
  if (touchState && touchState.indicator) {
    touchState.indicator.remove();
    touchState.indicator = null;
  }
}

let hintShown = false;
function showSwipeHint() {
  if (hintShown) return;
  hintShown = true;
  const hint = document.getElementById("swipeHint");
  if (hint) {
    hint.classList.remove("hidden");
    setTimeout(() => hint.classList.add("hidden"), 3500);
  }
}

// =============================================
// DESKTOP DRAG & DROP
// =============================================

function startDrag(e, card) {
  e.preventDefault();

  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.className = "card drag-ghost";
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.appendChild(ghost);

  card.classList.add("dragging");
  card.setPointerCapture(e.pointerId);

  dragState = {
    card,
    ghost,
    pointerId: e.pointerId,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    sourceColumn: card.closest(".column").dataset.column,
    taskId: card.dataset.id,
    indicator: null
  };

  callbacks.onDragStart();

  card.addEventListener("pointermove", onDragMove);
  card.addEventListener("pointerup", onDragUp);
  card.addEventListener("pointercancel", onDragUp);
}

function onDragMove(e) {
  if (!dragState) return;
  e.preventDefault();

  const { ghost, offsetX, offsetY } = dragState;
  ghost.style.left = (e.clientX - offsetX) + "px";
  ghost.style.top = (e.clientY - offsetY) + "px";

  const targetCol = getColumnAt(e.clientX, e.clientY);
  highlightColumn(targetCol);

  if (targetCol) {
    showDesktopDropIndicator(targetCol, e.clientY);
  } else {
    removeDesktopDropIndicator();
  }
}

function onDragUp(e) {
  if (!dragState) return;
  e.preventDefault();

  const { card, ghost, taskId } = dragState;

  const targetCol = getColumnAt(e.clientX, e.clientY);
  if (targetCol) {
    const newColumn = targetCol.dataset.column;
    const newOrder = calculateDropOrder(targetCol, e.clientY, taskId);
    callbacks.moveTask(taskId, newColumn, newOrder);
  }

  card.classList.remove("dragging");
  ghost.remove();
  removeDesktopDropIndicator();
  clearHighlights();

  card.removeEventListener("pointermove", onDragMove);
  card.removeEventListener("pointerup", onDragUp);
  card.removeEventListener("pointercancel", onDragUp);

  dragState = null;
  callbacks.onDragEnd();
}

function getColumnAt(x, y) {
  const columns = document.querySelectorAll(".column");
  for (const col of columns) {
    const rect = col.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return col;
    }
  }
  return null;
}

function highlightColumn(targetCol) {
  document.querySelectorAll(".column").forEach(col => {
    col.classList.toggle("drag-over", col === targetCol);
  });
}

function clearHighlights() {
  document.querySelectorAll(".column").forEach(col => {
    col.classList.remove("drag-over");
  });
}

function showDesktopDropIndicator(column, clientY) {
  removeDesktopDropIndicator();
  const cardsContainer = column.querySelector(".column-cards");
  const cards = [...cardsContainer.querySelectorAll(".card:not(.dragging)")];

  let insertBefore = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      insertBefore = card;
      break;
    }
  }

  const indicator = document.createElement("div");
  indicator.className = "drop-indicator";
  dragState.indicator = indicator;

  if (insertBefore) {
    cardsContainer.insertBefore(indicator, insertBefore);
  } else {
    cardsContainer.appendChild(indicator);
  }
}

function removeDesktopDropIndicator() {
  if (dragState && dragState.indicator) {
    dragState.indicator.remove();
    dragState.indicator = null;
  }
}

// =============================================
// SHARED: calculate drop order
// =============================================

function calculateDropOrder(column, clientY, draggedId) {
  const colName = column.dataset.column;
  const colTasks = callbacks.getTasksInColumn(colName).filter(t => t.id !== draggedId);
  const cardsContainer = column.querySelector(".column-cards");
  const cards = [...cardsContainer.querySelectorAll(".card:not(.dragging)")];

  let dropIndex = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      dropIndex = i;
      break;
    }
  }

  const orderedTasks = cards.map(c => colTasks.find(t => t.id === c.dataset.id)).filter(Boolean);

  if (orderedTasks.length === 0) return 1000;
  if (dropIndex === 0) return (orderedTasks[0]?.order || 1000) - 1000;
  if (dropIndex >= orderedTasks.length) return (orderedTasks[orderedTasks.length - 1]?.order || 1000) + 1000;

  const before = orderedTasks[dropIndex - 1]?.order || 0;
  const after = orderedTasks[dropIndex]?.order || before + 2000;
  return (before + after) / 2;
}
