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

module.exports = {
  getSheetsClient,
  getValues,
  clearRange,
  appendValues,
  updateValues,
  appendLog,
};
