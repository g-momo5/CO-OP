const {
  clone,
  findMatchingEntry,
  getEntryName,
  normalizeName,
  roundMoney,
  roundQuantity,
  toNumber
} = require('./common');

const LOOSE_OIL_NAME = 'سايب ١ ك';

function calculateOilEntry(entryKey, entry = {}, options = {}) {
  const data = clone(entry) || {};
  const previousData = options.previousData || null;
  const errors = [];

  if (previousData && previousData.remaining !== undefined && previousData.remaining !== null) {
    data.initial = roundQuantity(previousData.remaining);
  }

  const total = roundQuantity(toNumber(data.initial) + toNumber(data.added));
  const remaining = roundQuantity(data.remaining);
  data.total = total;

  if (remaining > total && remaining > 0) {
    errors.push(`${getEntryName(entryKey, data)}: الكمية المتبقية يجب أن تكون أقل من أو تساوي الإجمالي المتاح`);
  }

  const sold = roundQuantity(total - remaining);
  data.sold = sold >= 0 ? sold : 0;

  const revenue = roundMoney((toNumber(data.sold) - toNumber(data.customers) - toNumber(data.open)) * toNumber(data.price));
  data.revenue = revenue >= 0 ? revenue : 0;

  if (toNumber(data.open) > toNumber(data.sold) && toNumber(data.open) > 0) {
    errors.push(`${getEntryName(entryKey, data)}: كمية مفتوح يجب أن تكون أقل من أو تساوي المباع`);
  }

  return {
    entry: data,
    sold: toNumber(data.sold),
    revenue: toNumber(data.revenue),
    errors
  };
}

function recalculateOilData(currentOilData = {}, previousOilData = {}) {
  const oilData = clone(currentOilData) || {};
  let oilTotal = 0;
  const errors = [];

  Object.entries(oilData).forEach(([entryKey, data]) => {
    if (!data || typeof data !== 'object') return;
    const previousData = findMatchingEntry(previousOilData, entryKey, data);
    const result = calculateOilEntry(entryKey, data, { previousData });
    oilData[entryKey] = result.entry;
    oilTotal += result.revenue;
    errors.push(...result.errors);
  });

  return {
    oil_data: oilData,
    oil_total: roundMoney(oilTotal),
    errors
  };
}

function calculateOilTotal(oilData = {}) {
  return recalculateOilData(oilData).oil_total;
}

function validateOilData(oilData = {}, options = {}) {
  const recalculated = recalculateOilData(oilData);
  const errors = [...recalculated.errors];

  const looseOilIncoming = Object.entries(recalculated.oil_data).reduce((sum, [entryKey, data]) => {
    if (normalizeName(getEntryName(entryKey, data)) !== LOOSE_OIL_NAME) return sum;
    return sum + toNumber(data.added);
  }, 0);
  const hasAnyOpenOil = Object.values(recalculated.oil_data).some((data) => toNumber(data?.open) >= 1);

  if (options.requireLooseOilOpen && looseOilIncoming > 0 && !hasAnyOpenOil) {
    errors.push('يوجد وارد لزيت سايب ١ ك بدون وجود أي زيوت مفتوحة. من فضلك حدد أي زيت تم فتحه');
  }

  return errors;
}

function getOilSoldQuantity(data = {}) {
  return toNumber(data?.sold);
}

function getOilProfitValue(oilData = {}) {
  return Object.values(oilData || {}).reduce((sum, entry) => {
    if (!entry || typeof entry !== 'object') return sum;
    return sum + ((toNumber(entry.sold) - toNumber(entry.open)) * toNumber(entry.price));
  }, 0);
}

module.exports = {
  LOOSE_OIL_NAME,
  calculateOilEntry,
  calculateOilTotal,
  getOilProfitValue,
  getOilSoldQuantity,
  recalculateOilData,
  validateOilData
};
