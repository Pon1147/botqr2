// src/utils/capitalUtils.js
// Logic load/save vốn, sử dụng singleton từ googleSheets.js

const {
  getSheetsClient,
  getValues,
  appendValues,
} = require("../services/googleSheets");

let capitalData = 0;

/**
 * Load giá trị vốn mới nhất từ sheet Capital!A:B
 * @param {Object} config - Chứa SHEETS_ID và logger
 */
async function loadCapitalFromSheet(config) {
  const { SHEETS_ID, logger } = config;

  try {
    const rows = await getValues(SHEETS_ID, "Capital!A:B");
    if (rows.length > 1) {
      const latestRow = rows[rows.length - 1];
      capitalData = parseFloat(latestRow[1]) || 0;
    }
    await logger.info(
      `Đã load vốn: ${capitalData.toLocaleString()} VNĐ`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(`Load capital thất bại: ${error.message}`, SHEETS_ID);
  }
}

/**
 * Lưu giá trị vốn mới vào sheet Capital!A:B
 * @param {number} amount - Số vốn mới
 * @param {Object} config - Chứa SHEETS_ID và logger
 */
async function saveCapitalToSheet(amount, config) {
  const { SHEETS_ID, logger } = config;

  const values = [[new Date().toISOString(), amount]];

  try {
    await appendValues(SHEETS_ID, "Capital!A:B", values);
    capitalData = amount;
    await logger.info(
      `Đã lưu vốn mới: ${amount.toLocaleString()} VNĐ`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(`Lưu capital thất bại: ${error.message}`, SHEETS_ID);
  }
}

module.exports = {
  loadCapitalFromSheet,
  saveCapitalToSheet,
  capitalData,
};
