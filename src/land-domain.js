const SAHM_PER_QIRAT = 24;
const QIRAT_PER_FEDDAN = 24;
const SAHM_PER_FEDDAN = SAHM_PER_QIRAT * QIRAT_PER_FEDDAN;

function toInteger(value, fieldName = 'value') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

function assertNonNegativeInteger(value, fieldName) {
  const parsed = toInteger(value, fieldName);
  if (parsed < 0) {
    throw new Error(`${fieldName} cannot be negative`);
  }
  return parsed;
}

function surfaceToSahm({ feddan = 0, qirat = 0, sahm = 0 } = {}) {
  const safeFeddan = assertNonNegativeInteger(feddan, 'feddan');
  const safeQirat = assertNonNegativeInteger(qirat, 'qirat');
  const safeSahm = assertNonNegativeInteger(sahm, 'sahm');

  if (safeQirat > 23) {
    throw new Error('qirat must be between 0 and 23');
  }
  if (safeSahm > 23) {
    throw new Error('sahm must be between 0 and 23');
  }

  return (safeFeddan * SAHM_PER_FEDDAN) + (safeQirat * SAHM_PER_QIRAT) + safeSahm;
}

function sahmToSurface(totalSahm = 0) {
  let remaining = assertNonNegativeInteger(totalSahm, 'totalSahm');
  const feddan = Math.floor(remaining / SAHM_PER_FEDDAN);
  remaining -= feddan * SAHM_PER_FEDDAN;
  const qirat = Math.floor(remaining / SAHM_PER_QIRAT);
  const sahm = remaining - (qirat * SAHM_PER_QIRAT);
  return { feddan, qirat, sahm };
}

function formatSurface(totalSahm = 0) {
  const surface = sahmToSurface(totalSahm);
  return `${surface.feddan} فدان، ${surface.qirat} قيراط، ${surface.sahm} سهم`;
}

function addSurfaces(...surfaces) {
  return surfaces.reduce((total, value) => total + assertNonNegativeInteger(value, 'surface'), 0);
}

function compareSurfaces(left, right) {
  return assertNonNegativeInteger(left, 'left') - assertNonNegativeInteger(right, 'right');
}

function parseMoneyToCents(value = 0) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('amount cannot be negative');
    }
    return Math.round(value * 100);
  }

  const normalized = String(value || '0').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('amount must be a non-negative money value');
  }

  const [pounds, fraction = ''] = normalized.split('.');
  return (parseInt(pounds, 10) * 100) + parseInt(fraction.padEnd(2, '0'), 10);
}

function formatMoney(cents = 0) {
  const safeCents = toInteger(cents, 'cents');
  const sign = safeCents < 0 ? '-' : '';
  const absolute = Math.abs(safeCents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')} جنيه مصري`;
}

function calculateRentByFeddan(surfaceSahm, pricePerFeddanCents) {
  const safeSurface = assertNonNegativeInteger(surfaceSahm, 'surfaceSahm');
  const safePrice = assertNonNegativeInteger(pricePerFeddanCents, 'pricePerFeddanCents');
  return Math.round((safeSurface * safePrice) / SAHM_PER_FEDDAN);
}

function calculateProportionalAmount(totalAmountCents, partSahm, totalSahm) {
  const safeTotalAmount = assertNonNegativeInteger(totalAmountCents, 'totalAmountCents');
  const safePart = assertNonNegativeInteger(partSahm, 'partSahm');
  const safeTotal = assertNonNegativeInteger(totalSahm, 'totalSahm');
  if (safeTotal <= 0) {
    throw new Error('totalSahm must be greater than zero');
  }
  return Math.round((safeTotalAmount * safePart) / safeTotal);
}

function allocateProportionalAmounts(totalAmountCents, partsSahm, totalSahm) {
  const safeTotalAmount = assertNonNegativeInteger(totalAmountCents, 'totalAmountCents');
  const parts = partsSahm.map((part) => assertNonNegativeInteger(part, 'partSahm'));
  const safeTotal = assertNonNegativeInteger(totalSahm, 'totalSahm');
  if (safeTotal <= 0) {
    throw new Error('totalSahm must be greater than zero');
  }

  let allocated = 0;
  return parts.map((part, index) => {
    if (index === parts.length - 1) {
      return safeTotalAmount - allocated;
    }
    const amount = Math.round((safeTotalAmount * part) / safeTotal);
    allocated += amount;
    return amount;
  });
}

function validateAvailableSurface(totalSahm, existingAssignedSahm, requestedSahm) {
  const total = assertNonNegativeInteger(totalSahm, 'totalSahm');
  const assigned = assertNonNegativeInteger(existingAssignedSahm, 'existingAssignedSahm');
  const requested = assertNonNegativeInteger(requestedSahm, 'requestedSahm');
  if (requested <= 0) {
    throw new Error('assigned surface must be greater than zero');
  }
  if (assigned + requested > total) {
    throw new Error('assigned surface exceeds available surface');
  }
  return true;
}

function splitInstallments(totalCents, firstValue = 50, mode = 'percent') {
  const total = assertNonNegativeInteger(totalCents, 'totalCents');
  let firstCents;
  if (mode === 'amount') {
    firstCents = assertNonNegativeInteger(firstValue, 'firstInstallmentCents');
  } else {
    const percent = Number(firstValue);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error('first installment percent must be between 0 and 100');
    }
    firstCents = Math.round((total * percent) / 100);
  }
  if (firstCents > total) {
    throw new Error('first installment exceeds total rent');
  }
  return [firstCents, total - firstCents];
}

