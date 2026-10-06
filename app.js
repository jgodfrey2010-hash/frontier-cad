const canvas = document.getElementById('cadCanvas');
const ctx = canvas.getContext('2d');
const layerSelect = document.getElementById('layerSelect');
const layerReadout = document.getElementById('layerReadout');
const coordReadout = document.getElementById('coordReadout');
const currentToolLabel = document.getElementById('currentToolLabel');
const fileImportInput = document.getElementById('fileImportInput');

const state = {
  tool: 'select',
  entities: [],
  refs: [],
  selection: new Set(),
  dragStart: null,
  activeCommand: null,
  currentLayer: '0',
  layers: {
    '0': { name: '0', visible: true },
    'SURVEY': { name: 'SURVEY', visible: true },
    'TEXT': { name: 'TEXT', visible: true },
    'REF': { name: 'REF', visible: true },
  },
  view: {
    centerX: 0,
    centerY: 0,
    scale: 1,
  },
  history: [],
  future: [],
  dragPreview: null,
  snapPoint: null,
  lastPointer: { x: 0, y: 0 },
  nextId: 1,
};

function cloneEntities() {
  return JSON.parse(JSON.stringify(state.entities));
}

function cloneRefs() {
  return JSON.parse(JSON.stringify(state.refs));
}

function pushHistory(label = 'edit') {
  state.history.push({
    label,
    entities: cloneEntities(),
    refs: cloneRefs(),
    currentLayer: state.currentLayer,
    selection: [...state.selection],
  });

  if (state.history.length > 50) {
    state.history.shift();
  }

  state.future = [];
}

function restoreFromSnapshot(snapshot) {
  state.entities = JSON.parse(JSON.stringify(snapshot.entities));
  state.refs = JSON.parse(JSON.stringify(snapshot.refs));
  state.currentLayer = snapshot.currentLayer;
  state.selection = new Set(snapshot.selection || []);
  syncLayerSelect();
  drawScene();
}

function undo() {
  if (state.history.length === 0) return;
  const current = {
    entities: cloneEntities(),
    refs: cloneRefs(),
    currentLayer: state.currentLayer,
    selection: [...state.selection],
  };

  state.future.push(current);
  const previous = state.history.pop();
  restoreFromSnapshot(previous);
}

function redo() {
  if (state.future.length === 0) return;
  const current = {
    entities: cloneEntities(),
    refs: cloneRefs(),
    currentLayer: state.currentLayer,
    selection: [...state.selection],
  };

  state.history.push(current);
  const next = state.future.pop();
  restoreFromSnapshot(next);
}

function addHistorySnapshot() {
  pushHistory('modification');
}

