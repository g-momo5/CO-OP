const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAccountingDocumentData,
  buildAccountingFuelPurchaseMaps,
  buildAccountingProfitRows,
  buildAccountingStorageUpdate,
  calculateAccountingCashInsurance,
  calculateFuelPurchaseTotal,
  calculateAccountingTotals,
  createDefaultAccountingData,
  extractAccountingProfitRows,
  getPreviousIncreaseLabel,
  selectDefaultAccountingMonth,
  splitDraftAndFinal
} = require('../../src/accounting/monthly-accounting');

test('calculateAccountingTotals computes debit, credit and accounting increase', () => {
  const totals = calculateAccountingTotals({
    debit_rows: [
      { label: 'مدين ١', amount: 100.25 },
      { label: 'مدين ٢', amount: 50.25 }
    ],
    credit_rows: [
      { label: 'دائن ١', amount: 250.5 },
      { label: 'دائن ٢', amount: 25 }
    ]
  });

  assert.deepEqual(totals, {
    debit_total: 150.5,
    credit_total: 275.5,
    accounting_increase: 125
  });
});

test('getPreviousIncreaseLabel renders the previous month with Arabic digits', () => {
  assert.equal(getPreviousIncreaseLabel('2026-06'), 'زيادة محاسبة شهر ٢٠٢٦ / ٥');
  assert.equal(getPreviousIncreaseLabel('2026-01'), 'زيادة محاسبة شهر ٢٠٢٥ / ١٢');
});

test('buildAccountingDocumentData fills previous increase when the row is missing', () => {
  const data = buildAccountingDocumentData({
    month_key: '2026-06',
    credit_rows: [
      { label: 'جملة النقدية والشيكات للمواد البترولية', amount: 1000 },
      { label: 'جملة حوافظ التسليمات', amount: 2000 }
    ]
  }, {
    previousIncrease: 321.75
  });

  const autoRow = data.credit_rows.find((row) => row.auto);
  assert.equal(autoRow.label, 'زيادة محاسبة شهر ٢٠٢٦ / ٥');
  assert.equal(autoRow.amount, 321.75);
  assert.equal(data.totals.credit_total, 3321.75);
});

test('manual previous increase is preserved unless cascade forces recalculation', () => {
  const manualData = buildAccountingDocumentData({
    month_key: '2026-06',
    credit_rows: [
      { label: 'زيادة محاسبة شهر ٢٠٢٦ / ٥', amount: 999 }
    ]
  }, {
    previousIncrease: 321.75
  });
  const cascadeData = buildAccountingDocumentData(manualData, {
    month_key: '2026-06',
    previousIncrease: 321.75,
    forcePreviousIncrease: true
  });

  assert.equal(manualData.credit_rows.find((row) => row.auto).amount, 999);
  assert.equal(cascadeData.credit_rows.find((row) => row.auto).amount, 321.75);
});

test('normalizes multiple accounting fuel purchase rows with different dates and prices', () => {
  const data = buildAccountingDocumentData({
    month_key: '2026-06',
    fuel_purchase_rows: [
      { date: '2026-06-03', fuel_type: 'سولار', quantity: 100, purchase_price: 12 },
      { date: '2026-06-20', fuel_type: 'سولار', quantity: 50, purchase_price: 13.5 }
    ]
  });

  assert.equal(data.fuel_purchase_rows.length, 2);
  assert.equal(data.fuel_purchase_rows[0].total, 1200);
  assert.equal(data.fuel_purchase_rows[1].total, 675);
  assert.equal(data.fuel_purchase_total, 1875);
  assert.equal(calculateFuelPurchaseTotal(data.fuel_purchase_rows), 1875);
});

test('accounting fuel purchase total uses net quantity for gasoline', () => {
  const data = buildAccountingDocumentData({
    month_key: '2026-06',
    fuel_purchase_rows: [
      { date: '2026-06-03', fuel_type: 'بنزين ٩٢', quantity: 1000, purchase_price: 20 },
      { date: '2026-06-03', fuel_type: 'سولار', quantity: 1000, purchase_price: 20 }
    ]
  });

  assert.equal(data.fuel_purchase_rows[0].total, 19900);
  assert.equal(data.fuel_purchase_rows[1].total, 20000);
  assert.equal(data.fuel_purchase_total, 39900);
});

