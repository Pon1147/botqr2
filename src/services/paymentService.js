const { getValues, clearRange, appendValues } = require("./googleSheets");
const logger = require("./logger");

let paymentsData = [];
let totalConfirmedAmount = 0;

function parseAmount(rawAmount) {
  if (typeof rawAmount === "number") {
    return Number.isFinite(rawAmount) ? rawAmount : 0;
  }

  const text = String(rawAmount || "").trim();
  if (!text) return 0;

  const cleaned = text.replace(/[^\d,.-]/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && !hasDot) {
    const parts = cleaned.split(",");
    if (parts.length > 2 || (parts[1] && parts[1].length > 2)) {
      return Number.parseFloat(cleaned.replace(/,/g, "")) || 0;
    }
  }

  if (hasDot && !hasComma) {
    const parts = cleaned.split(".");
    if (parts.length > 2 || (parts[1] && parts[1].length > 2)) {
      return Number.parseFloat(cleaned.replace(/\./g, "")) || 0;
    }
  }

  const normalized = cleaned.replace(/,/g, ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recalculateTotalConfirmed() {
  totalConfirmedAmount = paymentsData.reduce((sum, tx) => {
    if (tx.status !== "confirmed") return sum;
    return sum + (Number(tx.amount) || 0);
  }, 0);
}

/**
 * Load all payments from "Payments" sheet.
 * @param {string} spreadsheetId
 */
async function loadPaymentsFromSheet(spreadsheetId) {
  if (!spreadsheetId) {
    await logger.error("Missing GOOGLE_SHEETS_ID to load Payments", spreadsheetId);
    return;
  }

  try {
    const rows = await getValues(spreadsheetId, "Payments!A:H");
    paymentsData = [];

    for (const row of rows.slice(1)) {
      const fullRow = row.concat(Array(8 - row.length).fill(""));
      if (fullRow.length === 8) {
        const [
          id,
          buyerId,
          amount,
          description,
          status,
          date,
          processedDate,
          reason,
        ] = fullRow;

        paymentsData.push({
          id: id || "",
          buyerId: buyerId || "",
          amount: parseAmount(amount),
          description: description || "",
          status: status || "",
          date: date || "",
          processedDate: processedDate || "",
          reason: reason || "",
        });
      }
    }

    recalculateTotalConfirmed();

    await logger.info(
      `Loaded payments from Sheets: ${paymentsData.length} transactions, Total Confirmed: ${totalConfirmedAmount.toLocaleString(
        "vi-VN",
        { style: "currency", currency: "VND" }
      )}`,
      spreadsheetId
    );
  } catch (error) {
    await logger.error(
      `Load payments from Sheets fail: ${error.message}`,
      spreadsheetId
    );
  }
}

/**
 * Save all payments into sheet (clear then append).
 * @param {string} spreadsheetId
 */
async function savePaymentsToSheet(spreadsheetId) {
  if (!spreadsheetId) return;

  recalculateTotalConfirmed();

  const values = paymentsData.map((tx) => [
    tx.id || "",
    tx.buyerId || "",
    tx.amount || 0,
    tx.description || "",
    tx.status || "",
    tx.date || "",
    tx.processedDate || "",
    tx.reason || "",
  ]);

  try {
    await clearRange(spreadsheetId, "Payments!A2:H");
    if (values.length > 0) {
      await appendValues(spreadsheetId, "Payments!A2", values);
    }

    await logger.info(
      `Saved ${values.length} payments to Sheets, Total Confirmed: ${totalConfirmedAmount.toLocaleString(
        "vi-VN",
        { style: "currency", currency: "VND" }
      )}`,
      spreadsheetId
    );
  } catch (error) {
    await logger.error(
      `Save payments to Sheets fail: ${error.message}`,
      spreadsheetId
    );
  }
}

/**
 * Return payments sorted by date (newest first).
 * @returns {Array}
 */
function getSortedPayments() {
  return [...paymentsData].sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * Add new payment and append immediately.
 * @param {Object} newTx
 * @param {string} spreadsheetId
 */
async function addPayment(newTx, spreadsheetId) {
  paymentsData.unshift(newTx);
  if (!spreadsheetId) return;

  try {
    await appendValues(spreadsheetId, "Payments!A2:H", [[
      newTx.id || "",
      newTx.buyerId || "",
      newTx.amount || 0,
      newTx.description || "",
      newTx.status || "",
      newTx.date || "",
      newTx.processedDate || "",
      newTx.reason || "",
    ]]);

    await logger.info(
      `Appended 1 payment to Sheets: ${newTx.id || "N/A"}`,
      spreadsheetId
    );
  } catch (error) {
    await logger.error(
      `Append payment to Sheets fail: ${error.message}`,
      spreadsheetId
    );
  }
}

/**
 * Get all payments of a specific buyer.
 * @param {string} buyerId
 * @returns {Array}
 */
function getPaymentsByBuyerId(buyerId) {
  return paymentsData.filter((tx) => tx.buyerId === buyerId);
}

/**
 * Get a payment by id.
 * @param {string} id
 * @returns {Object|null}
 */
function getPaymentById(id) {
  return paymentsData.find((tx) => tx.id === id) || null;
}

/**
 * Get total confirmed amount from cache.
 * @returns {number}
 */
function getTotalConfirmed() {
  return totalConfirmedAmount;
}

/**
 * Remove payment by id.
 * @param {string} id
 * @returns {Object|null}
 */
function removePaymentById(id) {
  const index = paymentsData.findIndex((tx) => tx.id === id);
  if (index === -1) return null;

  const removedTx = paymentsData.splice(index, 1)[0];
  recalculateTotalConfirmed();
  return removedTx;
}

module.exports = {
  loadPaymentsFromSheet,
  savePaymentsToSheet,
  getSortedPayments,
  addPayment,
  getPaymentsByBuyerId,
  getPaymentById,
  getTotalConfirmed,
  removePaymentById,
};

