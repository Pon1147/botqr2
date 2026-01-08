// src/services/paymentService.js
const { getValues, clearRange, appendValues } = require('./googleSheets');
const logger = require('./logger');

let paymentsData = []; // array lưu toàn bộ transactions
let totalConfirmedAmount = 0; // cache tổng confirmed

/**
 * Load toàn bộ payments từ sheet "Payments"
 * @param {string} spreadsheetId 
 */
async function loadPaymentsFromSheet(spreadsheetId) {
  if (!spreadsheetId) {
    await logger.error('Không có GOOGLE_SHEETS_ID để load Payments', spreadsheetId);
    return;
  }

  try {
    const rows = await getValues(spreadsheetId, 'Payments!A:H');
    paymentsData = [];
    totalConfirmedAmount = 0;

    for (const row of rows.slice(1)) { // skip header
      const fullRow = row.concat(Array(8 - row.length).fill(''));
      if (fullRow.length === 8) {
        const [id, buyerId, amount, description, status, date, processedDate, reason] = fullRow;
        const payment = {
          id: id || '',
          buyerId: buyerId || '',
          amount: parseFloat(amount) || 0,
          description: description || '',
          status: status || '',
          date: date || '',
          processedDate: processedDate || '',
          reason: reason || '',
        };
        paymentsData.push(payment);

        if (payment.status === 'confirmed') {
          totalConfirmedAmount += payment.amount;
        }
      }
    }

    await logger.info(
      `Loaded payments from Sheets: ${paymentsData.length} transactions, Total Confirmed: ${totalConfirmedAmount.toLocaleString('vi-VN', { style: 'currency', currency: 'VND' })}`,
      spreadsheetId
    );
  } catch (error) {
    await logger.error(`Load payments from Sheets fail: ${error.message}`, spreadsheetId);
  }
}

/**
 * Lưu toàn bộ payments vào sheet (clear rồi append lại)
 * @param {string} spreadsheetId 
 * @param {Object} [newTx=null] - Nếu có tx mới confirmed, cập nhật total
 */
async function savePaymentsToSheet(spreadsheetId, newTx = null) {
  if (!spreadsheetId) return;

  if (newTx && newTx.status === 'confirmed') {
    totalConfirmedAmount += newTx.amount;
  }

  const values = paymentsData.map(tx => [
    tx.id || '',
    tx.buyerId || '',
    tx.amount || 0,
    tx.description || '',
    tx.status || '',
    tx.date || '',
    tx.processedDate || '',
    tx.reason || '',
  ]);

  try {
    await clearRange(spreadsheetId, 'Payments!A2:H');
    if (values.length > 0) {
      await appendValues(spreadsheetId, 'Payments!A2', values);
    }
    await logger.info(
      `Saved ${values.length} payments to Sheets, Total Confirmed: ${totalConfirmedAmount.toLocaleString('vi-VN', { style: 'currency', currency: 'VND' })}`,
      spreadsheetId
    );
  } catch (error) {
    await logger.error(`Save payments to Sheets fail: ${error.message}`, spreadsheetId);
  }
}

/**
 * Lấy danh sách payments sorted theo date (mới nhất trước)
 * @returns {Array}
 */
function getSortedPayments() {
  return [...paymentsData].sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * Thêm một payment mới vào array và save ngay
 * @param {Object} newTx 
 * @param {string} spreadsheetId 
 */
async function addPayment(newTx, spreadsheetId) {
  paymentsData.unshift(newTx); // thêm vào đầu để mới nhất ở trên
  await savePaymentsToSheet(spreadsheetId, newTx);
}

/**
 * Lấy payments của một buyer cụ thể
 * @param {string} buyerId 
 * @returns {Array}
 */
function getPaymentsByBuyerId(buyerId) {
  return paymentsData.filter(tx => tx.buyerId === buyerId);
}

/**
 * Lấy tổng confirmed amount (cache)
 * @returns {number}
 */
function getTotalConfirmed() {
  return totalConfirmedAmount;
}

module.exports = {
  loadPaymentsFromSheet,
  savePaymentsToSheet,
  getSortedPayments,
  addPayment,
  getPaymentsByBuyerId,
  getTotalConfirmed,
};