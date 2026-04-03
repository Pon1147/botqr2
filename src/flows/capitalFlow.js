const {
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

function isCapitalModal(customId) {
  return customId.startsWith("capital_modal_");
}

async function handleCapitalModal(interaction, config) {
  const {
    paymentService,
    logger,
    getCapitalData,
    loadCapitalFromSheet,
    saveCapitalToSheet,
    SHEETS_ID,
  } = config;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const amountInput = interaction.fields.getTextInputValue("capital_amount");
  const addAmount = Number.parseFloat(amountInput.replace(/[^\d]/g, "")) || 0;

  if (addAmount <= 0) {
    return interaction.followUp({
      content: "Số tiền thêm không hợp lệ!",
      ephemeral: true,
    });
  }

  try {
    await Promise.all([
      loadCapitalFromSheet(config),
      paymentService.loadPaymentsFromSheet(SHEETS_ID),
    ]);
  } catch (syncError) {
    return interaction.followUp({
      content: `Không thể đồng bộ dữ liệu mới nhất: ${syncError.message}`,
      ephemeral: true,
    });
  }

  const currentCapital = getCapitalData();
  const newCapital = currentCapital + addAmount;

  let savedCapital;
  try {
    savedCapital = await saveCapitalToSheet(newCapital, config);
  } catch (saveError) {
    return interaction.followUp({
      content: `Không thể lưu vốn: ${saveError.message}`,
      ephemeral: true,
    });
  }

  const totalConfirmed = paymentService.getTotalConfirmed();
  const profit = totalConfirmed - savedCapital;

  const embed = new EmbedBuilder()
    .setTitle("Báo cáo tài chính (sau thêm vốn)")
    .addFields(
      {
        name: "Vốn mới",
        value: `${savedCapital.toLocaleString()} VND`,
        inline: true,
      },
      {
        name: "Tổng confirmed",
        value: `${totalConfirmed.toLocaleString()} VND`,
        inline: true,
      },
      {
        name: "Lợi nhuận",
        value: `${profit.toLocaleString()} VND`,
        inline: true,
      },
    )
    .setColor(profit >= 0 ? "Green" : "Red")
    .setTimestamp();

  await logger.info(
    `[capital] ${interaction.user.tag} thêm ${addAmount.toLocaleString()} VND -> vốn mới: ${savedCapital.toLocaleString()} VND`,
    SHEETS_ID,
  );

  await interaction.followUp({ embeds: [embed], ephemeral: false });
}

module.exports = {
  handleCapitalModal,
  isCapitalModal,
};
