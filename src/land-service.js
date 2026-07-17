const fs = require('fs');
const crypto = require('crypto');
const {
  surfaceToSahm,
  sahmToSurface,
  formatSurface,
  parseMoneyToCents,
  formatMoney,
  calculateRentByFeddan,
  calculateProportionalAmount,
  validateAvailableSurface,
  splitInstallments,
  calculatePaymentSummary,
  derivePlotStatus
} = require('./land-domain');

const LAND_TABLES = [
  'land_seasons',
  'land_plots',
  'land_plot_terms',
  'land_tenants',
  'land_assignments',
  'land_installments',
  'land_payments',
  'land_receipts',
  'land_settings'
];

const PAYMENT_STATUS_LABELS = {
  unpaid: 'غير مدفوع',
  first_partial: 'القسط الأول مدفوع جزئياً',
  first_paid: 'تم دفع القسط الأول',
  second_partial: 'القسط الثاني مدفوع جزئياً',
  paid_full: 'مدفوع بالكامل',
  overpaid: 'دفعة زائدة',
  overdue: 'متأخر'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function generatePlotCode() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `LAND-${timestamp}-${suffix}`;
}

function normalizeDate(value) {
  const normalized = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function shiftDateByYears(value, years) {
  const normalized = normalizeDate(value);
  if (!normalized) return null;
  const sourceYear = parseInt(normalized.slice(0, 4), 10);
  const month = parseInt(normalized.slice(5, 7), 10);
  const day = parseInt(normalized.slice(8, 10), 10);
  const targetYear = sourceYear + years;
  const maxDay = new Date(targetYear, month, 0).getDate();
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
}

function centsToMoneyInput(cents) {
  const safeCents = Number(cents);
  if (!Number.isFinite(safeCents)) return '';
  return `${Math.floor(safeCents / 100)}.${String(Math.abs(safeCents % 100)).padStart(2, '0')}`;
}

function normalizeRentAdjustmentMode(value) {
  return ['fixed_total', 'unit_price'].includes(value) ? value : 'none';
}

function calculateAdjustedRent(baseRentCents, assignedSahm, mode, adjustmentCents) {
  const safeBase = Number(baseRentCents) || 0;
  const safeAdjustment = Number(adjustmentCents) || 0;
  if (mode === 'fixed_total') return safeBase + safeAdjustment;
  if (mode === 'unit_price') return safeBase + calculateRentByFeddan(assignedSahm, safeAdjustment);
  return safeBase;
}

function combinePaymentStatus(totalRentCents, totalPaidCents, remainingCents) {
  if (totalPaidCents > totalRentCents) return 'overpaid';
  if (remainingCents <= 0 && totalRentCents > 0) return 'paid_full';
  if (totalPaidCents > 0) return 'first_partial';
  return 'unpaid';
}

function toId(value, fieldName = 'id') {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} غير صالح`);
  }
  return parsed;
}

function toOptionalId(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  return parseMoneyToCents(value);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSurfacePayload(payload = {}) {
  if (Number.isInteger(payload.total_sahm)) return payload.total_sahm;
  if (Number.isInteger(payload.assigned_sahm)) return payload.assigned_sahm;
  return surfaceToSahm({
    feddan: parseInt(payload.feddan || 0, 10),
    qirat: parseInt(payload.qirat || 0, 10),
    sahm: parseInt(payload.sahm || 0, 10)
  });
}

function enrichSurface(row, key = 'total_sahm') {
  const totalSahm = Number(row?.[key]) || 0;
  return {
    ...row,
    [`${key}_parts`]: sahmToSurface(totalSahm),
    [`${key}_label`]: formatSurface(totalSahm)
  };
}

function moneyFields(row, fields) {
  const output = { ...row };
  fields.forEach((field) => {
    output[`${field}_egp`] = formatMoney(Number(row?.[field]) || 0);
  });
  return output;
}

class LandService {
  constructor(getDbManager, options = {}) {
    this.getDbManager = getDbManager;
    this.dialog = options.dialog;
    this.generatePlotCode = options.generatePlotCode || generatePlotCode;
  }

  get dbManager() {
    const manager = this.getDbManager();
    if (!manager) throw new Error('قاعدة البيانات غير جاهزة');
    return manager;
  }

  async query(sql, params = []) {
    return this.dbManager.executeQuery(sql, params);
  }

  async insert(sql, params = [], tableName) {
    return this.dbManager.executeInsert(sql, params, tableName);
  }

  async update(sql, params = []) {
    return this.dbManager.executeUpdate(sql, params);
  }

  async ensureSeason(payload = {}) {
    const seasonKey = normalizeText(payload.season_key || payload.season || new Date().getFullYear());
    if (!seasonKey) throw new Error('يرجى إدخال الموسم');

    const existing = await this.query('SELECT * FROM land_seasons WHERE season_key = $1 LIMIT 1', [seasonKey]);
    if (existing[0]) return existing[0];

    const name = normalizeText(payload.name) || seasonKey;
    const id = await this.insert(
      `INSERT INTO land_seasons (season_key, name, start_date, end_date, notes, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7) RETURNING id`,
      [seasonKey, name, normalizeDate(payload.start_date) || null, normalizeDate(payload.end_date) || null, normalizeText(payload.notes), nowIso(), nowIso()],
      'land_seasons'
    );
    const rows = await this.query('SELECT * FROM land_seasons WHERE id = $1 OR season_key = $2 LIMIT 1', [id, seasonKey]);
    return rows[0] || { id, season_key: seasonKey, name };
  }

  async findSeasonByKey(seasonKey) {
    const key = normalizeText(seasonKey);
    if (!key) return null;
    const rows = await this.query('SELECT * FROM land_seasons WHERE season_key = $1 AND archived_at IS NULL LIMIT 1', [key]);
    return rows[0] || null;
  }

  async listSeasons() {
    return this.query(`
      SELECT *
      FROM land_seasons
      WHERE archived_at IS NULL
      ORDER BY season_key DESC
    `);
  }

  async listPlots(filters = {}) {
    const season = filters.season_key ? await this.findSeasonByKey(filters.season_key) : null;
    const seasonId = toOptionalId(filters.season_id) || season?.id || null;
    const rentedSeasonCondition = seasonId ? 'a.season_id = $1' : '1 = 1';
    const tenantsSeasonCondition = seasonId ? 'a.season_id = $2' : '1 = 1';
    const rentSeasonCondition = seasonId ? 'a.season_id = $3' : '1 = 1';
    const params = seasonId ? [seasonId, seasonId, seasonId] : [];
    const rows = await this.query(`
      SELECT
        p.*,
        COALESCE(SUM(CASE WHEN a.archived_at IS NULL AND ${rentedSeasonCondition} THEN a.assigned_sahm ELSE 0 END), 0) AS rented_sahm,
        COUNT(DISTINCT CASE WHEN a.archived_at IS NULL AND ${tenantsSeasonCondition} THEN a.tenant_id END) AS tenants_count,
        COALESCE(SUM(CASE WHEN a.archived_at IS NULL AND ${rentSeasonCondition} THEN a.rent_cents ELSE 0 END), 0) AS expected_rent_cents
      FROM land_plots p
      LEFT JOIN land_assignments a ON a.plot_id = p.id
      WHERE p.archived_at IS NULL
      GROUP BY p.id
      ORDER BY p.name ASC, p.plot_code ASC
    `, params);

    return rows.map((row) => {
      const rented = Number(row.rented_sahm) || 0;
      const total = Number(row.total_sahm) || 0;
      return moneyFields({
        ...enrichSurface(row, 'total_sahm'),
        rented_sahm: rented,
        rented_sahm_label: formatSurface(rented),
        available_sahm: Math.max(total - rented, 0),
        available_sahm_label: formatSurface(Math.max(total - rented, 0)),
        status: derivePlotStatus(total, rented)
      }, ['expected_rent_cents']);
    });
  }

  async getPlot(payload = {}) {
    const plotId = toId(payload.id, 'plot_id');
    const seasonId = toOptionalId(payload.season_id);
    const rows = await this.query('SELECT * FROM land_plots WHERE id = $1 AND archived_at IS NULL LIMIT 1', [plotId]);
    if (!rows[0]) throw new Error('الأرض غير موجودة');
    const plot = enrichSurface(rows[0], 'total_sahm');
    const termParams = [plotId];
    const termSeasonClause = seasonId ? 'AND t.season_id = $2' : '';
    if (seasonId) termParams.push(seasonId);
    const terms = await this.query(`
      SELECT t.*, s.season_key, s.name AS season_name
      FROM land_plot_terms t
      JOIN land_seasons s ON s.id = t.season_id
      WHERE t.plot_id = $1 ${termSeasonClause}
      ORDER BY s.season_key DESC
    `, termParams);
    const assignments = await this.listAssignments({ plot_id: plotId, season_id: seasonId });
    return {
      ...plot,
      terms: terms.map((term) => moneyFields(term, ['rent_value_cents', 'rent_total_cents'])),
      assignments
    };
  }

  async savePlot(payload = {}) {
    const id = toOptionalId(payload.id);
    const name = normalizeText(payload.name);
    const totalSahm = normalizeSurfacePayload(payload);
    if (!name) throw new Error('يرجى إدخال اسم الأرض');
    if (totalSahm <= 0) throw new Error('مساحة الأرض يجب أن تكون أكبر من صفر');

    const timestamp = nowIso();
    let plotId = id;
    if (plotId) {
      const existingPlotRows = await this.query('SELECT plot_code FROM land_plots WHERE id = $1 AND archived_at IS NULL LIMIT 1', [plotId]);
      if (!existingPlotRows[0]) throw new Error('الأرض غير موجودة');
      const assignedRows = await this.query(`
        SELECT COALESCE(SUM(assigned_sahm), 0) AS assigned_sahm
        FROM land_assignments
        WHERE plot_id = $1 AND archived_at IS NULL
      `, [plotId]);
      const assigned = Number(assignedRows[0]?.assigned_sahm) || 0;
      if (assigned > totalSahm) {
        throw new Error('المساحة الجديدة أقل من المساحة المؤجرة بالفعل');
      }
      await this.update(`
        UPDATE land_plots
        SET name = $1, location = $2, description = $3, total_sahm = $4,
            notes = $5, updated_at = $6
        WHERE id = $7
      `, [name, '', normalizeText(payload.description), totalSahm, normalizeText(payload.notes), timestamp, plotId]);
    } else {
      let lastError = null;
      for (let attempt = 0; attempt < 3 && !plotId; attempt += 1) {
        const plotCode = this.generatePlotCode();
        try {
          plotId = await this.insert(`
            INSERT INTO land_plots (plot_code, name, location, description, total_sahm, status, notes, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'available', $6, $7, $8) RETURNING id
          `, [plotCode, name, '', normalizeText(payload.description), totalSahm, normalizeText(payload.notes), timestamp, timestamp], 'land_plots');
        } catch (error) {
          lastError = error;
        }
      }
      if (!plotId) {
        throw lastError || new Error('تعذر إنشاء كود ثابت للأرض');
      }
    }

    const hasTermPayload = (payload.rent_value !== undefined && payload.rent_value !== '')
      || (payload.rent_total !== undefined && payload.rent_total !== '');
    if (hasTermPayload) {
      const season = await this.ensureSeason(payload);
      await this.savePlotTerm({
        plot_id: plotId,
        season_id: season.id,
        rent_mode: payload.rent_mode,
        rent_value: payload.rent_value,
        rent_total: payload.rent_total,
        notes: payload.term_notes,
        confirm_recalculate_paid: payload.confirm_recalculate_paid
      });
    }

    await this.refreshPlotStatus(plotId);
    return this.getPlot({ id: plotId });
  }

  async savePlotTerm(payload = {}) {
    const plotId = toId(payload.plot_id, 'plot_id');
    const seasonId = toId(payload.season_id, 'season_id');
    const rentMode = payload.rent_mode === 'total' ? 'total' : 'per_feddan';
    const rentValueCents = toCents(payload.rent_value);
    const rentTotalCents = rentMode === 'total' ? toCents(payload.rent_total || payload.rent_value) : 0;
    if (rentMode === 'per_feddan' && rentValueCents <= 0) throw new Error('يرجى إدخال سعر الفدان');
    if (rentMode === 'total' && rentTotalCents <= 0) throw new Error('يرجى إدخال إجمالي الإيجار');

    const paidRows = await this.query(`
      SELECT COUNT(*) AS count
      FROM land_payments pay
      JOIN land_assignments a ON a.id = pay.assignment_id
      WHERE a.plot_id = $1 AND a.season_id = $2 AND pay.archived_at IS NULL
    `, [plotId, seasonId]);
    if ((Number(paidRows[0]?.count) || 0) > 0 && !payload.confirm_recalculate_paid) {
      return { requiresConfirmation: true, message: 'توجد مدفوعات مسجلة. هل تريد إعادة حساب الإيجارات؟' };
    }

    const existing = await this.query('SELECT id FROM land_plot_terms WHERE plot_id = $1 AND season_id = $2 LIMIT 1', [plotId, seasonId]);
    const timestamp = nowIso();
    if (existing[0]) {
      await this.update(`
        UPDATE land_plot_terms
        SET rent_mode = $1, rent_value_cents = $2, rent_total_cents = $3, notes = $4, updated_at = $5
        WHERE id = $6
      `, [rentMode, rentValueCents, rentTotalCents, normalizeText(payload.notes), timestamp, existing[0].id]);
    } else {
      await this.insert(`
        INSERT INTO land_plot_terms (plot_id, season_id, rent_mode, rent_value_cents, rent_total_cents, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
      `, [plotId, seasonId, rentMode, rentValueCents, rentTotalCents, normalizeText(payload.notes), timestamp, timestamp], 'land_plot_terms');
    }

    await this.recalculatePlotSeasonAssignments(plotId, seasonId);
    return { success: true };
  }

  async archivePlot(payload = {}) {
    const plotId = toId(payload.id, 'plot_id');
    const payments = await this.query(`
      SELECT COUNT(*) AS count
      FROM land_payments p
      JOIN land_assignments a ON a.id = p.assignment_id
      WHERE a.plot_id = $1 AND p.archived_at IS NULL
    `, [plotId]);
    if ((Number(payments[0]?.count) || 0) > 0 && !payload.confirm) {
      return { requiresConfirmation: true, message: 'هذه الأرض مرتبطة بمدفوعات. سيتم أرشفتها بدلاً من حذفها.' };
    }
    const archivedAt = nowIso();
    await this.update('UPDATE land_plots SET archived_at = $1, updated_at = $2 WHERE id = $3', [archivedAt, archivedAt, plotId]);
    return { success: true };
  }

  async listTenants(filters = {}) {
    const search = normalizeText(filters.search).toLowerCase();
    const rows = await this.query(`
      SELECT t.*,
             COUNT(DISTINCT a.id) AS assignments_count,
             COALESCE(SUM(a.rent_cents), 0) AS total_rent_cents
      FROM land_tenants t
      LEFT JOIN land_assignments a ON a.tenant_id = t.id AND a.archived_at IS NULL
      WHERE t.archived_at IS NULL
      GROUP BY t.id
      ORDER BY t.full_name ASC
    `);
    return rows
      .filter((row) => !search || [row.full_name, row.phone, row.village_address].some((value) => String(value || '').toLowerCase().includes(search)))
      .map((row) => moneyFields(row, ['total_rent_cents']));
  }

  async saveTenant(payload = {}) {
    const id = toOptionalId(payload.id);
    const fullName = normalizeText(payload.full_name || payload.name);
    if (!fullName) throw new Error('يرجى إدخال اسم المستأجر');
    const params = [
      fullName,
      normalizeText(payload.phone),
      normalizeText(payload.village_address || payload.address),
      normalizeText(payload.document_id),
      normalizeText(payload.notes),
      nowIso()
    ];

    if (id) {
      await this.update(`
        UPDATE land_tenants
        SET full_name = $1, phone = $2, village_address = $3, document_id = $4, notes = $5, updated_at = $6
        WHERE id = $7
      `, [...params, id]);
      return { success: true, id };
    }

    const tenantId = await this.insert(`
      INSERT INTO land_tenants (full_name, phone, village_address, document_id, notes, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [...params, params[5]], 'land_tenants');
    return { success: true, id: tenantId };
  }

  async archiveTenant(payload = {}) {
    const tenantId = toId(payload.id, 'tenant_id');
    const payments = await this.query(`
      SELECT COUNT(*) AS count
      FROM land_payments p
      JOIN land_assignments a ON a.id = p.assignment_id
      WHERE a.tenant_id = $1 AND p.archived_at IS NULL
    `, [tenantId]);
    if ((Number(payments[0]?.count) || 0) > 0 && !payload.confirm) {
      return { requiresConfirmation: true, message: 'هذا المستأجر مرتبط بمدفوعات. سيتم أرشفته بدلاً من حذفه.' };
    }
    const archivedAt = nowIso();
    await this.update('UPDATE land_tenants SET archived_at = $1, updated_at = $2 WHERE id = $3', [archivedAt, archivedAt, tenantId]);
    return { success: true };
  }

  async listAssignments(filters = {}) {
    const plotId = toOptionalId(filters.plot_id);
    const tenantId = toOptionalId(filters.tenant_id);
    const season = filters.season_key ? await this.findSeasonByKey(filters.season_key) : null;
    if (filters.season_key && !season && !filters.season_id) return [];
    const seasonId = toOptionalId(filters.season_id) || season?.id || null;
    const whereClauses = ['a.archived_at IS NULL'];
    const params = [];
    if (plotId) {
      params.push(plotId);
      whereClauses.push(`a.plot_id = $${params.length}`);
    }
    if (tenantId) {
      params.push(tenantId);
      whereClauses.push(`a.tenant_id = $${params.length}`);
    }
    if (seasonId) {
      params.push(seasonId);
      whereClauses.push(`a.season_id = $${params.length}`);
    }
    const rows = await this.query(`
      SELECT
        a.*,
        p.name AS plot_name,
        p.plot_code,
        p.location,
        p.total_sahm,
        t.full_name AS tenant_name,
        t.phone AS tenant_phone,
        s.season_key,
        COALESCE(SUM(CASE WHEN i.installment_number = 1 THEN i.expected_cents ELSE 0 END), 0) AS first_expected_cents,
        COALESCE(SUM(CASE WHEN i.installment_number = 2 THEN i.expected_cents ELSE 0 END), 0) AS second_expected_cents,
        MAX(CASE WHEN i.installment_number = 1 THEN i.due_date ELSE NULL END) AS first_due_date,
        MAX(CASE WHEN i.installment_number = 2 THEN i.due_date ELSE NULL END) AS second_due_date,
        COALESCE(SUM(CASE WHEN pay.installment_number = 1 AND pay.archived_at IS NULL THEN pay.amount_cents ELSE 0 END), 0) AS first_paid_cents,
        COALESCE(SUM(CASE WHEN pay.installment_number = 2 AND pay.archived_at IS NULL THEN pay.amount_cents ELSE 0 END), 0) AS second_paid_cents
      FROM land_assignments a
      JOIN land_plots p ON p.id = a.plot_id
      JOIN land_tenants t ON t.id = a.tenant_id
      JOIN land_seasons s ON s.id = a.season_id
      LEFT JOIN land_installments i ON i.assignment_id = a.id
      LEFT JOIN land_payments pay ON pay.assignment_id = a.id
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY a.id, p.name, p.plot_code, p.location, p.total_sahm, t.full_name, t.phone, s.season_key
      ORDER BY s.season_key DESC, p.name ASC, t.full_name ASC
    `, params);

    return Promise.all(rows.map(async (row) => {
      let baseRentCents = Number(row.rent_cents) || 0;
      try {
        baseRentCents = await this.calculateAssignmentRent(row.plot_id, row.season_id, Number(row.assigned_sahm) || 0);
      } catch (_error) {
        baseRentCents = Number(row.rent_cents) || 0;
      }
      let rentAdjustmentMode = normalizeRentAdjustmentMode(row.rent_adjustment_mode);
      let rentAdjustmentCents = Number(row.rent_adjustment_cents) || 0;
      if (rentAdjustmentMode === 'none' && row.manual_rent_cents !== null && row.manual_rent_cents !== undefined) {
        const legacyDifference = Number(row.manual_rent_cents) - baseRentCents;
        if (legacyDifference > 0) {
          rentAdjustmentMode = 'fixed_total';
          rentAdjustmentCents = legacyDifference;
        }
      }
      const summary = calculatePaymentSummary(
        Number(row.rent_cents) || 0,
        Number(row.first_expected_cents) || 0,
        Number(row.second_expected_cents) || 0,
        Number(row.first_paid_cents) || 0,
        Number(row.second_paid_cents) || 0
      );
      return moneyFields({
        ...enrichSurface(row, 'assigned_sahm'),
        base_rent_cents: baseRentCents,
        rent_adjustment_mode: rentAdjustmentMode,
        rent_adjustment_cents: rentAdjustmentCents,
        payment_status: summary.status,
        payment_status_label: PAYMENT_STATUS_LABELS[summary.status] || summary.status,
        total_paid_cents: summary.totalPaidCents,
        remaining_cents: summary.remainingCents,
        credit_cents: summary.creditCents
      }, [
        'rent_cents',
        'base_rent_cents',
        'rent_adjustment_cents',
        'first_expected_cents',
        'second_expected_cents',
        'first_paid_cents',
        'second_paid_cents',
        'total_paid_cents',
        'remaining_cents',
        'credit_cents'
      ]);
    }));
  }

  async saveAssignment(payload = {}) {
    const id = toOptionalId(payload.id);
    const plotId = toId(payload.plot_id, 'plot_id');
    const tenantId = toId(payload.tenant_id, 'tenant_id');
    const seasonId = payload.season_id ? toId(payload.season_id, 'season_id') : (await this.ensureSeason(payload)).id;
    const assignedSahm = normalizeSurfacePayload(payload);
    const manualRentCents = payload.manual_rent !== undefined && payload.manual_rent !== '' ? toCents(payload.manual_rent) : null;
    const manualNote = normalizeText(payload.manual_rent_note);
    const rentAdjustmentMode = normalizeRentAdjustmentMode(payload.rent_adjustment_mode);
    const rentAdjustmentCents = rentAdjustmentMode === 'none'
      ? 0
      : (payload.rent_adjustment_cents !== undefined && payload.rent_adjustment_cents !== ''
        ? Number(payload.rent_adjustment_cents)
        : toCents(payload.rent_adjustment_value || 0));
    if (rentAdjustmentMode !== 'none' && (!Number.isFinite(rentAdjustmentCents) || rentAdjustmentCents <= 0)) {
      throw new Error('يرجى إدخال قيمة زيادة الإيجار');
    }
    if (manualRentCents !== null && !manualNote) {
      throw new Error('تعديل الإيجار يطلب ملاحظة إلزامية');
    }

    const plot = (await this.query('SELECT * FROM land_plots WHERE id = $1 AND archived_at IS NULL LIMIT 1', [plotId]))[0];
    if (!plot) throw new Error('الأرض غير موجودة');
    const assignedParams = [plotId, seasonId];
    const excludeAssignmentClause = id ? 'AND id != $3' : '';
    if (id) assignedParams.push(id);
    const assignedRows = await this.query(`
      SELECT COALESCE(SUM(assigned_sahm), 0) AS assigned_sahm
      FROM land_assignments
      WHERE plot_id = $1 AND season_id = $2 AND archived_at IS NULL ${excludeAssignmentClause}
    `, assignedParams);
    validateAvailableSurface(Number(plot.total_sahm) || 0, Number(assignedRows[0]?.assigned_sahm) || 0, assignedSahm);

    const calculatedRent = await this.calculateAssignmentRent(plotId, seasonId, assignedSahm);
    const adjustedRent = calculateAdjustedRent(calculatedRent, assignedSahm, rentAdjustmentMode, rentAdjustmentCents);
    const rentCents = manualRentCents ?? adjustedRent;
    if (id) {
      const [existingAssignment] = await this.query('SELECT plot_id FROM land_assignments WHERE id = $1 AND archived_at IS NULL LIMIT 1', [id]);
      if (!existingAssignment) throw new Error('العقد غير موجود');
      const paymentRows = await this.query('SELECT COUNT(*) AS count FROM land_payments WHERE assignment_id = $1 AND archived_at IS NULL', [id]);
      if ((Number(paymentRows[0]?.count) || 0) > 0 && !payload.confirm_recalculate_paid) {
        return { requiresConfirmation: true, message: 'توجد مدفوعات مسجلة لهذا العقد. هل تريد تعديل الإيجار؟' };
      }
      await this.update(`
        UPDATE land_assignments
        SET plot_id = $1, tenant_id = $2, season_id = $3, assigned_sahm = $4, rent_cents = $5,
            manual_rent_cents = $6, manual_rent_note = $7, rent_adjustment_mode = $8, rent_adjustment_cents = $9,
            notes = $10, contract_status = $11, updated_at = $12
        WHERE id = $13
      `, [plotId, tenantId, seasonId, assignedSahm, rentCents, manualRentCents, manualNote, rentAdjustmentMode, rentAdjustmentCents, normalizeText(payload.notes), normalizeText(payload.contract_status) || 'active', nowIso(), id]);
      await this.ensureInstallments(id, rentCents, payload);
      if (Number(existingAssignment.plot_id) !== Number(plotId)) {
        await this.refreshPlotStatus(existingAssignment.plot_id);
      }
      await this.refreshPlotStatus(plotId);
      return { success: true, id };
    }

    const assignmentId = await this.insert(`
      INSERT INTO land_assignments (
        plot_id, tenant_id, season_id, assigned_sahm, rent_cents, manual_rent_cents,
        manual_rent_note, rent_adjustment_mode, rent_adjustment_cents, notes, contract_status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id
    `, [plotId, tenantId, seasonId, assignedSahm, rentCents, manualRentCents, manualNote, rentAdjustmentMode, rentAdjustmentCents, normalizeText(payload.notes), normalizeText(payload.contract_status) || 'active', nowIso(), nowIso()], 'land_assignments');
    await this.ensureInstallments(assignmentId, rentCents, payload);
    await this.recalculatePlotSeasonAssignments(plotId, seasonId, { preserveManual: true });
    await this.refreshPlotStatus(plotId);
    return { success: true, id: assignmentId };
  }

  async previewAssignmentRent(payload = {}) {
    const plotId = toId(payload.plot_id, 'plot_id');
    const seasonId = payload.season_id
      ? toId(payload.season_id, 'season_id')
      : (await this.findSeasonByKey(payload.season_key || String(new Date().getFullYear())))?.id;
    if (!seasonId) {
      return { ready: false, message: 'اختر سنة لها سعر إيجار محفوظ' };
    }
    const assignedSahm = normalizeSurfacePayload(payload);
    if (assignedSahm <= 0) {
      return { ready: false, message: 'أدخل المساحة لعرض الإجمالي' };
    }
    const rentAdjustmentMode = normalizeRentAdjustmentMode(payload.rent_adjustment_mode);
    const rentAdjustmentCents = rentAdjustmentMode === 'none'
      ? 0
      : toCents(payload.rent_adjustment_value || 0);
    const baseRentCents = await this.calculateAssignmentRent(plotId, seasonId, assignedSahm);
    const totalRentCents = calculateAdjustedRent(baseRentCents, assignedSahm, rentAdjustmentMode, rentAdjustmentCents);
    return {
      ready: true,
      base_rent_cents: baseRentCents,
      adjustment_cents: totalRentCents - baseRentCents,
      total_rent_cents: totalRentCents,
      base_rent_cents_egp: formatMoney(baseRentCents),
      adjustment_cents_egp: formatMoney(totalRentCents - baseRentCents),
      total_rent_cents_egp: formatMoney(totalRentCents)
    };
  }

  async renewAssignment(payload = {}) {
    const assignmentId = toId(payload.id, 'assignment_id');
    const [assignment] = await this.query(`
      SELECT
        a.*,
        s.season_key,
        (SELECT due_date FROM land_installments WHERE assignment_id = a.id AND installment_number = 1 LIMIT 1) AS first_due_date,
        (SELECT due_date FROM land_installments WHERE assignment_id = a.id AND installment_number = 2 LIMIT 1) AS second_due_date
      FROM land_assignments a
      JOIN land_seasons s ON s.id = a.season_id
      WHERE a.id = $1 AND a.archived_at IS NULL
      LIMIT 1
    `, [assignmentId]);
    if (!assignment) throw new Error('العقد غير موجود');

    const sourceYear = parseInt(assignment.season_key, 10);
    if (!Number.isInteger(sourceYear) || String(sourceYear) !== String(assignment.season_key).trim()) {
      throw new Error('لا يمكن تجديد عقد بموسم غير رقمي');
    }
    const nextSeasonKey = String(sourceYear + 1);
    const nextSeason = await this.ensureSeason({ season_key: nextSeasonKey, name: nextSeasonKey });

    const duplicate = await this.query(`
      SELECT id
      FROM land_assignments
      WHERE plot_id = $1 AND tenant_id = $2 AND season_id = $3 AND archived_at IS NULL
      LIMIT 1
    `, [assignment.plot_id, assignment.tenant_id, nextSeason.id]);
    if (duplicate[0]) {
      throw new Error('يوجد عقد مجدد بالفعل لنفس الأرض والمستأجر في السنة التالية');
    }

    const [nextTerm] = await this.query('SELECT id FROM land_plot_terms WHERE plot_id = $1 AND season_id = $2 LIMIT 1', [assignment.plot_id, nextSeason.id]);
    if (!nextTerm) {
      const [sourceTerm] = await this.query('SELECT * FROM land_plot_terms WHERE plot_id = $1 AND season_id = $2 LIMIT 1', [assignment.plot_id, assignment.season_id]);
      if (!sourceTerm) {
        throw new Error('يرجى تحديد سعر الإيجار للسنة التالية قبل تجديد العقد');
      }
      await this.insert(`
        INSERT INTO land_plot_terms (plot_id, season_id, rent_mode, rent_value_cents, rent_total_cents, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
      `, [
        assignment.plot_id,
        nextSeason.id,
        sourceTerm.rent_mode,
        Number(sourceTerm.rent_value_cents) || 0,
        Number(sourceTerm.rent_total_cents) || 0,
        normalizeText(sourceTerm.notes),
        nowIso(),
        nowIso()
      ], 'land_plot_terms');
    }

    const renewalPayload = {
      plot_id: assignment.plot_id,
      tenant_id: assignment.tenant_id,
      season_id: nextSeason.id,
      assigned_sahm: Number(assignment.assigned_sahm) || 0,
      notes: normalizeText(assignment.notes),
      contract_status: 'active',
      rent_adjustment_mode: normalizeRentAdjustmentMode(assignment.rent_adjustment_mode),
      rent_adjustment_value: centsToMoneyInput(Number(assignment.rent_adjustment_cents) || 0),
      first_due_date: shiftDateByYears(assignment.first_due_date, 1),
      second_due_date: shiftDateByYears(assignment.second_due_date, 1)
    };

    if (normalizeRentAdjustmentMode(assignment.rent_adjustment_mode) === 'none' && assignment.manual_rent_cents !== null && assignment.manual_rent_cents !== undefined) {
      renewalPayload.manual_rent = centsToMoneyInput(assignment.manual_rent_cents);
      renewalPayload.manual_rent_note = normalizeText(assignment.manual_rent_note) || `تجديد من موسم ${assignment.season_key}`;
    }

    const result = await this.saveAssignment(renewalPayload);
    return {
      ...result,
      season_key: nextSeasonKey,
      message: `تم تجديد العقد لموسم ${nextSeasonKey}`
    };
  }

  async calculateAssignmentRent(plotId, seasonId, assignedSahm) {
    const [plot] = await this.query('SELECT total_sahm FROM land_plots WHERE id = $1 LIMIT 1', [plotId]);
    const [term] = await this.query('SELECT * FROM land_plot_terms WHERE plot_id = $1 AND season_id = $2 LIMIT 1', [plotId, seasonId]);
    if (!term) throw new Error('يرجى تحديد سعر الإيجار لهذا الموسم');
    if (term.rent_mode === 'total') {
      return calculateProportionalAmount(Number(term.rent_total_cents) || 0, assignedSahm, Number(plot.total_sahm) || 0);
    }
    return calculateRentByFeddan(assignedSahm, Number(term.rent_value_cents) || 0);
  }

  async recalculatePlotSeasonAssignments(plotId, seasonId, options = {}) {
    const assignments = await this.query(`
      SELECT *
      FROM land_assignments
      WHERE plot_id = $1 AND season_id = $2 AND archived_at IS NULL
      ORDER BY id ASC
    `, [plotId, seasonId]);
    for (const assignment of assignments) {
      const hasLegacyManual = assignment.manual_rent_cents !== null && assignment.manual_rent_cents !== undefined;
      const hasAdjustment = normalizeRentAdjustmentMode(assignment.rent_adjustment_mode) !== 'none';
      if (options.preserveManual && (hasLegacyManual || hasAdjustment)) continue;
      const baseRent = await this.calculateAssignmentRent(plotId, seasonId, Number(assignment.assigned_sahm) || 0);
      const rent = hasLegacyManual
        ? Number(assignment.manual_rent_cents)
        : calculateAdjustedRent(baseRent, Number(assignment.assigned_sahm) || 0, normalizeRentAdjustmentMode(assignment.rent_adjustment_mode), Number(assignment.rent_adjustment_cents) || 0);
      await this.update('UPDATE land_assignments SET rent_cents = $1, updated_at = $2 WHERE id = $3', [rent, nowIso(), assignment.id]);
      await this.ensureInstallments(assignment.id, rent, {});
    }
  }

  async ensureInstallments(assignmentId, rentCents, payload = {}) {
    const firstOverride = payload.first_installment_amount !== undefined && payload.first_installment_amount !== ''
      ? toCents(payload.first_installment_amount)
      : null;
    const percent = payload.first_installment_percent !== undefined && payload.first_installment_percent !== ''
      ? Number(payload.first_installment_percent)
      : 50;
    const [first, second] = firstOverride !== null
      ? splitInstallments(rentCents, firstOverride, 'amount')
      : splitInstallments(rentCents, percent, 'percent');
    const firstDue = normalizeDate(payload.first_due_date) || null;
    const secondDue = normalizeDate(payload.second_due_date) || null;
    const rows = await this.query('SELECT id, installment_number FROM land_installments WHERE assignment_id = $1', [assignmentId]);
    const existingByNumber = new Map(rows.map((row) => [Number(row.installment_number), row.id]));
    for (const installment of [
      { number: 1, expected: first, due: firstDue },
      { number: 2, expected: second, due: secondDue }
    ]) {
      const existingId = existingByNumber.get(installment.number);
      if (existingId) {
        await this.update(`
          UPDATE land_installments
          SET expected_cents = $1, due_date = COALESCE($2, due_date), updated_at = $3
          WHERE id = $4
        `, [installment.expected, installment.due, nowIso(), existingId]);
      } else {
        await this.insert(`
          INSERT INTO land_installments (assignment_id, installment_number, expected_cents, due_date, notes, created_at, updated_at)
          VALUES ($1, $2, $3, $4, '', $5, $6) RETURNING id
        `, [assignmentId, installment.number, installment.expected, installment.due, nowIso(), nowIso()], 'land_installments');
      }
    }
  }

  async archiveAssignment(payload = {}) {
    const assignmentId = toId(payload.id, 'assignment_id');
    const payments = await this.query('SELECT COUNT(*) AS count FROM land_payments WHERE assignment_id = $1 AND archived_at IS NULL', [assignmentId]);
    if ((Number(payments[0]?.count) || 0) > 0 && !payload.confirm) {
      return { requiresConfirmation: true, message: 'هذا العقد مرتبط بمدفوعات. سيتم أرشفته بدلاً من حذفه.' };
    }
    const [assignment] = await this.query('SELECT plot_id FROM land_assignments WHERE id = $1', [assignmentId]);
    const archivedAt = nowIso();
    await this.update('UPDATE land_assignments SET archived_at = $1, updated_at = $2 WHERE id = $3', [archivedAt, archivedAt, assignmentId]);
    if (assignment) await this.refreshPlotStatus(assignment.plot_id);
    return { success: true };
  }

  async saveInstallmentPlan(payload = {}) {
    const assignmentId = toId(payload.assignment_id, 'assignment_id');
    const assignment = (await this.query('SELECT rent_cents FROM land_assignments WHERE id = $1 LIMIT 1', [assignmentId]))[0];
    if (!assignment) throw new Error('العقد غير موجود');
    await this.ensureInstallments(assignmentId, Number(assignment.rent_cents) || 0, payload);
    return { success: true };
  }

  async addPayment(payload = {}) {
    const assignmentId = toId(payload.assignment_id, 'assignment_id');
    const installmentNumber = parseInt(payload.installment_number, 10) === 2 ? 2 : 1;
    const amountCents = toCents(payload.amount);
    if (amountCents <= 0) throw new Error('قيمة الدفعة يجب أن تكون أكبر من صفر');
    const paidAt = normalizeDate(payload.paid_at) || new Date().toISOString().slice(0, 10);
    const id = await this.insert(`
      INSERT INTO land_payments (
        assignment_id, installment_number, amount_cents, paid_at, payment_method, reference, notes, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [assignmentId, installmentNumber, amountCents, paidAt, normalizeText(payload.payment_method), normalizeText(payload.reference), normalizeText(payload.notes), nowIso(), nowIso()], 'land_payments');
    return { success: true, id };
  }

  async updatePayment(payload = {}) {
    const paymentId = toId(payload.id, 'payment_id');
    const amountCents = toCents(payload.amount);
    if (amountCents <= 0) throw new Error('قيمة الدفعة يجب أن تكون أكبر من صفر');
    await this.update(`
      UPDATE land_payments
      SET installment_number = $1, amount_cents = $2, paid_at = $3, payment_method = $4, reference = $5, notes = $6, updated_at = $7
      WHERE id = $8
    `, [parseInt(payload.installment_number, 10) === 2 ? 2 : 1, amountCents, normalizeDate(payload.paid_at) || new Date().toISOString().slice(0, 10), normalizeText(payload.payment_method), normalizeText(payload.reference), normalizeText(payload.notes), nowIso(), paymentId]);
    return { success: true };
  }

  async deletePayment(payload = {}) {
    const archivedAt = nowIso();
    await this.update('UPDATE land_payments SET archived_at = $1, updated_at = $2 WHERE id = $3', [archivedAt, archivedAt, toId(payload.id, 'payment_id')]);
    return { success: true };
  }

  async generateReceipt(payload = {}) {
    const paymentId = toId(payload.payment_id, 'payment_id');
    const rows = await this.query(`
      SELECT pay.*, a.rent_cents, a.assigned_sahm, p.name AS plot_name, t.full_name AS tenant_name, s.season_key
      FROM land_payments pay
      JOIN land_assignments a ON a.id = pay.assignment_id
      JOIN land_plots p ON p.id = a.plot_id
      JOIN land_tenants t ON t.id = a.tenant_id
      JOIN land_seasons s ON s.id = a.season_id
      WHERE pay.id = $1 AND pay.archived_at IS NULL
      LIMIT 1
    `, [paymentId]);
    if (!rows[0]) throw new Error('الدفعة غير موجودة');
    const receiptNumber = `LAND-${new Date().getFullYear()}-${String(paymentId).padStart(5, '0')}`;
    const data = JSON.stringify(rows[0]);
    const existing = await this.query('SELECT * FROM land_receipts WHERE payment_id = $1 LIMIT 1', [paymentId]);
    if (!existing[0]) {
      await this.insert(`
        INSERT INTO land_receipts (payment_id, receipt_number, issued_at, receipt_data, notes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
      `, [paymentId, receiptNumber, nowIso(), data, normalizeText(payload.notes), nowIso()], 'land_receipts');
    }
    return {
      success: true,
      receipt_number: existing[0]?.receipt_number || receiptNumber,
      receipt: rows[0]
    };
  }

  async getDashboard(filters = {}) {
    const season = filters.season_id
      ? { id: toId(filters.season_id, 'season_id') }
      : await this.findSeasonByKey(filters.season_key || String(new Date().getFullYear()));
    const seasonId = season?.id || null;
    const plots = await this.listPlots({ season_id: seasonId || -1 });
    const assignments = seasonId ? await this.listAssignments({ season_id: seasonId }) : [];
    const totalSahm = plots.reduce((sum, row) => sum + (Number(row.total_sahm) || 0), 0);
    const rentedSahm = plots.reduce((sum, row) => sum + (Number(row.rented_sahm) || 0), 0);
    const expected = assignments.reduce((sum, row) => sum + (Number(row.rent_cents) || 0), 0);
    const paid = assignments.reduce((sum, row) => sum + (Number(row.total_paid_cents) || 0), 0);
    const remaining = assignments.reduce((sum, row) => sum + (Number(row.remaining_cents) || 0), 0);
    const groupedAssignments = Array.from(assignments.reduce((groups, row) => {
      const key = `${row.plot_id}:${row.tenant_id}`;
      const current = groups.get(key) || {
        ...row,
        id: key,
        assignment_count: 0,
        assigned_sahm: 0,
        rent_cents: 0,
        total_paid_cents: 0,
        remaining_cents: 0,
        credit_cents: 0
      };
      current.assignment_count += 1;
      current.assigned_sahm += Number(row.assigned_sahm) || 0;
      current.rent_cents += Number(row.rent_cents) || 0;
      current.total_paid_cents += Number(row.total_paid_cents) || 0;
      current.remaining_cents += Number(row.remaining_cents) || 0;
      current.credit_cents += Number(row.credit_cents) || 0;
      groups.set(key, current);
      return groups;
    }, new Map()).values()).map((row) => {
      const paymentStatus = combinePaymentStatus(row.rent_cents, row.total_paid_cents, row.remaining_cents);
      return moneyFields({
        ...enrichSurface(row, 'assigned_sahm'),
        payment_status: paymentStatus,
        payment_status_label: PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus
      }, ['rent_cents', 'total_paid_cents', 'remaining_cents', 'credit_cents']);
    });
    return {
      season_id: seasonId,
      plots_count: plots.length,
      total_sahm: totalSahm,
      total_sahm_label: formatSurface(totalSahm),
      rented_sahm: rentedSahm,
      rented_sahm_label: formatSurface(rentedSahm),
      available_sahm: Math.max(totalSahm - rentedSahm, 0),
      available_sahm_label: formatSurface(Math.max(totalSahm - rentedSahm, 0)),
      expected_rent_cents: expected,
      expected_rent_cents_egp: formatMoney(expected),
      paid_cents: paid,
      paid_cents_egp: formatMoney(paid),
      remaining_cents: remaining,
      remaining_cents_egp: formatMoney(remaining),
      overdue_installments: assignments.filter((row) => row.payment_status === 'overdue').length,
      incomplete_tenants: new Set(assignments.filter((row) => Number(row.remaining_cents) > 0).map((row) => row.tenant_id)).size,
      plots: plots.slice(0, 8),
      assignments: groupedAssignments
    };
  }

  async getReport(filters = {}) {
    const kind = filters.kind || 'complete';
    const assignments = await this.listAssignments(filters);
    if (kind === 'missing-payments') {
      return assignments.filter((row) => Number(row.remaining_cents) > 0);
    }
    if (kind === 'overdue') {
      return assignments.filter((row) => row.payment_status === 'overdue');
    }
    if (kind === 'first-installment') {
      return assignments.map((row) => ({
        tenant_name: row.tenant_name,
        plot_name: row.plot_name,
        season_key: row.season_key,
        expected_cents: row.first_expected_cents,
        paid_cents: row.first_paid_cents,
        remaining_cents: Math.max((Number(row.first_expected_cents) || 0) - (Number(row.first_paid_cents) || 0), 0)
      }));
    }
    if (kind === 'second-installment') {
      return assignments.map((row) => ({
        tenant_name: row.tenant_name,
        plot_name: row.plot_name,
        season_key: row.season_key,
        expected_cents: row.second_expected_cents,
        paid_cents: row.second_paid_cents,
        remaining_cents: Math.max((Number(row.second_expected_cents) || 0) - (Number(row.second_paid_cents) || 0), 0)
      }));
    }
    return assignments;
  }

  async exportReport(format, filters = {}) {
    const rows = await this.getReport(filters);
    const fileBase = `land-report-${new Date().toISOString().slice(0, 10)}`;
    const headers = ['الموسم', 'الأرض', 'المستأجر', 'المساحة', 'الإيجار', 'المدفوع', 'المتبقي', 'الحالة'];
    const tableRows = rows.map((row) => [
      row.season_key || '',
      row.plot_name || '',
      row.tenant_name || '',
      row.assigned_sahm_label || '',
      row.rent_cents_egp || formatMoney(row.expected_cents || 0),
      row.total_paid_cents_egp || formatMoney(row.paid_cents || 0),
      row.remaining_cents_egp || formatMoney(row.remaining_cents || 0),
      row.payment_status_label || ''
    ]);

    if (format === 'xlsx') {
      const XLSX = require('xlsx');
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...tableRows]);
      XLSX.utils.book_append_sheet(workbook, sheet, 'الأراضي');
      const result = await this.dialog.showSaveDialog({
        title: 'تصدير تقرير الأراضي',
        defaultPath: `${fileBase}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      });
      if (result.canceled || !result.filePath) return { success: false };
      XLSX.writeFile(workbook, result.filePath);
      return { success: true, filePath: result.filePath, rowCount: rows.length };
    }

    if (format === 'pdf') {
      const { jsPDF } = require('jspdf');
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(12);
      doc.text('Land Report', 14, 14);
      let y = 24;
      [headers, ...tableRows].forEach((row) => {
        const line = row.join(' | ');
        doc.text(line.slice(0, 180), 14, y);
        y += 8;
        if (y > 190) {
          doc.addPage();
          y = 16;
        }
      });
      const result = await this.dialog.showSaveDialog({
        title: 'تصدير تقرير الأراضي',
        defaultPath: `${fileBase}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (result.canceled || !result.filePath) return { success: false };
      fs.writeFileSync(result.filePath, Buffer.from(doc.output('arraybuffer')));
      return { success: true, filePath: result.filePath, rowCount: rows.length };
    }

    const csv = [headers, ...tableRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const result = await this.dialog.showSaveDialog({
      title: 'تصدير تقرير الأراضي',
      defaultPath: `${fileBase}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { success: false };
    fs.writeFileSync(result.filePath, csv, 'utf8');
    return { success: true, filePath: result.filePath, rowCount: rows.length };
  }

  async refreshPlotStatus(plotId) {
    const rows = await this.query(`
      SELECT p.total_sahm, COALESCE(SUM(a.assigned_sahm), 0) AS assigned_sahm
      FROM land_plots p
      LEFT JOIN land_assignments a ON a.plot_id = p.id AND a.archived_at IS NULL
      WHERE p.id = $1
      GROUP BY p.id, p.total_sahm
    `, [plotId]);
    if (!rows[0]) return;
    const status = derivePlotStatus(Number(rows[0].total_sahm) || 0, Number(rows[0].assigned_sahm) || 0);
    await this.update('UPDATE land_plots SET status = $1, updated_at = $2 WHERE id = $3', [status, nowIso(), plotId]);
  }

  register(ipcMain) {
    ipcMain.handle('land:get-seasons', async () => this.listSeasons());
    ipcMain.handle('land:get-dashboard', async (_event, payload = {}) => this.getDashboard(payload));
    ipcMain.handle('land:list-plots', async (_event, payload = {}) => this.listPlots(payload));
    ipcMain.handle('land:get-plot', async (_event, payload = {}) => this.getPlot(payload));
    ipcMain.handle('land:save-plot', async (_event, payload = {}) => this.savePlot(payload));
    ipcMain.handle('land:archive-plot', async (_event, payload = {}) => this.archivePlot(payload));
    ipcMain.handle('land:list-tenants', async (_event, payload = {}) => this.listTenants(payload));
    ipcMain.handle('land:save-tenant', async (_event, payload = {}) => this.saveTenant(payload));
    ipcMain.handle('land:archive-tenant', async (_event, payload = {}) => this.archiveTenant(payload));
    ipcMain.handle('land:list-assignments', async (_event, payload = {}) => this.listAssignments(payload));
    ipcMain.handle('land:save-assignment', async (_event, payload = {}) => this.saveAssignment(payload));
    ipcMain.handle('land:preview-assignment-rent', async (_event, payload = {}) => this.previewAssignmentRent(payload));
    ipcMain.handle('land:renew-assignment', async (_event, payload = {}) => this.renewAssignment(payload));
    ipcMain.handle('land:archive-assignment', async (_event, payload = {}) => this.archiveAssignment(payload));
    ipcMain.handle('land:save-installment-plan', async (_event, payload = {}) => this.saveInstallmentPlan(payload));
    ipcMain.handle('land:add-payment', async (_event, payload = {}) => this.addPayment(payload));
    ipcMain.handle('land:update-payment', async (_event, payload = {}) => this.updatePayment(payload));
    ipcMain.handle('land:delete-payment', async (_event, payload = {}) => this.deletePayment(payload));
    ipcMain.handle('land:generate-receipt', async (_event, payload = {}) => this.generateReceipt(payload));
    ipcMain.handle('land:get-report', async (_event, payload = {}) => this.getReport(payload));
    ipcMain.handle('land:export-report-csv', async (_event, payload = {}) => this.exportReport('csv', payload));
    ipcMain.handle('land:export-report-xlsx', async (_event, payload = {}) => this.exportReport('xlsx', payload));
    ipcMain.handle('land:export-report-pdf', async (_event, payload = {}) => this.exportReport('pdf', payload));
  }
}

function registerLandIpcHandlers(ipcMain, getDbManager, options = {}) {
  const service = new LandService(getDbManager, options);
  service.register(ipcMain);
  return service;
}

module.exports = {
  LAND_TABLES,
  PAYMENT_STATUS_LABELS,
  LandService,
  registerLandIpcHandlers
};
