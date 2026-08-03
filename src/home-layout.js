const HOME_LAYOUT_COLUMNS = 5;
const HOME_LAYOUT_MAX_ROW_SPAN = 3;
const HOME_LAYOUT_SETTING_KEY = 'default';
const HOME_LAYOUT_SCHEMA_VERSION = 4;

const HOME_LAYOUT_SECTIONS = {
  INPUT: 'input',
  ACCOUNTING: 'accounting',
  ADMIN: 'admin'
};

const HOME_LAYOUT_ITEMS = [
  { id: 'shift-entry', section: HOME_LAYOUT_SECTIONS.INPUT, col: 1, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'invoice', section: HOME_LAYOUT_SECTIONS.INPUT, col: 2, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'safe-book-entry', section: HOME_LAYOUT_SECTIONS.INPUT, col: 3, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'customer-balance', section: HOME_LAYOUT_SECTIONS.INPUT, col: 4, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'accounting', section: HOME_LAYOUT_SECTIONS.INPUT, col: 1, row: 2, colSpan: 1, rowSpan: 1 },
  { id: 'annual-inventory', section: HOME_LAYOUT_SECTIONS.INPUT, col: 2, row: 2, colSpan: 1, rowSpan: 1 },

  { id: 'chart', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 3, row: 1, colSpan: 3, rowSpan: 2, lockedSize: true, lockedPosition: true },
  { id: 'profit-chart', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 3, row: 3, colSpan: 3, rowSpan: 2, lockedSize: true, lockedPosition: true },
  { id: 'sales-summary', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 1, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'safe-book', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 2, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'profit', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 1, row: 2, colSpan: 1, rowSpan: 1 },
  { id: 'expenses', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 2, row: 2, colSpan: 1, rowSpan: 1 },
  { id: 'customer-invoices', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 1, row: 3, colSpan: 1, rowSpan: 1 },
  { id: 'company-vouchers', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 2, row: 3, colSpan: 1, rowSpan: 1 },
  { id: 'tank-management', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 3, row: 3, colSpan: 1, rowSpan: 1 },
  { id: 'shift-history', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 4, row: 3, colSpan: 1, rowSpan: 1 },
  { id: 'sales-reconciliation', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 1, row: 4, colSpan: 1, rowSpan: 1 },

  { id: 'depot', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 1, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'manage-products', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 2, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'manage-customers', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 3, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'excel-sales-import', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 4, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'app-users', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 5, row: 1, colSpan: 1, rowSpan: 1 },
  { id: 'excel-expenses-import', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 1, row: 2, colSpan: 1, rowSpan: 1 },
  { id: 'backup', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 2, row: 2, colSpan: 1, rowSpan: 1 }
];

const HOME_LAYOUT_ITEM_IDS = new Set(HOME_LAYOUT_ITEMS.map((item) => item.id));
const HOME_LAYOUT_SECTION_IDS = new Set(Object.values(HOME_LAYOUT_SECTIONS));

function toInt(value, fallback) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDefaultHomeLayout() {
  return HOME_LAYOUT_ITEMS.map((item) => ({ ...item }));
}

function isHomeLayoutItemLocked(itemId) {
  return HOME_LAYOUT_ITEMS.find((item) => item.id === itemId)?.lockedSize === true;
}

function normalizeHomeLayout(layout = [], options = {}) {
  const sourceById = new Map(
    (Array.isArray(layout) ? layout : [])
      .filter((item) => HOME_LAYOUT_ITEM_IDS.has(String(item?.id || '').trim()))
      .map((item) => [String(item.id).trim(), item])
  );

  const normalized = HOME_LAYOUT_ITEMS.map((defaultItem) => {
    const source = sourceById.get(defaultItem.id) || {};
    const lockedSize = defaultItem.lockedSize === true;
    const lockedPosition = defaultItem.lockedPosition === true;
    const sourceSection = String(source.section || '').trim();
    const hasValidSourceSection = HOME_LAYOUT_SECTION_IDS.has(sourceSection);
    const section = hasValidSourceSection ? sourceSection : defaultItem.section;
    const colSpan = lockedSize
      ? defaultItem.colSpan
      : clamp(toInt(hasValidSourceSection ? source.colSpan : undefined, defaultItem.colSpan), 1, HOME_LAYOUT_COLUMNS);
    const rowSpan = lockedSize
      ? defaultItem.rowSpan
      : clamp(toInt(hasValidSourceSection ? source.rowSpan : undefined, defaultItem.rowSpan), 1, HOME_LAYOUT_MAX_ROW_SPAN);
    const col = lockedPosition
      ? defaultItem.col
      : clamp(toInt(hasValidSourceSection ? source.col : undefined, defaultItem.col), 1, HOME_LAYOUT_COLUMNS - colSpan + 1);
    const row = lockedPosition
      ? defaultItem.row
      : Math.max(1, toInt(hasValidSourceSection ? source.row : undefined, defaultItem.row));

    return {
      id: defaultItem.id,
      section,
      col,
      row,
      colSpan,
      rowSpan,
      lockedSize,
      lockedPosition
    };
  });

  return resolveHomeLayoutCollisions(normalized, options);
}

function rectsOverlap(a, b) {
  return !(
    a.col + a.colSpan - 1 < b.col
    || b.col + b.colSpan - 1 < a.col
    || a.row + a.rowSpan - 1 < b.row
    || b.row + b.rowSpan - 1 < a.row
  );
}

