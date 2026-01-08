// src/services/googleSheets.js
const { google } = require('googleapis');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '../../service-account-key.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Biến singleton cho sheets client
let sheetsClient = null;

/**
 * Khởi tạo và authenticate Google Sheets client (singleton pattern)
 * @returns {Promise<google.sheets.v4.Sheets>} Sheets instance
 * @throws {Error} Nếu auth thất bại
 */
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_PATH,
      scopes: SCOPES,
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('[GoogleSheets] Authenticated successfully');
    return sheetsClient;
  } catch (error) {
    console.error('[GoogleSheets] Authentication failed:', error.message);
    throw new Error(`Google Sheets authentication failed: ${error.message}`);
  }
}

/**
 * Lấy dữ liệu từ một range trong spreadsheet
 * @param {string} spreadsheetId - ID của Google Sheet
 * @param {string} range - Ví dụ: 'QR_Data!A:F' hoặc 'Payments!A:H'
 * @returns {Promise<Array<Array<any>>>} Mảng các rows (bao gồm header nếu có)
 * @throws {Error}
 */
async function getValues(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return response.data.values || [];
  } catch (error) {
    throw new Error(`Failed to get values from ${range}: ${error.message}`);
  }
}

/**
 * Xóa sạch dữ liệu trong range (từ dòng 2 trở đi thường dùng để giữ header)
 * @param {string} spreadsheetId
 * @param {string} range Ví dụ: 'Payments!A2:H'
 */
async function clearRange(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });
  } catch (error) {
    throw new Error(`Failed to clear range ${range}: ${error.message}`);
  }
}

/**
 * Append nhiều rows vào cuối range
 * @param {string} spreadsheetId
 * @param {string} range Ví dụ: 'QR_Data!A2' (append bắt đầu từ đây)
 * @param {Array<Array<any>>} values - Mảng các rows cần ghi
 * @param {string} [valueInputOption='RAW'] - 'RAW' hoặc 'USER_ENTERED'
 */
async function appendValues(spreadsheetId, range, values, valueInputOption = 'RAW') {
  if (!values.length) return;

  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption,
      resource: { values },
    });
  } catch (error) {
    throw new Error(`Failed to append to ${range}: ${error.message}`);
  }
}

/**
 * Cập nhật toàn bộ dữ liệu vào range (thường dùng sau clear)
 * @param {string} spreadsheetId
 * @param {string} range
 * @param {Array<Array<any>>} values
 */
async function updateValues(spreadsheetId, range, values) {
  if (!values.length) return;

  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values },
    });
  } catch (error) {
    throw new Error(`Failed to update ${range}: ${error.message}`);
  }
}

/**
 * Utility: append một log row vào sheet Logs
 * @param {string} spreadsheetId
 * @param {string} level
 * @param {string} message
 */
async function appendLog(spreadsheetId, level, message) {
  const timestamp = new Date().toISOString();
  const row = [timestamp, level, message];

  await appendValues(spreadsheetId, 'Logs!A:C', [row]);
}

module.exports = {
  getSheetsClient,
  getValues,
  clearRange,
  appendValues,
  updateValues,
  appendLog,
};