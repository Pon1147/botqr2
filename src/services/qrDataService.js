// src/services/qrDataService.js
const { getValues, clearRange, appendValues } = require("./googleSheets");
const logger = require("./logger");

const userQrData = new Map(); // singleton Map trong service

/**
 * Lấy QR data của một user (nếu tồn tại)
 * @param {string} userId
 * @returns {Object|null} { bank, account, url, logo } hoặc null
 */
function getQr(userId) {
  return userQrData.get(userId) || null;
}

/**
 * Set hoặc update QR data cho user
 * @param {string} userId
 * @param {Object} qrObj { bank, account, url, logo }
 */
function setQr(userId, qrObj) {
  userQrData.set(userId, qrObj);
}

/**
 * Xóa QR data của user
 * @param {string} userId
 */
function deleteQr(userId) {
  userQrData.delete(userId);
}

/**
 * Load toàn bộ QR data từ sheet "QR_Data"
 * @param {string} spreadsheetId
 */
async function loadQrDataFromSheet(spreadsheetId) {
  if (!spreadsheetId) {
    await logger.error(
      "Không có GOOGLE_SHEETS_ID để load QR data",
      spreadsheetId
    );
    return;
  }

  try {
    const rows = await getValues(spreadsheetId, "QR_Data!A:F");
    userQrData.clear();

    for (const row of rows.slice(1)) {
      // skip header
      if (row.length >= 5) {
        // ít nhất userId, bank, account, url, logo
        const [
          userId,
          bank = "",
          account = "",
          url = "",
          logo = "",
          lastUpdated,
        ] = row;
        userQrData.set(userId, { bank, account, url, logo });
      }
    }

    await logger.info(
      `Loaded QR data from Sheets: ${userQrData.size} users`,
      spreadsheetId
    );
  } catch (error) {
    await logger.error(
      `Load QR from Sheets fail: ${error.message}`,
      spreadsheetId
    );
  }
}

/**
 * Save toàn bộ QR data hiện tại vào sheet (clear rồi append lại)
 * @param {string} spreadsheetId
 */
async function saveQrDataToSheet(spreadsheetId) {
  if (!spreadsheetId) return;

  const values = [];
  for (const [userId, qrObj] of userQrData.entries()) {
    values.push([
      userId,
      qrObj.bank || "",
      qrObj.account || "",
      qrObj.url || "",
      qrObj.logo || "",
      new Date().toISOString(),
    ]);
  }

  try {
    await clearRange(spreadsheetId, "QR_Data!A2:F");
    if (values.length > 0) {
      await appendValues(spreadsheetId, "QR_Data!A2", values);
    }
    await logger.info(
      `Saved ${values.length} QR records to Sheets`,
      spreadsheetId
    );
  } catch (error) {
    await logger.error(
      `Save QR to Sheets fail: ${error.message}`,
      spreadsheetId
    );
  }
}

module.exports = {
  getQr,
  setQr,
  deleteQr,
  loadQrDataFromSheet,
  saveQrDataToSheet,
  // Export Map nếu cần debug hoặc test, nhưng tốt nhất không nên expose trực tiếp
  // userQrData, // comment lại nếu không muốn expose
};
