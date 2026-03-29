// ===== Drag & Drop (desktop) + Swipe (mobile) =====

let dragState = null;
let swipeState = null;
let callbacks = null;

const SWIPE_THRESHOLD = 60;
const SWIPE_MAX_Y = 40;
const COLUMN_ORDER = ["todo", "doing", "done"];

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
    startSwipe(e, card);
  } else {
    startDrag(e, card);
  }
}

// =============================================
// SWIPE (mobile)
// =============================================

function startSwipe(e, card) {
  swipeState = {
    card,
    startX: e.clientX,
    startY: e.clientY,
    currentX: e.clientX,
    taskId: card.dataset.id,
    column: card.closest(".column").dataset.column,
    swiping: false,
    decided: false
  };

  card.addEventListener("pointermove", onSwipeMove);
  card.addEventListener("pointerup", onSwipeEnd);
  card.addEventListener("pointercancel", onSwipeEnd);
}

function onSwipeMove(e) {
  if (!swipeState) return;

  swipeState.currentX = e.clientX;
  const deltaX = e.clientX - swipeState.startX;
  const deltaY = e.clientY - swipeState.startY;

  // Decide once: is this a horizontal swipe or a vertical scroll?
  if (!swipeState.decided && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
    swipeState.decided = true;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      swipeState.swiping = true;
      swipeState.card.classList.add("swiping");
      swipeState.card.setPointerCapture(e.pointerId);
      e.preventDefault();

      // Show hint on first ever swipe
      showSwipeHint();
    } else {
      // Vertical scroll — cancel swipe tracking
      cleanupSwipe();
      return;
    }
  }

  if (!swipeState.swiping) return;
  e.preventDefault();

  // Visual feedback: translate card horizontally with resistance
  const resistance = 0.6;
  const tx = deltaX * resistance;
  const opacity = Math.max(0.4, 1 - Math.abs(deltaX) / 300);
  swipeState.card.style.transform = `translateX(${tx}px)`;
  swipeState.card.style.opacity = opacity;

  // Color hint based on direction
  const colIdx = COLUMN_ORDER.indexOf(swipeState.column);
  if (deltaX > SWIPE_THRESHOLD && colIdx < COLUMN_ORDER.length - 1) {
    swipeState.card.style.borderColor = "rgba(255,255,255,0.15)";
  } else if (deltaX < -SWIPE_THRESHOLD && colIdx > 0) {
    swipeState.card.style.borderColor = "rgba(255,255,255,0.15)";
  } else {
    swipeState.card.style.borderColor = "";
  }
}

function onSwipeEnd(e) {
  if (!swipeState) return;

  const { card, startX, taskId, column, swiping } = swipeState;
  const deltaX = e.clientX - startX;

  card.removeEventListener("pointermove", onSwipeMove);
  card.removeEventListener("pointerup", onSwipeEnd);
  card.removeEventListener("pointercancel", onSwipeEnd);

  if (!swiping) {
    swipeState = null;
    return;
  }

  card.classList.remove("swiping");
  card.style.borderColor = "";

  const colIdx = COLUMN_ORDER.indexOf(column);

  if (deltaX > SWIPE_THRESHOLD && colIdx < COLUMN_ORDER.length - 1) {
    // Swipe right → next column
    const newColumn = COLUMN_ORDER[colIdx + 1];
    card.classList.add("swipe-out-right");
    card.addEventListener("animationend", () => {
      callbacks.moveTaskColumn(taskId, newColumn, "right");
    }, { once: true });
  } else if (deltaX < -SWIPE_THRESHOLD && colIdx > 0) {
    // Swipe left → previous column
    const newColumn = COLUMN_ORDER[colIdx - 1];
    card.classList.add("swipe-out-left");
    card.addEventListener("animationend", () => {
      callbacks.moveTaskColumn(taskId, newColumn, "left");
    }, { once: true });
  } else {
    // Not enough — snap back
    card.style.transition = "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s";
    card.style.transform = "";
    card.style.opacity = "";
    setTimeout(() => {
      card.style.transition = "";
    }, 300);
  }

  swipeState = null;
}

function cleanupSwipe() {
  if (!swipeState) return;
  const { card } = swipeState;
  card.removeEventListener("pointermove", onSwipeMove);
  card.removeEventListener("pointerup", onSwipeEnd);
  card.removeEventListener("pointercancel", onSwipeEnd);
  card.classList.remove("swiping");
  card.style.transform = "";
  card.style.opacity = "";
  card.style.borderColor = "";
  swipeState = null;
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
// DRAG & DROP (desktop)
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
    showDropIndicator(targetCol, e.clientY);
  } else {
    removeDropIndicator();
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
  removeDropIndicator();
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

function showDropIndicator(column, clientY) {
  removeDropIndicator();
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

function removeDropIndicator() {
  if (dragState && dragState.indicator) {
    dragState.indicator.remove();
    dragState.indicator = null;
  }
}

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
