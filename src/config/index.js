// src/config/index.js
// Tập trung tất cả cấu hình runtime.

const path = require("path");

// Các biến môi trường bắt buộc (validate ở bootstrap).
const requiredEnv = ["TOKEN", "GUILD_ID", "GOOGLE_SHEETS_ID"];

/**
 * @type {{
 *   TOKEN: string;
 *   GUILD_ID: string;
 *   ADMIN_ROLES: string[];
 *   SHEETS_ID: string;
 *   SERVICE_ACCOUNT_PATH: string;
 *   PREFIX: string;
 *   DEFAULT_COLOR: number;
 *   EMBED_FOOTER_TEXT: string;
 *   PORT: number;
 *   FEEDBACK_CHANNEL_ID: string;
 *   CAPITAL_SHEET_RANGE: string;
 *   QR_DATA_SHEET_RANGE: string;
 *   PAYMENTS_SHEET_RANGE: string;
 * }}
 */
const config = {
  // Discord related
  TOKEN: process.env.TOKEN,
  GUILD_ID: process.env.GUILD_ID,
  ADMIN_ROLES: process.env.ADMIN_ROLES
    ? process.env.ADMIN_ROLES.split(",").map((role) => role.trim())
    : ["Admin"],

  // Google Sheets related
  SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
  SERVICE_ACCOUNT_PATH: path.join(
    __dirname,
    "..",
    "..",
    "service-account-key.json"
  ),

  // Bot general settings
  PREFIX: process.env.PREFIX || "!",
  DEFAULT_COLOR: 0xe0f7fa,
  EMBED_FOOTER_TEXT:
    "Vui lòng kiểm tra thật kỹ khi chuyển khoản và gửi bill sau khi thanh toán thành công",
  PORT: Number(process.env.PORT) || 3000,
  FEEDBACK_CHANNEL_ID: process.env.FEEDBACK_CHANNEL_ID || "",

  // Sheet ranges
  CAPITAL_SHEET_RANGE: "Capital!A:B",
  QR_DATA_SHEET_RANGE: "QR_Data!A:F",
  PAYMENTS_SHEET_RANGE: "Payments!A:H",
};

module.exports = config;
module.exports.requiredEnv = requiredEnv;
