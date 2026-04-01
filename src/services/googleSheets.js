// src/services/googleSheets.js
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "../../service-account-key.json");
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// Singleton sheets client
let sheetsClient = null;

/**
 * Initialize and authenticate Google Sheets client.
 * Supported credential modes:
 * 1) GOOGLE_SERVICE_ACCOUNT (JSON string)
 * 2) service-account-key.json file
 */
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  try {
    const credsRaw = process.env.GOOGLE_SERVICE_ACCOUNT;
    let auth;

    if (credsRaw) {
      const credentials = JSON.parse(credsRaw);
      if (credentials.private_key) {
        credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
      }

      auth = await google.auth.fromJSON(credentials);
      auth.scopes = SCOPES;
      console.log("[GoogleSheets] Authenticated successfully from GOOGLE_SERVICE_ACCOUNT");
    } else if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      auth = new google.auth.GoogleAuth({
        keyFile: SERVICE_ACCOUNT_PATH,
        scopes: SCOPES,
      });
      console.log("[GoogleSheets] Authenticated successfully from service-account-key.json");
    } else {
      throw new Error(
        "Missing credentials: set GOOGLE_SERVICE_ACCOUNT or provide service-account-key.json"
      );
    }

    sheetsClient = google.sheets({ version: "v4", auth });
    return sheetsClient;
  } catch (error) {
    console.error("[GoogleSheets] Authentication failed:", error.message || error);
    throw new Error(`Google Sheets authentication failed: ${error.message}`);
  }
}

/**
 * Get values from a sheet range.
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
 * Clear a sheet range.
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
 * Append multiple rows.
 */
async function appendValues(spreadsheetId, range, values, valueInputOption = "RAW") {
  if (!values || !values.length) return;

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
 * Update all values in a range.
 */
async function updateValues(spreadsheetId, range, values) {
  if (!values || !values.length) return;

  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      resource: { values },
    });
  } catch (error) {
    throw new Error(`Failed to update ${range}: ${error.message}`);
  }
}

/**
 * Append one log row to Logs sheet.
 */
async function appendLog(spreadsheetId, level, message) {
  const timestamp = new Date().toISOString();
  const row = [timestamp, level, message];

  await appendValues(spreadsheetId, "Logs!A:C", [row]);
}

/**
 * Append one feedback row to Feedback sheet.
 * @param {string} spreadsheetId
 * @param {{
 *   timestamp?: string;
 *   userId: string;
 *   username: string;
 *   txId: string;
 *   orderItems: string;
 *   rating: number|string;
 *   category: string;
 *   comment: string;
 * }} payload
 */
async function appendFeedback(spreadsheetId, payload) {
  const row = [
    payload.timestamp || new Date().toISOString(),
    payload.userId || "",
    payload.username || "",
    payload.txId || payload.qrId || "",
    payload.orderItems || "",
    payload.rating ?? "",
    payload.category || "",
    payload.comment || "",
  ];

  await appendValues(spreadsheetId, "Feedback!A:H", [row]);
}

function isSettingsHeaderRow(row) {
  if (!row || row.length < 2) return false;
  const left = String(row[0] || "").trim().toLowerCase();
  const right = String(row[1] || "").trim().toLowerCase();
  return left === "key" && right === "value";
}

/**
 * Get one setting value from Settings sheet.
 * @param {string} spreadsheetId
 * @param {string} key
 * @returns {Promise<string|null>}
 */
async function getSetting(spreadsheetId, key) {
  if (!key) return null;

  const rows = await getValues(spreadsheetId, "Settings!A:B");
  if (!rows.length) return null;

  const startIndex = isSettingsHeaderRow(rows[0]) ? 1 : 0;
  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i];
    if (String(row[0] || "").trim() === key) {
      return String(row[1] || "").trim() || null;
    }
  }
  return null;
}

async function writeSettingsRows(spreadsheetId, rows) {
  await clearRange(spreadsheetId, "Settings!A:B");
  if (rows.length > 0) {
    await appendValues(spreadsheetId, "Settings!A1", rows);
  }
}

/**
 * Upsert one setting to Settings sheet.
 * @param {string} spreadsheetId
 * @param {string} key
 * @param {string} value
 */
async function setSetting(spreadsheetId, key, value) {
  if (!key) throw new Error("Setting key is required");

  const rows = await getValues(spreadsheetId, "Settings!A:B");
  const hasHeader = rows.length > 0 && isSettingsHeaderRow(rows[0]);
  const outputRows = rows.length > 0 ? [...rows] : [["key", "value"]];
  const startIndex = hasHeader ? 1 : 0;

  if (!hasHeader && outputRows.length > 0) {
    outputRows.unshift(["key", "value"]);
  }

  let foundIndex = -1;
  for (let i = startIndex; i < outputRows.length; i += 1) {
    if (String(outputRows[i][0] || "").trim() === key) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex >= 0) {
    outputRows[foundIndex] = [key, value ?? ""];
  } else {
    outputRows.push([key, value ?? ""]);
  }

  await writeSettingsRows(spreadsheetId, outputRows);
}

/**
 * Remove one setting key from Settings sheet.
 * @param {string} spreadsheetId
 * @param {string} key
 */
async function clearSetting(spreadsheetId, key) {
  if (!key) return;

  const rows = await getValues(spreadsheetId, "Settings!A:B");
  if (!rows.length) return;

  const hasHeader = isSettingsHeaderRow(rows[0]);
  const header = hasHeader ? [rows[0]] : [["key", "value"]];
  const startIndex = hasHeader ? 1 : 0;
  const filtered = rows
    .slice(startIndex)
    .filter((row) => String(row[0] || "").trim() !== key);

  const outputRows = [...header, ...filtered];
  await writeSettingsRows(spreadsheetId, outputRows);
}

module.exports = {
  getSheetsClient,
  getValues,
  clearRange,
  appendValues,
  updateValues,
  appendLog,
  appendFeedback,
  getSetting,
  setSetting,
  clearSetting,
};
