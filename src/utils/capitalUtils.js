// src/utils/capitalUtils.js
// Runtime capital state + Google Sheets persistence.

const { getValues, appendValues } = require("../services/googleSheets");

let capitalData = 0;

function parseCapitalAmount(rawValue) {
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) ? rawValue : 0;
  }

  const rawText = String(rawValue || "").trim();
  if (!rawText) return 0;

  const cleaned = rawText.replace(/[^\d,.-]/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalIndex = Math.max(lastComma, lastDot);
    const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
    const decimalPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, "");
    normalized = `${integerPart}.${decimalPart}`;
  } else if (hasComma) {
    const commaParts = cleaned.split(",");
    normalized =
      commaParts.length === 2 && commaParts[1].length <= 2
        ? `${commaParts[0]}.${commaParts[1]}`
        : cleaned.replace(/,/g, "");
  } else if (hasDot) {
    const dotParts = cleaned.split(".");
    normalized =
      dotParts.length === 2 && dotParts[1].length <= 2
        ? cleaned
        : cleaned.replace(/\./g, "");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getCapitalData() {
  return capitalData;
}

/**
 * Load latest capital from Capital!A:B.
 * @param {Object} config
 * @returns {Promise<number>}
 */
async function loadCapitalFromSheet(config) {
  const { SHEETS_ID, logger } = config;

  try {
    const rows = await getValues(SHEETS_ID, "Capital!A:B");
    if (rows.length > 1) {
      const latestRow = rows[rows.length - 1];
      capitalData = Math.round(parseCapitalAmount(latestRow[1]));
    } else {
      capitalData = 0;
    }

    await logger.info(
      `Đã load vốn: ${capitalData.toLocaleString()} VND`,
      SHEETS_ID
    );
    return capitalData;
  } catch (error) {
    await logger.error(`Load capital thất bại: ${error.message}`, SHEETS_ID);
    throw error;
  }
}

/**
 * Append latest capital into Capital!A:B.
 * @param {number|string} amount
 * @param {Object} config
 * @returns {Promise<number>}
 */
async function saveCapitalToSheet(amount, config) {
  const { SHEETS_ID, logger } = config;
  const normalizedAmount = Math.round(parseCapitalAmount(amount));

  if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
    throw new Error("Capital amount is invalid");
  }

  const values = [[new Date().toISOString(), normalizedAmount]];

  try {
    await appendValues(SHEETS_ID, "Capital!A:B", values);
    capitalData = normalizedAmount;
    await logger.info(
      `Đã lưu vốn mới: ${normalizedAmount.toLocaleString()} VND`,
      SHEETS_ID
    );
    return capitalData;
  } catch (error) {
    await logger.error(`Lưu capital thất bại: ${error.message}`, SHEETS_ID);
    throw error;
  }
}

module.exports = {
  getCapitalData,
  loadCapitalFromSheet,
  saveCapitalToSheet,
};

