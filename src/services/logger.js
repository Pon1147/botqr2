// src/services/logger.js
const fs = require("fs").promises;
const path = require("path");
const { appendLog } = require("./googleSheets"); // import từ service vừa tạo

const LOGS_DIR = path.join(__dirname, "../../logs");

// Đảm bảo thư mục logs tồn tại
async function ensureLogDir() {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  } catch (err) {
    console.error("[Logger] Failed to create logs directory:", err.message);
  }
}

/**
 * Lấy đường dẫn file log theo ngày hiện tại (Asia/Ho_Chi_Minh)
 * @returns {Promise<string>} Đường dẫn file log
 */
async function getLogFilePath() {
  await ensureLogDir();
  const now = new Date();
  // Format YYYY-MM-DD theo múi giờ Việt Nam
  const dateStr = now.toLocaleDateString("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  return path.join(LOGS_DIR, `${dateStr}.log`);
}

/**
 * Format timestamp theo kiểu Việt Nam (ngày/tháng/năm giờ:phút:giây)
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Ghi log với level và message
 * - Ghi vào file hệ thống
 * - Đồng bộ lên Google Sheet (nếu có spreadsheetId)
 * - In ra console
 *
 * @param {string} level - INFO | WARN | ERROR | DEBUG
 * @param {string} message
 * @param {string} [spreadsheetId] - Nếu cung cấp thì sync lên sheet Logs
 */
async function log(level, message, spreadsheetId = null) {
  const timestamp = getTimestamp();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;

  // In ra console (luôn luôn)
  console.log(logEntry.trim());

  // Ghi vào file log
  try {
    const logFile = await getLogFilePath();
    await fs.appendFile(logFile, logEntry);
  } catch (err) {
    console.error("[Logger] Failed to write to log file:", err.message);
  }

  // Sync lên Google Sheet nếu có spreadsheetId
  if (spreadsheetId) {
    try {
      await appendLog(spreadsheetId, level, message);
    } catch (err) {
      console.error(
        "[Logger] Failed to sync log to Google Sheets:",
        err.message
      );
    }
  }
}

// Helper functions cho các level phổ biến
async function info(message, spreadsheetId) {
  await log("INFO", message, spreadsheetId);
}

async function warn(message, spreadsheetId) {
  await log("WARN", message, spreadsheetId);
}

async function error(message, spreadsheetId) {
  await log("ERROR", message, spreadsheetId);
}

async function debug(message, spreadsheetId) {
  // Chỉ ghi debug nếu bật DEBUG mode (có thể dùng env sau này)
  if (process.env.DEBUG === "true") {
    await log("DEBUG", message, spreadsheetId);
  }
}

module.exports = {
  log,
  info,
  warn,
  error,
  debug,
  // Để tương thích với code cũ nếu cần
  logMessage: log, // alias cho code cũ
};
