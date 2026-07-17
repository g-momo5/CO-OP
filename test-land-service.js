const test = require('node:test');
const assert = require('node:assert/strict');
const { LandService } = require('./src/land-service');

class MemoryLandManager {
  constructor() {
    this.plots = [];
    this.nextId = 1;
  }

  async executeQuery(sql, params = []) {
    if (sql.includes('FROM land_plots WHERE id = $1 AND archived_at IS NULL LIMIT 1')) {
      const row = this.plots.find((plot) => plot.id === params[0] && !plot.archived_at);
      return row ? [{ ...row }] : [];
    }
    if (sql.includes('FROM land_payments') && sql.includes('COUNT(*) AS count')) {
      return [{ count: 0 }];
    }
    if (sql.includes('FROM land_assignments') && sql.includes('SUM(assigned_sahm)')) {
      return [{ assigned_sahm: 0 }];
    }
    if (sql.includes('FROM land_seasons')) return [];
    if (sql.includes('FROM land_plot_terms')) return [];
    return [];
  }

  async executeInsert(sql, params = []) {
    if (sql.includes('INSERT INTO land_plots')) {
      if (this.plots.some((plot) => plot.plot_code === params[0])) {
        throw new Error('UNIQUE constraint failed: land_plots.plot_code');
      }
      const row = {
        id: this.nextId++,
        plot_code: params[0],
        name: params[1],
        location: params[2],
        description: params[3],
        total_sahm: params[4],
        status: 'available',
        notes: params[5],
        created_at: params[6],
        updated_at: params[7],
        archived_at: null
      };
      this.plots.push(row);
      return row.id;
    }
    return 1;
  }

  async executeUpdate(sql, params = []) {
    if (sql.includes('UPDATE land_plots SET archived_at')) {
      const id = params[2];
      const row = this.plots.find((plot) => plot.id === id);
      row.archived_at = params[0];
      row.updated_at = params[1];
      return 1;
    }
    if (sql.includes('UPDATE land_plots')) {
      const id = params[6];
      const row = this.plots.find((plot) => plot.id === id);
      row.name = params[0];
      row.location = params[1];
      row.description = params[2];
      row.total_sahm = params[3];
      row.notes = params[4];
      row.updated_at = params[5];
      return 1;
    }
    return 0;
  }
}

test('plot code is generated once and remains immutable on plot updates', async () => {
  const manager = new MemoryLandManager();
  const service = new LandService(() => manager, {});

  const created = await service.savePlot({
    name: 'أرض أولى',
    location: 'سمنود',
    feddan: 1,
    qirat: 0,
    sahm: 0,
    plot_code: 'USER-CODE'
  });

  assert.match(created.plot_code, /^LAND-/);
  assert.notEqual(created.plot_code, 'USER-CODE');

  const updated = await service.savePlot({
    id: created.id,
    name: 'أرض بعد التعديل',
    location: 'موقع جديد',
    feddan: 1,
    qirat: 12,
    sahm: 0,
    plot_code: 'SHOULD-NOT-CHANGE'
  });

  assert.equal(updated.plot_code, created.plot_code);
  assert.equal(updated.name, 'أرض بعد التعديل');
  assert.equal(updated.total_sahm, 864);
});

test('archived plot code is never reused for a new plot', async () => {
  const manager = new MemoryLandManager();
  const generatedCodes = ['LAND-OLD-CODE', 'LAND-OLD-CODE', 'LAND-NEW-CODE'];
  const service = new LandService(() => manager, {
    generatePlotCode: () => generatedCodes.shift()
  });

  const archivedPlot = await service.savePlot({
    name: 'أرض سيتم حذفها',
    feddan: 1,
    qirat: 0,
    sahm: 0
  });
  await service.archivePlot({ id: archivedPlot.id });

  const newPlot = await service.savePlot({
    name: 'أرض جديدة',
    feddan: 1,
    qirat: 0,
    sahm: 0
  });

  assert.equal(archivedPlot.plot_code, 'LAND-OLD-CODE');
  assert.equal(newPlot.plot_code, 'LAND-NEW-CODE');
  assert.notEqual(newPlot.plot_code, archivedPlot.plot_code);
  assert.equal(manager.plots.filter((plot) => plot.plot_code === archivedPlot.plot_code).length, 1);
});