function calculatePaymentSummary(totalDueCents, firstExpectedCents, secondExpectedCents, firstPaidCents = 0, secondPaidCents = 0, today = new Date(), dueDates = {}) {
  const totalDue = assertNonNegativeInteger(totalDueCents, 'totalDueCents');
  const firstExpected = assertNonNegativeInteger(firstExpectedCents, 'firstExpectedCents');
  const secondExpected = assertNonNegativeInteger(secondExpectedCents, 'secondExpectedCents');
  const firstPaid = assertNonNegativeInteger(firstPaidCents, 'firstPaidCents');
  const secondPaid = assertNonNegativeInteger(secondPaidCents, 'secondPaidCents');
  const totalPaid = firstPaid + secondPaid;
  const balance = totalDue - totalPaid;
  const remainingCents = Math.max(balance, 0);
  const creditCents = Math.max(-balance, 0);
  const todayKey = today instanceof Date ? today.toISOString().slice(0, 10) : String(today || '').slice(0, 10);
  const overdue = remainingCents > 0 && (
    (dueDates.secondDueDate && dueDates.secondDueDate < todayKey)
    || (dueDates.firstDueDate && firstPaid < firstExpected && dueDates.firstDueDate < todayKey)
  );

  let status = 'unpaid';
  if (creditCents > 0) {
    status = 'overpaid';
  } else if (remainingCents === 0) {
    status = 'paid_full';
  } else if (overdue) {
    status = 'overdue';
  } else if (firstPaid <= 0 && secondPaid <= 0) {
    status = 'unpaid';
  } else if (firstPaid < firstExpected) {
    status = 'first_partial';
  } else if (secondPaid <= 0) {
    status = 'first_paid';
  } else if (secondPaid < secondExpected) {
    status = 'second_partial';
  }

  return {
    totalDueCents: totalDue,
    firstExpectedCents: firstExpected,
    secondExpectedCents: secondExpected,
    firstPaidCents: firstPaid,
    secondPaidCents: secondPaid,
    totalPaidCents: totalPaid,
    remainingCents,
    creditCents,
    status
  };
}

function derivePlotStatus(totalSahm, assignedSahm) {
  const total = assertNonNegativeInteger(totalSahm, 'totalSahm');
  const assigned = assertNonNegativeInteger(assignedSahm, 'assignedSahm');
  if (assigned <= 0) return 'available';
  if (assigned >= total) return 'fully_rented';
  return 'partially_rented';
}

module.exports = {
  SAHM_PER_QIRAT,
  QIRAT_PER_FEDDAN,
  SAHM_PER_FEDDAN,
  surfaceToSahm,
  sahmToSurface,
  formatSurface,
  addSurfaces,
  compareSurfaces,
  parseMoneyToCents,
  formatMoney,
  calculateRentByFeddan,
  calculateProportionalAmount,
  allocateProportionalAmounts,
  validateAvailableSurface,
  splitInstallments,
  calculatePaymentSummary,
  derivePlotStatus
};
