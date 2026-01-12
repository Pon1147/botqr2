// src/services/categoriesService.js
const { google } = require("googleapis");

let categoriesData = []; // Cache danh mục

/**
 * Load tất cả danh mục active từ sheet Categories
 * @param {Object} config - config chứa SHEETS_ID, getValues
 * @returns {Promise<Array<{id: string, label: string, value: string, price: number, desc: string, imageUrl?: string}>>}
 */
async function loadCategories(config) {
  const { SHEETS_ID, getValues } = config;

  try {
    const range = "Categories!A:G"; // Điều chỉnh nếu cột khác
    const values = await getValues(SHEETS_ID, range);

    if (!values || values.length <= 1) {
      console.warn(
        "[categoriesService] Không tìm thấy dữ liệu trong sheet Categories"
      );
      return [];
    }

    // Bỏ header dòng 1
    const categories = values
      .slice(1)
      .map((row) => {
        const [id, label, value, priceStr, desc, imageUrl, active] = row;

        // Chỉ lấy danh mục active (TRUE hoặc không rỗng)
        if (active !== "TRUE" && active !== true) return null;

        return {
          id: id || "",
          label: label?.trim() || "Unknown",
          value: value?.trim() || `cat_${Date.now()}`,
          price: Number(priceStr) || 0,
          desc: desc?.trim() || "",
          imageUrl: imageUrl?.trim() || "",
        };
      })
      .filter(Boolean); // Lọc bỏ null

    categoriesData = categories; // Update cache
    console.log(
      `[categoriesService] Loaded ${categories.length} active categories`
    );

    return categories;
  } catch (error) {
    console.error("[categoriesService] Lỗi load categories:", error.message);
    return categoriesData; // Trả cache cũ nếu lỗi
  }
}

/**
 * Lấy danh mục từ cache (nếu chưa load thì load lại)
 */
async function getCategories(config) {
  if (categoriesData.length === 0) {
    await loadCategories(config);
  }
  return categoriesData;
}

/**
 * Reload categories (dùng khi admin thêm/sửa sheet thủ công)
 */
async function reloadCategories(config) {
  return await loadCategories(config);
}

module.exports = {
  loadCategories,
  getCategories,
  reloadCategories,
};
