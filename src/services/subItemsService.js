let subItemsData = [];

async function loadSubItems(config) {
  const { SHEETS_ID, getValues } = config;

  try {
    const range = "SubItems!A:F";
    const values = await getValues(SHEETS_ID, range);

    if (!values || values.length <= 1) {
      console.warn("[subItemsService] Không có dữ liệu trong sheet SubItems");
      return [];
    }

    const subItems = values
      .slice(1)
      .map((row) => {
        const [
          categoryValue,
          subName,
          subPriceStr,
          subDesc,
          active,
          groupEmoji,
        ] = row;

        if (active !== "TRUE" && active !== true) return null;

        return {
          categoryValue: categoryValue?.trim().toLowerCase() || "",
          subName: subName?.trim() || "Unknown",
          subPrice: subPriceStr?.trim() || "Inbox",
          subDesc: subDesc?.trim() || "",
          groupEmoji: groupEmoji?.trim() || "",
        };
      })
      .filter(Boolean);

    subItemsData = subItems;
    console.log(`[subItemsService] Loaded ${subItems.length} active sub-items`);

    return subItems;
  } catch (error) {
    console.error("[subItemsService] Lỗi load sub-items:", error.message);
    return subItemsData;
  }
}

async function getSubItemsByCategory(config, categoryValue) {
  if (subItemsData.length === 0) await loadSubItems(config);

  const normalizedCatValue = categoryValue
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  return subItemsData.filter((item) => {
    const normalizedItem = item.categoryValue
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    return normalizedItem === normalizedCatValue;
  });
}

async function reloadSubItems(config) {
  return await loadSubItems(config);
}

module.exports = {
  loadSubItems,
  getSubItemsByCategory,
  reloadSubItems,
};