test('fuel withdrawal amount stays manual and cash insurance is derived from it', () => {
  const data = buildAccountingDocumentData({
    month_key: '2026-06',
    debit_rows: [{ label: 'جملة مسحوبات المواد البترولية', amount: 2000 }],
    fuel_purchase_rows: [
      { date: '2026-06-03', fuel_type: 'سولار', quantity: 100, purchase_price: 12 },
      { date: '2026-06-20', fuel_type: 'بنزين ٨٠', quantity: 40, purchase_price: 10 }
    ]
  });

  const fuelWithdrawalRow = data.debit_rows.find((row) => row.label === 'جملة مسحوبات المواد البترولية');
  assert.equal(fuelWithdrawalRow.amount, 2000);
  assert.equal(data.fuel_purchase_total, 1598);
  assert.equal(data.cash_insurance, 402);
  assert.equal(calculateAccountingCashInsurance(data), 402);
});

test('createDefaultAccountingData falls back to zero when previous month is absent', () => {
  const data = createDefaultAccountingData('2026-06');
  const autoRow = data.credit_rows.find((row) => row.auto);

  assert.equal(autoRow.amount, 0);
  assert.equal(autoRow.label, 'زيادة محاسبة شهر ٢٠٢٦ / ٥');
});

test('selectDefaultAccountingMonth returns the first non-finalized month', () => {
  assert.equal(selectDefaultAccountingMonth([], '2026-07'), '2026-07');
  assert.equal(selectDefaultAccountingMonth(['2026-01', '2026-02', '2026-04'], '2026-07'), '2026-03');
  assert.equal(selectDefaultAccountingMonth(['2026-01', '2026-02', '2026-03'], '2026-07'), '2026-04');
});

test('empty extra rows are ignored while filled extra rows are preserved', () => {
  const data = buildAccountingDocumentData({
    month_key: '2026-06',
    debit_rows: [
      { label: 'جملة مسحوبات المواد البترولية', amount: 100 },
      { label: '', amount: 0 },
      { label: 'بند إضافي', amount: 25 },
      { label: '', amount: '' }
    ],
    credit_rows: [
      { label: 'جملة النقدية والشيكات للمواد البترولية', amount: 300 },
      { label: '', amount: 0 }
    ]
  });

  assert.equal(data.debit_rows.some((row) => row.label === ''), false);
  assert.equal(data.debit_rows.find((row) => row.label === 'بند إضافي').amount, 25);
  assert.equal(data.credit_rows.some((row) => row.label === ''), false);
});

test('splitDraftAndFinal keeps draft and final data separate', () => {
  const record = splitDraftAndFinal({
    month_key: '2026-06',
    is_final: 1,
    draft_data: {
      month_key: '2026-06',
      debit_rows: [{ label: 'جملة مسحوبات المواد البترولية', amount: 10 }]
    },
    final_data: {
      month_key: '2026-06',
      debit_rows: [{ label: 'جملة مسحوبات المواد البترولية', amount: 20 }]
    }
  });

  assert.equal(record.is_final, true);
  assert.equal(record.draft_data.debit_rows[0].amount, 10);
  assert.equal(record.final_data.debit_rows[0].amount, 20);
  assert.equal(record.active_data.debit_rows[0].amount, 20);
});

