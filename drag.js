// ===== Drag & Drop via Pointer Events =====
// Works with both mouse and touch, no external library needed.

let dragState = null;
let callbacks = null;

export function initDragAndDrop(board, cbs) {
  callbacks = cbs;
  board.addEventListener("pointerdown", onPointerDown);
}

function onPointerDown(e) {
  const card = e.target.closest(".card");
  if (!card || e.target.closest(".card-btn")) return;
  if (e.button !== 0 && e.pointerType === "mouse") return;

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

  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", onPointerUp);
  card.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e) {
  if (!dragState) return;
  e.preventDefault();

  const { ghost, offsetX, offsetY } = dragState;
  ghost.style.left = (e.clientX - offsetX) + "px";
  ghost.style.top = (e.clientY - offsetY) + "px";

  // Detect target column
  const targetCol = getColumnAt(e.clientX, e.clientY);
  highlightColumn(targetCol);

  // Show drop indicator
  if (targetCol) {
    showDropIndicator(targetCol, e.clientY);
  } else {
    removeDropIndicator();
  }
}

function onPointerUp(e) {
  if (!dragState) return;
  e.preventDefault();

  const { card, ghost, taskId } = dragState;

  // Determine drop target
  const targetCol = getColumnAt(e.clientX, e.clientY);
  if (targetCol) {
    const newColumn = targetCol.dataset.column;
    const newOrder = calculateDropOrder(targetCol, e.clientY, taskId);
    callbacks.moveTask(taskId, newColumn, newOrder);
  }

  // Cleanup
  card.classList.remove("dragging");
  ghost.remove();
  removeDropIndicator();
  clearHighlights();

  card.removeEventListener("pointermove", onPointerMove);
  card.removeEventListener("pointerup", onPointerUp);
  card.removeEventListener("pointercancel", onPointerUp);

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
    const midY = rect.top + rect.height / 2;
    if (clientY < midY) {
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

  let dropIndex = cards.length; // default: end
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (clientY < midY) {
      dropIndex = i;
      break;
    }
  }

  // Map card DOM elements back to task data for order
  const orderedTasks = cards.map(c => colTasks.find(t => t.id === c.dataset.id)).filter(Boolean);

  if (orderedTasks.length === 0) {
    return 1000;
  }

  if (dropIndex === 0) {
    return (orderedTasks[0]?.order || 1000) - 1000;
  }

  if (dropIndex >= orderedTasks.length) {
    return (orderedTasks[orderedTasks.length - 1]?.order || 1000) + 1000;
  }

  const before = orderedTasks[dropIndex - 1]?.order || 0;
  const after = orderedTasks[dropIndex]?.order || before + 2000;
  return (before + after) / 2;
}
