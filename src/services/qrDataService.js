const { getValues, clearRange, appendValues } = require("./googleSheets");
const logger = require("./logger");

const userQrData = new Map();

function getQr(userId) {
  return userQrData.get(userId) || null;
}

function setQr(userId, qrObj) {
  userQrData.set(userId, qrObj);
}

function deleteQr(userId) {
  userQrData.delete(userId);
}

async function loadQrDataFromSheet(spreadsheetId) {
  if (!spreadsheetId) {
    await logger.error("Missing GOOGLE_SHEETS_ID to load QR data", spreadsheetId);
    return;
  }

  try {
    const rows = await getValues(spreadsheetId, "QR_Data!A:H");
    userQrData.clear();

    for (const row of rows.slice(1)) {
      if (row.length >= 5) {
        const [
          userId,
          bank = "",
          account = "",
          url = "",
          logo = "",
          bankCode = "",
          accountName = "",
        ] = row;

        userQrData.set(userId, {
          bank,
          account,
          url,
          logo,
          bankCode,
          accountName,
        });
      }
    }

    await logger.info(
      `Loaded QR data from Sheets: ${userQrData.size} users`,
      spreadsheetId,
    );
  } catch (error) {
    await logger.error(`Load QR from Sheets fail: ${error.message}`, spreadsheetId);
  }
}

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
      qrObj.bankCode || "",
      qrObj.accountName || "",
      new Date().toISOString(),
    ]);
  }

  try {
    await clearRange(spreadsheetId, "QR_Data!A2:H");
    if (values.length > 0) {
      await appendValues(spreadsheetId, "QR_Data!A2", values);
    }

    await logger.info(
      `Saved ${values.length} QR records to Sheets`,
      spreadsheetId,
    );
  } catch (error) {
    await logger.error(`Save QR to Sheets fail: ${error.message}`, spreadsheetId);
  }
}

module.exports = {
  getQr,
  setQr,
  deleteQr,
  loadQrDataFromSheet,
  saveQrDataToSheet,
};
