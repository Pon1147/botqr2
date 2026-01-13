const { google } = require("googleapis");

let categoriesData = []; // Cache danh mục

async function loadCategories(config) {
  const { SHEETS_ID, getValues } = config;

  try {
    const range = "Categories!A:F"; // Chỉ còn 6 cột: ID, Label, Value, Desc, ImageURL, Active
    const values = await getValues(SHEETS_ID, range);

    if (!values || values.length <= 1) {
      console.warn("[categoriesService] Không tìm thấy dữ liệu trong sheet Categories");
      return [];
    }

    const categories = values
      .slice(1)
      .map((row) => {
        const [id, label, value, desc, imageUrl, active] = row;

        if (active !== "TRUE" && active !== true) return null;

        return {
          id: id?.trim() || "",
          label: label?.trim() || "Unknown",
          value: value?.trim() || `cat_${Date.now()}`,
          desc: desc?.trim() || "",
          imageUrl: imageUrl?.trim() || "",
        };
      })
      .filter(Boolean);

    categoriesData = categories;
    console.log(`[categoriesService] Loaded ${categories.length} active categories`);

    return categories;
  } catch (error) {
    console.error("[categoriesService] Lỗi load categories:", error.message);
    return categoriesData;
  }
}

async function getCategories(config, forceReload = false) {
  if (forceReload || categoriesData.length === 0) {
    await loadCategories(config);
  }
  return categoriesData;
}

async function reloadCategories(config) {
  return await loadCategories(config);
}

module.exports = {
  loadCategories,
  getCategories,
  reloadCategories,
};