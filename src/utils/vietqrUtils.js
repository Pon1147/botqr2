const QRCode = require("qrcode");

function normalizeVietQrText(value, { uppercase = false } = {}) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Za-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return uppercase ? text.toUpperCase() : text;
}

function buildVietQrImageUrl({
  bankCode,
  accountNumber,
  accountName = "",
  amount = 0,
  addInfo = "",
  template = "compact2",
}) {
  const safeBankCode = String(bankCode || "").trim();
  const safeAccountNumber = String(accountNumber || "").trim();
  if (!safeBankCode || !safeAccountNumber) return null;

  const safeAmount = Number(amount) || 0;
  const safeAddInfo = encodeURIComponent(String(addInfo || "").trim());
  const safeAccountName = encodeURIComponent(String(accountName || "").trim());

  return `https://img.vietqr.io/image/${encodeURIComponent(safeBankCode)}-${encodeURIComponent(safeAccountNumber)}-${template}.png?amount=${safeAmount}&addInfo=${safeAddInfo}&accountName=${safeAccountName}`;
}

async function fetchImageBuffer(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch QR image: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generateVietQrBuffer({
  bankCode,
  accountNumber,
  accountName,
  amount,
  addInfo,
  template = "compact2",
}) {
  const payload = {
    accountNo: String(accountNumber || "").trim(),
    accountName: normalizeVietQrText(accountName, { uppercase: true }),
    acqId: Number(bankCode),
    amount: Number(amount) || 0,
    addInfo: normalizeVietQrText(addInfo),
    format: "text",
    template,
  };

  const response = await fetch("https://api.vietqr.io/v2/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`VietQR generate failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data?.code !== "00" || !data?.data?.qrCode) {
    throw new Error(data?.desc || "VietQR generate returned invalid payload");
  }

  return QRCode.toBuffer(data.data.qrCode, {
    width: 320,
    margin: 1,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

module.exports = {
  generateVietQrBuffer,
  buildVietQrImageUrl,
  fetchImageBuffer,
  normalizeVietQrText,
};
