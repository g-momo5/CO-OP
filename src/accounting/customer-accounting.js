const { normalizeDate, roundMoney, toNumber } = require('./common');
const { normalizeShiftRecord } = require('./shift-accounting');

function isVoucherRow(row = {}) {
  return Boolean(row.voucher || row.new_voucher || row.difference_voucher || row.voucher_type);
}

function calculateCustomerShiftConsumption(rawShift = {}) {
  const shift = normalizeShiftRecord(rawShift);
  return shift.customer_rows
    .map((row) => {
      const customerId = row.customer_id || null;
      const customerName = String(row.name || row.customer_name || '').trim();
      const voucher = isVoucherRow(row);
      const quantity = toNumber(row.diesel) + toNumber(row['80']) + toNumber(row['92']) + toNumber(row['95']);
      if (quantity <= 0) return null;
      return {
        date: shift.date,
        shift_number: shift.shift_number,
        customer_id: voucher ? null : customerId,
        customer_name: voucher ? '' : customerName,
        voucher,
        diesel: toNumber(row.diesel),
        '80': toNumber(row['80']),
        '92': toNumber(row['92']),
        '95': toNumber(row['95']),
        quantity
      };
    })
    .filter(Boolean);
}

function calculateCustomerPayments(rawShift = {}) {
  const shift = normalizeShiftRecord(rawShift);
  return shift.customer_payments.map((payment) => ({
    date: shift.date,
    shift_number: shift.shift_number,
    customer_id: payment.customer_id || null,
    customer_name: String(payment.customer_name || payment.name || '').trim(),
    amount: toNumber(payment.amount)
  })).filter((payment) => payment.amount > 0 && (payment.customer_id || payment.customer_name));
}

function calculateCustomerBalance({ openingBalance = 0, consumptions = [], payments = [] } = {}) {
  const totalConsumption = consumptions
    .filter((row) => !row.voucher)
    .reduce((sum, row) => sum + toNumber(row.amount ?? row.total_amount ?? row.value), 0);
  const totalPayments = payments.reduce((sum, row) => sum + toNumber(row.amount), 0);
  return {
    opening_balance: roundMoney(openingBalance),
    consumption_total: roundMoney(totalConsumption),
    payment_total: roundMoney(totalPayments),
    balance: roundMoney(toNumber(openingBalance) + totalConsumption - totalPayments)
  };
}

function filterCustomerEntries(entries = [], customer) {
  const customerId = customer?.customer_id || customer?.id || null;
  const customerName = String(customer?.customer_name || customer?.name || customer || '').trim();
  return entries.filter((entry) => {
    if (customerId && entry.customer_id === customerId) return true;
    return customerName && entry.customer_name === customerName;
  }).sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));
}

module.exports = {
  calculateCustomerBalance,
  calculateCustomerPayments,
  calculateCustomerShiftConsumption,
  filterCustomerEntries,
  isVoucherRow
};
