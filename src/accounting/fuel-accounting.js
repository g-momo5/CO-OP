const {
  clone,
  findMatchingEntry,
  getEntryName,
  roundMoney,
  toNumber
} = require('./common');

function getFuelCounterCount(entryKey, data = {}) {
  return getEntryName(entryKey, data) === 'سولار' ? 4 : 2;
}

function calculateFuelCounterQuantity(firstShift, lastShift) {
  return toNumber(lastShift) - toNumber(firstShift);
}

function calculateFuelEntry(entryKey, entry = {}, options = {}) {
  const data = clone(entry) || {};
  const previousData = options.previousData || null;
  const counterCount = getFuelCounterCount(entryKey, data);
  const errors = [];
  let totalQuantity = 0;

  for (let i = 1; i <= counterCount; i += 1) {
    if (previousData && previousData[`lastShift${i}`] !== undefined && previousData[`lastShift${i}`] !== null) {
      data[`firstShift${i}`] = toNumber(previousData[`lastShift${i}`]);
    }

    const firstShift = toNumber(data[`firstShift${i}`]);
    const lastShift = toNumber(data[`lastShift${i}`]);
    if (firstShift > 0 && lastShift < firstShift) {
      errors.push(`${getEntryName(entryKey, data)} (${i}): آخر الوردية يجب أن يكون أكبر من أو يساوي أول الوردية`);
    }

    const quantity = calculateFuelCounterQuantity(firstShift, lastShift);
    data[`quantity${i}`] = Math.round(quantity);
    totalQuantity += quantity;
  }

  data.totalQuantity = totalQuantity >= 0 ? Math.round(totalQuantity) : 0;
  data.cash = roundMoney((toNumber(data.totalQuantity) - toNumber(data.clients) - toNumber(data.cars)) * toNumber(data.price));

  return { entry: data, cash: toNumber(data.cash), quantity: toNumber(data.totalQuantity), errors };
}

function recalculateFuelData(currentFuelData = {}, previousFuelData = {}) {
  const fuelData = clone(currentFuelData) || {};
  let fuelTotal = 0;
  const errors = [];

  Object.entries(fuelData).forEach(([entryKey, data]) => {
    if (!data || typeof data !== 'object') return;
    const previousData = findMatchingEntry(previousFuelData, entryKey, data);
    const result = calculateFuelEntry(entryKey, data, { previousData });
    fuelData[entryKey] = result.entry;
    fuelTotal += result.cash;
    errors.push(...result.errors);
  });

  return {
    fuel_data: fuelData,
    fuel_total: roundMoney(fuelTotal),
    errors
  };
}

function calculateFuelTotal(fuelData = {}) {
  return recalculateFuelData(fuelData).fuel_total;
}

function validateFuelData(fuelData = {}) {
  return recalculateFuelData(fuelData).errors;
}

function getShiftFuelSoldQuantity(entryKey, data = {}) {
  if (!data || typeof data !== 'object') return 0;

  let totalQuantity = toNumber(data.totalQuantity);
  if (totalQuantity <= 0) {
    const counterCount = getFuelCounterCount(entryKey, data);
    for (let i = 1; i <= counterCount; i += 1) {
      totalQuantity += toNumber(data[`quantity${i}`]);
    }
  }

  return Math.max(totalQuantity - toNumber(data.cars), 0);
}

function getFuelProfitValue(fuelData = {}, fuelName) {
  const target = String(fuelName || '').trim();
  if (!target) return 0;
  const found = Object.entries(fuelData || {}).find(([entryKey, data]) => getEntryName(entryKey, data) === target);
  const data = found ? found[1] : null;
  if (!data || typeof data !== 'object') return 0;
  return (toNumber(data.totalQuantity) - toNumber(data.cars)) * toNumber(data.price);
}

module.exports = {
  calculateFuelCounterQuantity,
  calculateFuelEntry,
  calculateFuelTotal,
  getFuelCounterCount,
  getFuelProfitValue,
  getShiftFuelSoldQuantity,
  recalculateFuelData,
  validateFuelData
};