function updateToolLabel() {
  currentToolLabel.textContent = state.tool
    .replace('-', ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function syncLayerSelect() {
  const entries = Object.keys(state.layers);
  layerSelect.innerHTML = '';
  entries.forEach(layer => {
    const option = document.createElement('option');
    option.value = layer;
    option.textContent = layer;
    if (layer === state.currentLayer) option.selected = true;
    layerSelect.appendChild(option);
  });
  layerReadout.textContent = state.currentLayer;
}

layerSelect.addEventListener('change', () => {
  state.currentLayer = layerSelect.value;
  layerReadout.textContent = state.currentLayer;
  drawScene();
});

function setTool(tool) {
  state.tool = tool;
  state.activeCommand = null;
  state.dragPreview = null;
  state.snapPoint = null;
  updateToolLabel();
  updateButtonStates();
  drawScene();
}

function updateButtonStates() {
  const buttons = document.querySelectorAll('.tool-button');
  buttons.forEach(btn => {
    const active = btn.dataset.tool === state.tool;
    btn.classList.toggle('active', active);
  });
}

function worldToScreen(x, y) {
  return {
    x: (x - state.view.centerX) * state.view.scale + canvas.width / 2,
    y: (y - state.view.centerY) * state.view.scale + canvas.height / 2,
  };
}

function screenToWorld(x, y) {
  return {
    x: (x - canvas.width / 2) / state.view.scale + state.view.centerX,
    y: (y - canvas.height / 2) / state.view.scale + state.view.centerY,
  };
}

function updateCoordReadout(worldPoint) {
  coordReadout.textContent = `${worldPoint.x.toFixed(3)}, ${worldPoint.y.toFixed(3)}`;
}

function addEntity(entity) {
  entity.id = state.nextId++;
  entity.layer = entity.layer || state.currentLayer;
  state.entities.push(entity);
  return entity;
}

function removeEntityById(id) {
  state.entities = state.entities.filter(e => e.id !== id);
}

function getSelectedEntities() {
  return state.entities.filter(e => state.selection.has(e.id));
}

function entityBounds(entity) {
  switch (entity.type) {
    case 'line':
      return {
        minX: Math.min(entity.x1, entity.x2),
        maxX: Math.max(entity.x1, entity.x2),
        minY: Math.min(entity.y1, entity.y2),
        maxY: Math.max(entity.y1, entity.y2),
      };
    case 'polyline':
      const xs = entity.points.map(p => p.x);
      const ys = entity.points.map(p => p.y);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    case 'circle':
      return {
        minX: entity.cx - entity.r,
        maxX: entity.cx + entity.r,
        minY: entity.cy - entity.r,
        maxY: entity.cy + entity.r,
      };
    case 'arc':
      return {
        minX: entity.cx - entity.r,
        maxX: entity.cx + entity.r,
        minY: entity.cy - entity.r,
        maxY: entity.cy + entity.r,
      };
    case 'point':
      return {
        minX: entity.x - 0.1,
        maxX: entity.x + 0.1,
        minY: entity.y - 0.1,
        maxY: entity.y + 0.1,
      };
    case 'text':
      return {
        minX: entity.x,
        maxX: entity.x + (entity.text.length * 0.3),
        minY: entity.y - 0.3,
        maxY: entity.y + 0.3,
      };
    case 'rectangle':
      return {
        minX: Math.min(entity.x1, entity.x2),
        maxX: Math.max(entity.x1, entity.x2),
        minY: Math.min(entity.y1, entity.y2),
        maxY: Math.max(entity.y1, entity.y2),
      };
    default:
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
}

function inRect(point, rect) {
  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function entityContainsPoint(entity, point) {
  if (entity.type === 'line') {
    const dx = entity.x2 - entity.x1;
    const dy = entity.y2 - entity.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return false;
    const t = ((point.x - entity.x1) * dx + (point.y - entity.y1) * dy) / len2;
    const projectionX = entity.x1 + t * dx;
    const projectionY = entity.y1 + t * dy;
    const distToLine = Math.hypot(point.x - projectionX, point.y - projectionY);
    return distToLine < 0.25;
  }

  if (entity.type === 'circle') {
    return Math.hypot(point.x - entity.cx, point.y - entity.cy) < entity.r + 0.2;
  }

  if (entity.type === 'point') {
    return Math.hypot(point.x - entity.x, point.y - entity.y) < 0.3;
  }

  if (entity.type === 'text') {
    return Math.abs(point.x - entity.x) < 0.5 && Math.abs(point.y - entity.y) < 0.5;
  }

  if (entity.type === 'polyline') {
    for (let i = 0; i < entity.points.length - 1; i++) {
      const p1 = entity.points[i];
      const p2 = entity.points[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / len2;
      if (t >= 0 && t <= 1) {
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        if (Math.hypot(point.x - projX, point.y - projY) < 0.2) return true;
      }
    }
  }

  if (entity.type === 'arc') {
    const dx = point.x - entity.cx;
    const dy = point.y - entity.cy;
    const r = Math.hypot(dx, dy);
    return Math.abs(r - entity.r) < 0.2;
  }

  if (entity.type === 'rectangle') {
    return inRect(point, entity);
  }

  return false;
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const clamped = Math.max(0, Math.min(1, t));
  const cx = a.x + clamped * dx;
  const cy = a.y + clamped * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function findNearestSnap(point) {
  let best = null;
  let bestDist = Infinity;

  for (const entity of state.entities) {
    if (entity.layer && state.layers[entity.layer] && !state.layers[entity.layer].visible) {
      continue;
    }

    if (entity.type === 'line') {
      const candidates = [
        { x: entity.x1, y: entity.y1 },
        { x: entity.x2, y: entity.y2 },
      ];
      candidates.forEach(p => {
        const d = Math.hypot(point.x - p.x, point.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = { x: p.x, y: p.y, type: 'endpoint' };
        }
      });

      const mid = { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 };
      const md = Math.hypot(point.x - mid.x, point.y - mid.y);
      if (md < bestDist) {
        bestDist = md;
        best = { x: mid.x, y: mid.y, type: 'midpoint' };
      }
    }

    if (entity.type === 'circle') {
      const d = Math.hypot(point.x - entity.cx, point.y - entity.cy);
      if (d < bestDist) {
        bestDist = d;
        best = { x: entity.cx, y: entity.cy, type: 'center' };
      }
    }

    if (entity.type === 'point') {
      const d = Math.hypot(point.x - entity.x, point.y - entity.y);
      if (d < bestDist) {
        bestDist = d;
        best = { x: entity.x, y: entity.y, type: 'point' };
      }
    }

    if (entity.type === 'polyline') {
      for (let i = 0; i < entity.points.length - 1; i++) {
        const a = entity.points[i];
        const b = entity.points[i + 1];
        const d = distanceToSegment(point, a, b);
        if (d < bestDist) {
          bestDist = d;
          best = { x: a.x, y: a.y, type: 'nearest' };
        }
      }
    }
  }

  if (best && bestDist < 1.5) {
    return best;
  }

  return null;
}

function drawGrid() {
  const step = 10 * state.view.scale;
  const worldLeft = state.view.centerX - canvas.width / (2 * state.view.scale);
  const worldRight = state.view.centerX + canvas.width / (2 * state.view.scale);
  const worldTop = state.view.centerY - canvas.height / (2 * state.view.scale);
  const worldBottom = state.view.centerY + canvas.height / (2 * state.view.scale);

  ctx.strokeStyle = 'rgba(120, 130, 140, 0.15)';
  ctx.lineWidth = 1;

  const gridSize = 10;
  for (let x = Math.floor(worldLeft / gridSize) * gridSize; x <= worldRight; x += gridSize) {
    const sx = worldToScreen(x, 0).x;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvas.height);
    ctx.stroke();
  }

  for (let y = Math.floor(worldTop / gridSize) * gridSize; y <= worldBottom; y += gridSize) {
    const sy = worldToScreen(0, y).y;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(canvas.width, sy);
    ctx.stroke();
  }
}

function drawEntity(entity) {
  if (entity.visible === false) return;

  const layerInfo = state.layers[entity.layer];
  if (layerInfo && !layerInfo.visible) return;

  ctx.save();
  ctx.lineWidth = entity.lineWidth || 1.5;
  ctx.strokeStyle = entity.color || '#18212d';
  ctx.fillStyle = entity.color || '#18212d';

  switch (entity.type) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(worldToScreen(entity.x1, entity.y1).x, worldToScreen(entity.x1, entity.y1).y);
      ctx.lineTo(worldToScreen(entity.x2, entity.y2).x, worldToScreen(entity.x2, entity.y2).y);
      ctx.stroke();
      break;
    case 'polyline':
      ctx.beginPath();
      entity.points.forEach((pt, index) => {
        const s = worldToScreen(pt.x, pt.y);
        if (index === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      break;
    case 'circle':
      const c = worldToScreen(entity.cx, entity.cy);
      const r = entity.r * state.view.scale;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'arc': {
      const center = worldToScreen(entity.cx, entity.cy);
      const r = entity.r * state.view.scale;
      const sa = entity.startAngle;
      const ea = entity.endAngle;
      ctx.beginPath();
      ctx.arc(center.x, center.y, r, sa, ea);
      ctx.stroke();
      break;
    }
    case 'point': {
      const p = worldToScreen(entity.x, entity.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'text': {
      const p = worldToScreen(entity.x, entity.y);
      ctx.font = '12px Segoe UI';
      ctx.fillText(entity.text, p.x, p.y);
      break;
    }
    case 'rectangle': {
      const p1 = worldToScreen(entity.x1, entity.y1);
      const p2 = worldToScreen(entity.x2, entity.y2);
      ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
      break;
    }
    default:
      break;
  }

  ctx.restore();
}

function drawSelection() {
  state.selection.forEach(id => {
    const entity = state.entities.find(e => e.id === id);
    if (!entity) return;

    ctx.save();
    ctx.strokeStyle = '#f1a900';
    ctx.fillStyle = 'rgba(255, 184, 0, 0.18)';
    ctx.lineWidth = 1.5;
    const bounds = entityBounds(entity);
    const p1 = worldToScreen(bounds.minX, bounds.minY);
    const p2 = worldToScreen(bounds.maxX, bounds.maxY);

    ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    ctx.restore();
  });
}

function drawPreview() {
  if (!state.activeCommand) return;

  if (state.activeCommand.type === 'draw-line' && state.activeCommand.preview) {
    const start = worldToScreen(state.activeCommand.start.x, state.activeCommand.start.y);
    const end = worldToScreen(state.activeCommand.preview.x, state.activeCommand.preview.y);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (state.activeCommand.type === 'fence' && state.activeCommand.start) {
    const a = worldToScreen(state.activeCommand.start.x, state.activeCommand.start.y);
    const b = worldToScreen(state.activeCommand.current.x, state.activeCommand.current.y);
    ctx.strokeStyle = '#2dbd9d';
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
  }

  if (state.snapPoint) {
    const p = worldToScreen(state.snapPoint.x, state.snapPoint.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
  }
}

function drawScene() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  state.entities.forEach(entity => {
    if (entity.layer && state.layers[entity.layer] && !state.layers[entity.layer].visible) return;
    drawEntity(entity);
  });

  state.refs.forEach(ref => {
    if (ref.visible !== false) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#8b5cf6';
      const corners = [
        worldToScreen(ref.x, ref.y),
        worldToScreen(ref.x + ref.width, ref.y),
        worldToScreen(ref.x + ref.width, ref.y + ref.height),
        worldToScreen(ref.x, ref.y + ref.height),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      corners.slice(1).forEach(c => ctx.lineTo(c.x, c.y));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  });

  drawSelection();
  drawPreview();
}

function selectEntitiesUnderRect(rect) {
  const ids = state.entities
    .filter(entity => {
      const b = entityBounds(entity);
      const overlap = !(b.maxX < Math.min(rect.x1, rect.x2) || b.minX > Math.max(rect.x1, rect.x2) || b.maxY < Math.min(rect.y1, rect.y2) || b.minY > Math.max(rect.y1, rect.y2));
      return overlap;
    })
    .map(e => e.id);

  if (state.tool === 'fence' || state.tool === 'select') {
    state.selection = new Set(ids);
  }
}

function handleCanvasMouseMove(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const worldPoint = screenToWorld(x, y);
  state.lastPointer = { x, y };
  updateCoordReadout(worldPoint);

  if (!state.activeCommand) {
    const snap = findNearestSnap(worldPoint);
    state.snapPoint = snap;
    drawScene();
    return;
  }

  if (state.activeCommand.type === 'draw-line' || state.activeCommand.type === 'draw-arc' || state.activeCommand.type === 'draw-circle') {
    state.activeCommand.preview = worldPoint;
  }

  if (state.activeCommand.type === 'fence') {
    state.activeCommand.current = worldPoint;
  }

  if (state.activeCommand.type === 'move' || state.activeCommand.type === 'copy' || state.activeCommand.type === 'scale' || state.activeCommand.type === 'rotate') {
    const deltaX = worldPoint.x - state.activeCommand.base.x;
    const deltaY = worldPoint.y - state.activeCommand.base.y;
    state.activeCommand.preview = { x: deltaX, y: deltaY };
  }

  drawScene();
}

function handleCanvasMouseDown(event) {
  const rect = canvas.getBoundingClientRect();
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;
  const worldPoint = screenToWorld(sx, sy);
  const snap = findNearestSnap(worldPoint);
  const snapped = snap ? { x: snap.x, y: snap.y } : worldPoint;

  if (state.tool === 'pan') {
    state.dragStart = { x: sx, y: sy, centerX: state.view.centerX, centerY: state.view.centerY };
    return;
  }

  if (state.tool === 'select') {
    const hit = [...state.entities].reverse().find(entity => entityContainsPoint(entity, snapped));
    if (event.shiftKey || event.ctrlKey) {
      if (hit) {
        if (state.selection.has(hit.id)) state.selection.delete(hit.id);
        else state.selection.add(hit.id);
      }
    } else {
      if (hit) {
        state.selection = new Set([hit.id]);
      } else {
        state.selection.clear();
      }
    }

    state.dragStart = { x: sx, y: sy };
    drawScene();
    return;
  }

  if (state.tool === 'fence') {
    if (!state.activeCommand) {
      state.activeCommand = { type: 'fence', start: snapped, current: snapped };
    } else {
      const start = state.activeCommand.start;
      const rect = { x1: start.x, y1: start.y, x2: snapped.x, y2: snapped.y };
      const selected = state.entities.filter(entity => {
        const b = entityBounds(entity);
        const overlaps = !(b.maxX < Math.min(rect.x1, rect.x2) || b.minX > Math.max(rect.x1, rect.x2) || b.maxY < Math.min(rect.y1, rect.y2) || b.minY > Math.max(rect.y1, rect.y2));
        return overlaps;
      });
      state.selection = new Set(selected.map(e => e.id));
      state.activeCommand = null;
      drawScene();
    }
    return;
  }

  if (state.tool === 'delete') {
    addHistorySnapshot();
    const selected = getSelectedEntities();
    selected.forEach(ent => removeEntityById(ent.id));
    state.selection.clear();
    drawScene();
    return;
  }

  if (state.tool === 'move' || state.tool === 'copy' || state.tool === 'scale' || state.tool === 'rotate') {
    if (state.selection.size === 0) {
      const hit = [...state.entities].reverse().find(entity => entityContainsPoint(entity, snapped));
      if (hit) state.selection = new Set([hit.id]);
    }

    const selected = getSelectedEntities();
    if (selected.length === 0) return;

    state.activeCommand = {
      type: state.tool,
      base: snapped,
      original: selected.map(e => ({ ...e })),
      startSelection: [...state.selection],
      preview: { x: 0, y: 0 },
    };
    return;
  }

  if (state.tool === 'line') {
    state.activeCommand = {
      type: 'draw-line',
      start: snapped,
      preview: snapped,
      points: [snapped],
    };
    return;
  }

  if (state.tool === 'polyline') {
    if (!state.activeCommand || state.activeCommand.type !== 'draw-polyline') {
      state.activeCommand = { type: 'draw-polyline', points: [snapped], preview: snapped };
    } else {
      state.activeCommand.points.push(snapped);
      if (event.detail && event.detail === 2) {
        const segment = { type: 'polyline', points: state.activeCommand.points, layer: state.currentLayer };
        addEntity(segment);
        addHistorySnapshot();
        state.activeCommand = null;
      }
    }
    return;
  }

  if (state.tool === 'circle') {
    const center = snapped;
    state.activeCommand = { type: 'draw-circle', center, preview: center };
    return;
  }

  if (state.tool === 'arc') {
    const center = snapped;
    state.activeCommand = { type: 'draw-arc', center, start: snapped, preview: snapped };
    return;
  }

  if (state.tool === 'point') {
    addEntity({ type: 'point', x: snapped.x, y: snapped.y, layer: state.currentLayer, color: '#1d2430' });
    addHistorySnapshot();
    drawScene();
    return;
  }

  if (state.tool === 'text') {
    const text = window.prompt('Text value', 'TEXT');
    if (text) {
      addEntity({ type: 'text', x: snapped.x, y: snapped.y, text, layer: state.currentLayer, color: '#18212d' });
      addHistorySnapshot();
    }
    drawScene();
    return;
  }

  if (state.tool === 'rectangle') {
    state.activeCommand = { type: 'draw-rectangle', start: snapped, preview: snapped };
    return;
  }

  if (state.tool === 'bearing-distance') {
    const target = [...state.entities].filter(e => e.type === 'point').slice(-1)[0];
    if (!target) {
      alert('Create a survey point first before measuring bearing-distance.');
      return;
    }
    const from = { x: target.x, y: target.y };
    const to = snapped;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const bearingDeg = (90 - angle + 360) % 360;
    alert(`Bearing: ${bearingDeg.toFixed(2)}°  Distance: ${distance.toFixed(3)}`);
    return;
  }
}

function handleCanvasMouseUp(event) {
  if (!state.activeCommand) {
    state.dragStart = null;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const worldPoint = screenToWorld(x, y);

  if (state.tool === 'line') {
    const start = state.activeCommand.start;
    addEntity({ type: 'line', x1: start.x, y1: start.y, x2: worldPoint.x, y2: worldPoint.y, layer: state.currentLayer, color: '#18212d' });
    addHistorySnapshot();
    state.activeCommand = null;
    drawScene();
    return;
  }

  if (state.tool === 'circle') {
    const radius = Math.hypot(worldPoint.x - state.activeCommand.center.x, worldPoint.y - state.activeCommand.center.y);
    addEntity({ type: 'circle', cx: state.activeCommand.center.x, cy: state.activeCommand.center.y, r: radius, layer: state.currentLayer, color: '#18212d' });
    addHistorySnapshot();
    state.activeCommand = null;
    drawScene();
    return;
  }

  if (state.tool === 'arc') {
    const startAngle = Math.atan2(state.activeCommand.start.y - state.activeCommand.center.y, state.activeCommand.start.x - state.activeCommand.center.x);
    const endAngle = Math.atan2(worldPoint.y - state.activeCommand.center.y, worldPoint.x - state.activeCommand.center.x);
    const radius = Math.hypot(worldPoint.x - state.activeCommand.center.x, worldPoint.y - state.activeCommand.center.y);
    addEntity({ type: 'arc', cx: state.activeCommand.center.x, cy: state.activeCommand.center.y, r: radius, startAngle, endAngle, layer: state.currentLayer, color: '#18212d' });
    addHistorySnapshot();
    state.activeCommand = null;
    drawScene();
    return;
  }

  if (state.tool === 'rectangle') {
    const start = state.activeCommand.start;
    const end = worldPoint;
    addEntity({ type: 'rectangle', x1: start.x, y1: start.y, x2: end.x, y2: end.y, layer: state.currentLayer, color: '#18212d' });
    addHistorySnapshot();
    state.activeCommand = null;
    drawScene();
    return;
  }

  if (state.tool === 'move') {
    const dx = worldPoint.x - state.activeCommand.base.x;
    const dy = worldPoint.y - state.activeCommand.base.y;
    const ids = [...state.selection];
    ids.forEach(id => {
      const entity = state.entities.find(e => e.id === id);
      if (!entity) return;
      if (entity.type === 'line') {
        entity.x1 += dx;
        entity.y1 += dy;
        entity.x2 += dx;
        entity.y2 += dy;
      } else if (entity.type === 'polyline') {
        entity.points = entity.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      } else if (entity.type === 'circle') {
        entity.cx += dx;
        entity.cy += dy;
      } else if (entity.type === 'arc') {
        entity.cx += dx;
        entity.cy += dy;
      } else if (entity.type === 'point') {
        entity.x += dx;
        entity.y += dy;
      } else if (entity.type === 'text') {
        entity.x += dx;
        entity.y += dy;
      } else if (entity.type === 'rectangle') {
        entity.x1 += dx;
        entity.y1 += dy;
        entity.x2 += dx;
        entity.y2 += dy;
      }
    });
    addHistorySnapshot();
    state.activeCommand = null;
  }

  if (state.tool === 'copy') {
    const dx = worldPoint.x - state.activeCommand.base.x;
    const dy = worldPoint.y - state.activeCommand.base.y;
    const originalIds = [...state.selection];
    originalIds.forEach(id => {
      const entity = state.entities.find(e => e.id === id);
      if (!entity) return;
      const clone = JSON.parse(JSON.stringify(entity));
      clone.id = state.nextId++;
      if (clone.type === 'line') {
        clone.x1 += dx;
        clone.y1 += dy;
        clone.x2 += dx;
        clone.y2 += dy;
      } else if (clone.type === 'polyline') {
        clone.points = clone.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      } else if (clone.type === 'circle') {
        clone.cx += dx;
        clone.cy += dy;
      } else if (clone.type === 'arc') {
        clone.cx += dx;
        clone.cy += dy;
      } else if (clone.type === 'point') {
        clone.x += dx;
        clone.y += dy;
      } else if (clone.type === 'text') {
        clone.x += dx;
        clone.y += dy;
      } else if (clone.type === 'rectangle') {
        clone.x1 += dx;
        clone.y1 += dy;
        clone.x2 += dx;
        clone.y2 += dy;
      }
      state.entities.push(clone);
      state.selection.add(clone.id);
    });
    addHistorySnapshot();
    state.activeCommand = null;
  }

  if (state.tool === 'scale') {
    const selected = getSelectedEntities();
    if (selected.length > 0) {
      selected.forEach(entity => {
        const dx = worldPoint.x - state.activeCommand.base.x;
        const dy = worldPoint.y - state.activeCommand.base.y;
        const scaleFactor = 1 + (Math.hypot(dx, dy) * 0.01);
        if (entity.type === 'line') {
          entity.x1 = state.activeCommand.original.find(e => e.id === entity.id).x1 * scaleFactor;
          entity.x2 = state.activeCommand.original.find(e => e.id === entity.id).x2 * scaleFactor;
          entity.y1 = state.activeCommand.original.find(e => e.id === entity.id).y1 * scaleFactor;
          entity.y2 = state.activeCommand.original.find(e => e.id === entity.id).y2 * scaleFactor;
        }
      });
    }
    addHistorySnapshot();
    state.activeCommand = null;
  }

  if (state.tool === 'rotate') {
    const selected = getSelectedEntities();
    if (selected.length > 0) {
      const origin = state.activeCommand.base;
      const angle = Math.atan2(worldPoint.y - origin.y, worldPoint.x - origin.x);
      selected.forEach(entity => {
        const original = state.activeCommand.original.find(e => e.id === entity.id);
        if (!original) return;
        if (entity.type === 'line') {
          const x1 = original.x1 - origin.x;
          const y1 = original.y1 - origin.y;
          const x2 = original.x2 - origin.x;
          const y2 = original.y2 - origin.y;
          entity.x1 = origin.x + x1 * Math.cos(angle) - y1 * Math.sin(angle);
          entity.y1 = origin.y + x1 * Math.sin(angle) + y1 * Math.cos(angle);
          entity.x2 = origin.x + x2 * Math.cos(angle) - y2 * Math.sin(angle);
          entity.y2 = origin.y + x2 * Math.sin(angle) + y2 * Math.cos(angle);
        }
      });
    }
    addHistorySnapshot();
    state.activeCommand = null;
  }

  drawScene();
}

function handleWheel(event) {
  event.preventDefault();
  const delta = event.deltaY < 0 ? 1.15 : 0.85;
  const before = screenToWorld(event.clientX - canvas.getBoundingClientRect().left, event.clientY - canvas.getBoundingClientRect().top);
  state.view.scale *= delta;
  state.view.scale = Math.max(0.2, Math.min(100, state.view.scale));
  const after = screenToWorld(event.clientX - canvas.getBoundingClientRect().left, event.clientY - canvas.getBoundingClientRect().top);
  state.view.centerX += before.x - after.x;
  state.view.centerY += before.y - after.y;
  drawScene();
}

function fitView() {
  if (!state.entities.length) {
    state.view.centerX = 0;
    state.view.centerY = 0;
    state.view.scale = 1;
    drawScene();
    return;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  state.entities.forEach(entity => {
    const b = entityBounds(entity);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  });
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  state.view.scale = Math.min(canvas.width / width, canvas.height / height) * 0.8;
  state.view.centerX = (minX + maxX) / 2;
  state.view.centerY = (minY + maxY) / 2;
  drawScene();
}

function zoom(step) {
  const factor = step > 0 ? 1.2 : 0.8;
  state.view.scale *= factor;
  state.view.scale = Math.max(0.2, Math.min(100, state.view.scale));
  drawScene();
}

function loadSampleDrawing() {
  const entities = [
    { id: 1, type: 'line', x1: 0, y1: 0, x2: 100, y2: 50, layer: 'SURVEY', color: '#18212d' },
    { id: 2, type: 'line', x1: 100, y1: 50, x2: 160, y2: 10, layer: 'SURVEY', color: '#18212d' },
    { id: 3, type: 'circle', cx: 120, cy: 120, r: 30, layer: 'SURVEY', color: '#18212d' },
    { id: 4, type: 'point', x: 80, y: 80, layer: 'SURVEY', color: '#18212d' },
    { id: 5, type: 'text', x: 30, y: 15, text: 'LOT 14', layer: 'TEXT', color: '#18212d' },
  ];

  state.entities = entities;
  state.nextId = 100;
  state.selection.clear();
  fitView();
  pushHistory('sample');
}

function exportDXF() {
  let dxf = '0\nSECTION\n2\nENTITIES\n';
  state.entities.forEach(entity => {
    if (entity.type === 'line') {
      dxf += '0\nLINE\n8\n' + (entity.layer || '0') + '\n10\n' + entity.x1 + '\n20\n' + entity.y1 + '\n11\n' + entity.x2 + '\n21\n' + entity.y2 + '\n';
    }
    if (entity.type === 'circle') {
      dxf += '0\nCIRCLE\n8\n' + (entity.layer || '0') + '\n10\n' + entity.cx + '\n20\n' + entity.cy + '\n40\n' + entity.r + '\n';
    }
    if (entity.type === 'arc') {
      dxf += '0\nARC\n8\n' + (entity.layer || '0') + '\n10\n' + entity.cx + '\n20\n' + entity.cy + '\n40\n' + entity.r + '\n50\n' + (entity.startAngle * 180 / Math.PI) + '\n51\n' + (entity.endAngle * 180 / Math.PI) + '\n';
    }
    if (entity.type === 'text') {
      dxf += '0\nTEXT\n8\n' + (entity.layer || '0') + '\n10\n' + entity.x + '\n20\n' + entity.y + '\n1\n' + entity.text + '\n';
    }
    if (entity.type === 'point') {
      dxf += '0\nPOINT\n8\n' + (entity.layer || '0') + '\n10\n' + entity.x + '\n20\n' + entity.y + '\n';
    }
  });
  dxf += 'ENDSEC\n0\nEOF\n';

  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'frontier-cad-export.dxf';
  a.click();
  URL.revokeObjectURL(url);
  alert('DXF exported.');
}

function importDXFFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const text = event.target.result;
    const lines = text.split(/\r?\n/);
    const entities = [];
    let i = 0;

    while (i < lines.length) {
      const code = lines[i].trim();
      if (!code) { i++; continue; }
      const next = lines[i + 1]?.trim();
      const next2 = lines[i + 2]?.trim();
      if (code === 'LINE') {
        const layer = next2 || '0';
        const x1 = Number(lines[i + 3]?.trim());
        const y1 = Number(lines[i + 5]?.trim());
        const x2 = Number(lines[i + 7]?.trim());
        const y2 = Number(lines[i + 9]?.trim());
        entities.push({ type: 'line', x1, y1, x2, y2, layer });
        i += 11;
      } else if (code === 'CIRCLE') {
        const layer = next2 || '0';
        const cx = Number(lines[i + 3]?.trim());
        const cy = Number(lines[i + 5]?.trim());
        const r = Number(lines[i + 7]?.trim());
        entities.push({ type: 'circle', cx, cy, r, layer });
        i += 9;
      } else if (code === 'ARC') {
        const layer = next2 || '0';
        const cx = Number(lines[i + 3]?.trim());
        const cy = Number(lines[i + 5]?.trim());
        const r = Number(lines[i + 7]?.trim());
        const sa = Number(lines[i + 9]?.trim()) * Math.PI / 180;
        const ea = Number(lines[i + 11]?.trim()) * Math.PI / 180;
        entities.push({ type: 'arc', cx, cy, r, startAngle: sa, endAngle: ea, layer });
        i += 13;
      } else if (code === 'TEXT') {
        const layer = next2 || '0';
        const x = Number(lines[i + 3]?.trim());
        const y = Number(lines[i + 5]?.trim());
        const text = lines[i + 9]?.trim() || 'TEXT';
        entities.push({ type: 'text', x, y, text, layer });
        i += 11;
      } else if (code === 'POINT') {
        const layer = next2 || '0';
        const x = Number(lines[i + 3]?.trim());
        const y = Number(lines[i + 5]?.trim());
        entities.push({ type: 'point', x, y, layer });
        i += 8;
      } else {
        i++;
      }
    }

    state.entities = entities.map(e => ({ ...e, color: '#18212d' }));
    state.selection.clear();
    addHistorySnapshot();
    fitView();
    drawScene();
  };
  reader.readAsText(file);
}

function parseCSV(filename) {
  // Lightweight CSV parser for survey point arrays.
  return [];
}

function initializeButtons() {
  document.querySelectorAll('[data-tool]').forEach(button => {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool;

      if (tool === 'undo') {
        undo();
        return;
      }
      if (tool === 'redo') {
        redo();
        return;
      }
      if (tool === 'zoom-in') {
        zoom(1);
        return;
      }
      if (tool === 'zoom-out') {
        zoom(-1);
        return;
      }
      if (tool === 'fit-view') {
        fitView();
        return;
      }
      if (tool === 'import-dxf') {
        fileImportInput.click();
        return;
      }
      if (tool === 'export-dxf') {
        exportDXF();
        return;
      }
      if (tool === 'delete') {
        setTool('delete');
        return;
      }
      if (tool === 'toggle-layer') {
        if (state.layers[state.currentLayer]) {
          state.layers[state.currentLayer].visible = !state.layers[state.currentLayer].visible;
        }
        drawScene();
        return;
      }
      if (tool === 'reference-attach') {
        fileImportInput.click();
        return;
      }
      if (tool === 'reference-toggle') {
        state.refs.forEach(ref => ref.visible = !ref.visible);
        drawScene();
        return;
      }
      if (tool === 'reference-detach') {
        state.refs = [];
        drawScene();
        return;
      }
      if (tool === 'new') {
        state.entities = [];
        state.selection.clear();
        state.view.centerX = 0;
        state.view.centerY = 0;
        state.view.scale = 1;
        drawScene();
        return;
      }
      if (tool === 'save') {
        localStorage.setItem('frontier-cad', JSON.stringify({ entities: state.entities, refs: state.refs, view: state.view }));
        alert('Drawing saved locally.');
        return;
      }
      if (tool === 'open') {
        const saved = localStorage.getItem('frontier-cad');
        if (saved) {
          const parsed = JSON.parse(saved);
          state.entities = parsed.entities || [];
          state.refs = parsed.refs || [];
          state.view = parsed.view || state.view;
          drawScene();
        } else {
          alert('No saved drawing found.');
        }
        return;
      }
      if (tool === 'point-label') {
        const selected = getSelectedEntities();
        if (selected.length) {
          selected.forEach(ent => {
            if (ent.type === 'point') {
              ent.label = `P${ent.id}`;
            }
          });
        }
        drawScene();
        return;
      }

      setTool(tool);
    });
  });
}

canvas.addEventListener('mousemove', handleCanvasMouseMove);
canvas.addEventListener('mousedown', handleCanvasMouseDown);
canvas.addEventListener('mouseup', handleCanvasMouseUp);
canvas.addEventListener('wheel', handleWheel, { passive: false });

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    state.activeCommand = null;
    state.dragPreview = null;
    state.snapPoint = null;
    drawScene();
  }
  if (event.key === 'Delete') {
    state.selection.forEach(id => removeEntityById(id));
    state.selection.clear();
    drawScene();
  }
  if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    undo();
  }
  if (event.key === 'y' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    redo();
  }
});

fileImportInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  importDXFFile(file);
  fileImportInput.value = '';
});

initializeButtons();
updateToolLabel();
updateButtonStates();
syncLayerSelect();
loadSampleDrawing();
drawScene();

console.log('Frontier CAD initialized.');