function hasCollision(candidate, placed) {
  return placed.some((item) => item.section === candidate.section && rectsOverlap(candidate, item));
}

function findFirstFreePosition(item, placed) {
  const maxCol = HOME_LAYOUT_COLUMNS - item.colSpan + 1;
  for (let row = 1; row < 200; row += 1) {
    for (let col = 1; col <= maxCol; col += 1) {
      const candidate = { ...item, row, col };
      if (!hasCollision(candidate, placed)) return candidate;
    }
  }
  return { ...item, row: 1, col: 1 };
}

function resolveHomeLayoutCollisions(layout = [], options = {}) {
  const priorityItemId = String(options.priorityItemId || '').trim();
  const placed = [];
  const sorted = [...layout].sort((a, b) => {
    if (a.lockedPosition !== b.lockedPosition) return a.lockedPosition ? -1 : 1;
    if (priorityItemId) {
      if (a.id === priorityItemId && b.id !== priorityItemId) return -1;
      if (b.id === priorityItemId && a.id !== priorityItemId) return 1;
    }
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    if (a.row !== b.row) return a.row - b.row;
    if (a.col !== b.col) return a.col - b.col;
    return HOME_LAYOUT_ITEMS.findIndex((item) => item.id === a.id) - HOME_LAYOUT_ITEMS.findIndex((item) => item.id === b.id);
  });

  sorted.forEach((item) => {
    const normalizedItem = {
      ...item,
      colSpan: clamp(toInt(item.colSpan, 1), 1, HOME_LAYOUT_COLUMNS),
      rowSpan: clamp(toInt(item.rowSpan, 1), 1, HOME_LAYOUT_MAX_ROW_SPAN)
    };
    normalizedItem.col = clamp(toInt(item.col, 1), 1, HOME_LAYOUT_COLUMNS - normalizedItem.colSpan + 1);
    normalizedItem.row = Math.max(1, toInt(item.row, 1));
    const nextItem = hasCollision(normalizedItem, placed)
      ? findFirstFreePosition(normalizedItem, placed)
      : normalizedItem;
    placed.push(nextItem);
  });

  return placed.sort((a, b) => HOME_LAYOUT_ITEMS.findIndex((item) => item.id === a.id) - HOME_LAYOUT_ITEMS.findIndex((item) => item.id === b.id));
}

function calculateHomeResizePatch(start = {}, corner = 'se', point = {}) {
  const normalizedCorner = ['nw', 'ne', 'sw', 'se'].includes(corner) ? corner : 'se';
  const startCol = clamp(toInt(start.col, 1), 1, HOME_LAYOUT_COLUMNS);
  const startColSpan = clamp(toInt(start.colSpan, 1), 1, HOME_LAYOUT_COLUMNS - startCol + 1);
  const startColEnd = startCol + startColSpan - 1;
  const startRow = Math.max(1, toInt(start.row, 1));
  const startRowSpan = clamp(toInt(start.rowSpan, 1), 1, HOME_LAYOUT_MAX_ROW_SPAN);
  const startRowEnd = startRow + startRowSpan - 1;
  const pointCol = clamp(toInt(point.col, startCol), 1, HOME_LAYOUT_COLUMNS);
  const pointRow = Math.max(1, toInt(point.row, startRow));

  let col = startCol;
  let colEnd = startColEnd;
  let row = startRow;
  let rowEnd = startRowEnd;

  if (normalizedCorner === 'ne' || normalizedCorner === 'se') {
    col = clamp(pointCol, 1, startColEnd);
  } else {
    colEnd = clamp(pointCol, startCol, HOME_LAYOUT_COLUMNS);
  }

  if (normalizedCorner === 'nw' || normalizedCorner === 'ne') {
    row = clamp(pointRow, 1, startRowEnd);
  } else {
    rowEnd = Math.max(startRow, pointRow);
  }

  let rowSpan = rowEnd - row + 1;
  if (rowSpan > HOME_LAYOUT_MAX_ROW_SPAN) {
    if (normalizedCorner === 'nw' || normalizedCorner === 'ne') {
      row = rowEnd - HOME_LAYOUT_MAX_ROW_SPAN + 1;
    } else {
      rowEnd = row + HOME_LAYOUT_MAX_ROW_SPAN - 1;
    }
    rowSpan = HOME_LAYOUT_MAX_ROW_SPAN;
  }

  return {
    col,
    row,
    colSpan: colEnd - col + 1,
    rowSpan
  };
}

function serializeHomeLayout(layout = [], options = {}) {
  return normalizeHomeLayout(layout, options).map(({ id, section, col, row, colSpan, rowSpan }) => ({
    id,
    section,
    col,
    row,
    colSpan,
    rowSpan
  }));
}

module.exports = {
  HOME_LAYOUT_COLUMNS,
  HOME_LAYOUT_ITEM_IDS,
  HOME_LAYOUT_ITEMS,
  HOME_LAYOUT_MAX_ROW_SPAN,
  HOME_LAYOUT_SCHEMA_VERSION,
  HOME_LAYOUT_SECTIONS,
  HOME_LAYOUT_SETTING_KEY,
  calculateHomeResizePatch,
  getDefaultHomeLayout,
  isHomeLayoutItemLocked,
  normalizeHomeLayout,
  resolveHomeLayoutCollisions,
  serializeHomeLayout
};
