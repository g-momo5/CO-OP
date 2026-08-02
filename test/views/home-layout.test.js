const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HOME_LAYOUT_COLUMNS,
  HOME_LAYOUT_SECTIONS,
  calculateHomeResizePatch,
  getDefaultHomeLayout,
  normalizeHomeLayout,
  resolveHomeLayoutCollisions,
  serializeHomeLayout
} = require('../../src/home-layout');

function overlaps(a, b) {
  return !(
    a.col + a.colSpan - 1 < b.col
    || b.col + b.colSpan - 1 < a.col
    || a.row + a.rowSpan - 1 < b.row
    || b.row + b.rowSpan - 1 < a.row
  );
}

test('default home layout keeps chart in accounting at 3 columns by 2 rows', () => {
  const layout = getDefaultHomeLayout();
  const chart = layout.find((item) => item.id === 'chart');

  assert.equal(chart.section, HOME_LAYOUT_SECTIONS.ACCOUNTING);
  assert.equal(chart.col, 3);
  assert.equal(chart.colSpan, 3);
  assert.equal(chart.rowSpan, 2);
});

test('normalizes home layout dimensions inside the five-column grid', () => {
  const layout = normalizeHomeLayout([
    { id: 'invoice', section: HOME_LAYOUT_SECTIONS.ADMIN, col: 5, row: 1, colSpan: 6, rowSpan: 9 }
  ]);
  const invoice = layout.find((item) => item.id === 'invoice');
  const chart = layout.find((item) => item.id === 'chart');

  assert.equal(invoice.section, HOME_LAYOUT_SECTIONS.ADMIN);
  assert.equal(invoice.colSpan, HOME_LAYOUT_COLUMNS);
  assert.equal(invoice.rowSpan, 3);
  assert.equal(invoice.col, 1);
  assert.equal(chart.col, 3);
  assert.equal(chart.colSpan, 3);
  assert.equal(chart.rowSpan, 2);
});

test('legacy home layout sections fall back to new default positions', () => {
  const layout = normalizeHomeLayout([
    { id: 'chart', section: 'office', col: 3, row: 1, colSpan: 3, rowSpan: 2 },
    { id: 'depot', section: 'office', col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    { id: 'shift-history', section: 'sales', col: 2, row: 1, colSpan: 1, rowSpan: 1 }
  ]);

  const chart = layout.find((item) => item.id === 'chart');
  const depot = layout.find((item) => item.id === 'depot');
  const shiftHistory = layout.find((item) => item.id === 'shift-history');

  assert.equal(chart.section, HOME_LAYOUT_SECTIONS.ACCOUNTING);
  assert.equal(chart.col, 3);
  assert.equal(chart.row, 1);
  assert.equal(depot.section, HOME_LAYOUT_SECTIONS.ADMIN);
  assert.equal(depot.col, 1);
  assert.equal(depot.row, 1);
  assert.equal(shiftHistory.section, HOME_LAYOUT_SECTIONS.ACCOUNTING);
  assert.equal(shiftHistory.col, 4);
  assert.equal(shiftHistory.row, 3);
});

test('admin defaults keep sales import next to customer management', () => {
  const layout = getDefaultHomeLayout();
  const customers = layout.find((item) => item.id === 'manage-customers');
  const salesImport = layout.find((item) => item.id === 'excel-sales-import');
  const users = layout.find((item) => item.id === 'app-users');

  assert.equal(customers.section, HOME_LAYOUT_SECTIONS.ADMIN);
  assert.equal(customers.col, 3);
  assert.equal(salesImport.section, HOME_LAYOUT_SECTIONS.ADMIN);
  assert.equal(salesImport.col, 4);
  assert.equal(users.section, HOME_LAYOUT_SECTIONS.ADMIN);
  assert.equal(users.col, 5);
});

test('home layout collision resolver places items in free grid cells', () => {
  const layout = resolveHomeLayoutCollisions([
    { id: 'chart', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 1, row: 1, colSpan: 3, rowSpan: 2, lockedSize: true },
    { id: 'invoice', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 1, row: 1, colSpan: 2, rowSpan: 1 },
    { id: 'depot', section: HOME_LAYOUT_SECTIONS.ACCOUNTING, col: 2, row: 1, colSpan: 2, rowSpan: 1 }
  ]);

  const accountingItems = layout.filter((item) => item.section === HOME_LAYOUT_SECTIONS.ACCOUNTING);
  for (let i = 0; i < accountingItems.length; i += 1) {
    for (let j = i + 1; j < accountingItems.length; j += 1) {
      assert.equal(overlaps(accountingItems[i], accountingItems[j]), false);
    }
  }
});

test('home layout collision resolver keeps the active dragged item when possible', () => {
  const layout = resolveHomeLayoutCollisions([
    { id: 'invoice', section: HOME_LAYOUT_SECTIONS.INPUT, col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    { id: 'depot', section: HOME_LAYOUT_SECTIONS.INPUT, col: 1, row: 1, colSpan: 1, rowSpan: 1 }
  ], { priorityItemId: 'depot' });

  const depot = layout.find((item) => item.id === 'depot');
  const invoice = layout.find((item) => item.id === 'invoice');

  assert.equal(depot.col, 1);
  assert.equal(depot.row, 1);
  assert.equal(overlaps(depot, invoice), false);
});

test('serialized input layout preserves the last dragged card when saving', () => {
  const layout = serializeHomeLayout(
    getDefaultHomeLayout().map((item) => (
      item.id === 'accounting'
        ? { ...item, section: HOME_LAYOUT_SECTIONS.INPUT, col: 5, row: 1 }
        : item
    )),
    { priorityItemId: 'accounting' }
  );

  const accounting = layout.find((item) => item.id === 'accounting');

  assert.equal(accounting.section, HOME_LAYOUT_SECTIONS.INPUT);
  assert.equal(accounting.col, 5);
  assert.equal(accounting.row, 1);
});

test('home resize handles keep the opposite edge fixed', () => {
  const start = { col: 2, row: 2, colSpan: 2, rowSpan: 2 };

  assert.deepEqual(
    calculateHomeResizePatch(start, 'nw', { col: 4, row: 1 }),
    { col: 2, row: 1, colSpan: 3, rowSpan: 3 }
  );
  assert.deepEqual(
    calculateHomeResizePatch(start, 'ne', { col: 1, row: 1 }),
    { col: 1, row: 1, colSpan: 3, rowSpan: 3 }
  );
  assert.deepEqual(
    calculateHomeResizePatch(start, 'sw', { col: 4, row: 5 }),
    { col: 2, row: 2, colSpan: 3, rowSpan: 3 }
  );
  assert.deepEqual(
    calculateHomeResizePatch(start, 'se', { col: 1, row: 5 }),
    { col: 1, row: 2, colSpan: 3, rowSpan: 3 }
  );
});
