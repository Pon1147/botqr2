const BANK_LIST_URL = "https://api.vietqr.io/v2/banks";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cachedBanks = [];
let cachedAt = 0;

function normalizeBank(bank) {
  return {
    id: bank.id,
    name: String(bank.name || "").trim(),
    shortName: String(bank.shortName || bank.code || bank.name || "").trim(),
    code: String(bank.code || "").trim(),
    bin: String(bank.bin || "").trim(),
    logo: String(bank.logo || "").trim(),
    transferSupported: Number(bank.transferSupported || 0),
    lookupSupported: Number(bank.lookupSupported || 0),
  };
}

async function fetchBankList(fetchImpl = global.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available for VietQR bank list");
  }

  const response = await fetchImpl(BANK_LIST_URL);
  if (!response.ok) {
    throw new Error(`Failed to load VietQR bank list: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data?.code !== "00" || !Array.isArray(data?.data)) {
    throw new Error(data?.desc || "Invalid VietQR bank list response");
  }

  return data.data.map(normalizeBank).filter((bank) => bank.bin);
}

async function getBankList({ forceRefresh = false, fetchImpl = global.fetch, logger, sheetsId } = {}) {
  const cacheValid = cachedBanks.length > 0 && Date.now() - cachedAt < CACHE_TTL_MS;
  if (!forceRefresh && cacheValid) {
    return cachedBanks;
  }

  try {
    cachedBanks = await fetchBankList(fetchImpl);
    cachedAt = Date.now();
    if (logger?.info) {
      await logger.info(`Loaded VietQR bank list: ${cachedBanks.length} banks`, sheetsId);
    }
  } catch (error) {
    if (logger?.warn) {
      await logger.warn(`Failed to load VietQR bank list: ${error.message}`, sheetsId);
    }
    if (cachedBanks.length === 0) {
      throw error;
    }
  }

  return cachedBanks;
}

function clearBankCache() {
  cachedBanks = [];
  cachedAt = 0;
}

module.exports = {
  clearBankCache,
  fetchBankList,
  getBankList,
  normalizeBank,
};
