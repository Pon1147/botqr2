// src/config/index.js
// Tập trung tất cả configuration, env variables và constants của bot

const path = require("path");

// Các biến môi trường bắt buộc (kiểm tra sẽ được thực hiện ở entry point chính)
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
  DEFAULT_COLOR: 0xe0f7fa, // Màu cyan nhạt mặc định cho embed QR
  EMBED_FOOTER_TEXT:
    "Vui lòng kiểm tra thật kỹ khi chuyển khoản và gửi bill sau khi thanh toán thành công",
  PORT: Number(process.env.PORT) || 3000,

  // Sheet ranges (dùng trong các service để truy vấn)
  CAPITAL_SHEET_RANGE: "Capital!A:B",
  QR_DATA_SHEET_RANGE: "QR_Data!A:F", // Điều chỉnh nếu cấu trúc sheet khác
  PAYMENTS_SHEET_RANGE: "Payments!A:H",
};

// Export config
module.exports = config;

// Export thêm requiredEnv để entry point có thể check
module.exports.requiredEnv = requiredEnv;