test('final edit storage update writes only final_data and draft autosave writes only draft_data', () => {
  const draftUpdate = buildAccountingStorageUpdate({
    mode: 'draft',
    data: {
      month_key: '2026-06',
      debit_rows: [{ label: 'جملة مسحوبات الزيوت', amount: 15 }]
    }
  });
  const finalUpdate = buildAccountingStorageUpdate({
    mode: 'final',
    data: {
      month_key: '2026-06',
      debit_rows: [{ label: 'جملة مسحوبات الزيوت', amount: 25 }]
    }
  });

  assert.equal(draftUpdate.is_final, false);
  assert.equal(draftUpdate.final_data, undefined);
  assert.equal(draftUpdate.draft_data.debit_rows[1].amount, 15);
  assert.equal(finalUpdate.is_final, true);
  assert.equal(finalUpdate.draft_data, undefined);
  assert.equal(finalUpdate.final_data.debit_rows[1].amount, 25);
});

test('extractAccountingProfitRows maps included accounting rows to revenue and deductions', () => {
  const rows = extractAccountingProfitRows({
    month_key: '2026-06',
    debit_rows: [
      { label: 'جملة مسحوبات المواد البترولية', amount: 1000 },
      { label: 'جملة مسحوبات الزيوت', amount: 500 },
      { label: 'ضرائب المنبع', amount: 12 },
      { label: 'خصم إضافي', amount: 8 }
    ],
    fuel_purchase_rows: [
      { date: '2026-06-03', fuel_type: 'سولار', quantity: 100, purchase_price: 9 }
    ],
    credit_rows: [
      { label: 'جملة النقدية والشيكات للمواد البترولية', amount: 1000 },
      { label: 'جملة حوافظ التسليمات', amount: 500 },
      { label: 'زيادة محاسبة شهر ٢٠٢٦ / ٥', amount: 50, auto: true },
      { label: 'إيراد إضافي', amount: 30 }
    ]
  });

  assert.deepEqual(rows.map((row) => [row.row_label, row.row_type, row.amount]), [
    ['ضرائب المنبع', 'deduction', 12],
    ['خصم إضافي', 'deduction', 8],
    ['إيراد إضافي', 'revenue', 30],
    ['تأمين نقدى', 'deduction', 100]
  ]);
});

test('buildAccountingFuelPurchaseMaps uses final accounting documents only', () => {
  const result = buildAccountingFuelPurchaseMaps([
    {
      month_key: '2026-06',
      is_final: 1,
      final_data: {
        month_key: '2026-06',
        debit_rows: [{ label: 'جملة مسحوبات المواد البترولية', amount: 2000 }],
        fuel_purchase_rows: [
          { date: '2026-06-01', fuel_type: 'سولار', quantity: 100, purchase_price: 10 },
          { date: '2026-06-15', fuel_type: 'بنزين ٩٢', quantity: 50, purchase_price: 12 }
        ]
      }
    },
    {
      month_key: '2026-06',
      is_final: 0,
      final_data: {
        month_key: '2026-06',
        debit_rows: [{ label: 'جملة مسحوبات المواد البترولية', amount: 9000 }],
        fuel_purchase_rows: [
          { date: '2026-06-22', fuel_type: 'سولار', quantity: 900, purchase_price: 10 }
        ]
      }
    }
  ], (fuelType) => {
    if (fuelType === 'سولار') return 'fuel_diesel';
    if (fuelType === 'بنزين ٩٢') return 'fuel_92';
    return null;
  });

  assert.equal(result.purchases.fuel_diesel.get('2026-06'), 1000);
  assert.equal(result.purchases.fuel_92.get('2026-06'), 597);
  assert.equal(result.insuranceByMonth.get('2026-06'), 403);
});

test('buildAccountingProfitRows uses final documents only', () => {
  const result = buildAccountingProfitRows([
    {
      month_key: '2026-06',
      is_final: 1,
      final_data: {
        month_key: '2026-06',
        credit_rows: [{ label: 'إيراد نهائي', amount: 40 }]
      }
    },
    {
      month_key: '2026-06',
      is_final: 0,
      final_data: {
        month_key: '2026-06',
        credit_rows: [{ label: 'إيراد مسودة', amount: 90 }]
      }
    }
  ]);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].row_label, 'إيراد نهائي');
  assert.equal(result.values.length, 1);
  assert.equal(result.values[0].amount, 40);
});
