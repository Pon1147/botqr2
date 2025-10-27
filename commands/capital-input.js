const {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("capital-input")
    .setDescription("Quản lý tiền vốn và xem lợi nhuận (admin only)")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Hành động: thêm vốn hoặc xem lợi nhuận")
        .setRequired(true)
        .addChoices(
          { name: "Thêm vốn", value: "add" },
          { name: "Xem lợi nhuận", value: "show" }
        )
    ),
  adminOnly: true,
  async execute(
    interaction,
    userQrData,
    paymentsData,
    saveQrData,
    savePaymentsData,
    logMessage,
    QRCode,
    AttachmentBuilder,
    createQrEmbed,
    createEditButtons,
    getSortedPayments,
    loadCapitalFromSheet,
    saveCapitalToSheet,
    capitalData
  ) {
    const action = interaction.options.getString("action");

    // Tính tổng tiền confirmed
    const totalConfirmed = paymentsData
      .filter((tx) => tx.status === "confirmed")
      .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

    const realReceived = totalConfirmed - capitalData; // Lợi nhuận = confirmed - vốn

    if (action === "show") {
      const embed = new EmbedBuilder()
        .setTitle("💰 Báo cáo tài chính")
        .addFields(
          {
            name: "Tiền vốn hiện tại",
            value: `${capitalData.toLocaleString()} VNĐ`,
            inline: true,
          },
          {
            name: "Tổng tiền confirmed",
            value: `${totalConfirmed.toLocaleString()} VNĐ`,
            inline: true,
          },
          {
            name: "Lợi nhuận",
            value: `${realReceived.toLocaleString()} VNĐ`,
            inline: true,
          }
        )
        .setColor(realReceived >= 0 ? "Green" : "Red")
        .setTimestamp();

      await logMessage(
        "INFO",
        `[capital-input] Admin ${
          interaction.user.tag
        } xem lợi nhuận: ${realReceived.toLocaleString()} VNĐ`
      );
      return interaction.reply({ embeds: [embed], ephemeral: false });
    }

    if (action === "add") {
      const modal = new ModalBuilder()
        .setCustomId(`capital_modal_${interaction.user.id}`)
        .setTitle("Thêm tiền vốn");

      const input = new TextInputBuilder()
        .setCustomId("capital_amount")
        .setLabel("Số tiền thêm (VNĐ)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ví dụ: 500000")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);

      // Xử lý modal submit
      const filter = (i) =>
        i.customId === `capital_modal_${interaction.user.id}` &&
        i.user.id === interaction.user.id;
      const modalSubmit = await interaction.awaitModalSubmit({
        filter,
        time: 300000,
      });

      if (modalSubmit) {
        const amountInput =
          modalSubmit.fields.getTextInputValue("capital_amount");
        const addAmount = parseFloat(amountInput.replace(/[^\d]/g, "")) || 0;

        if (addAmount <= 0) {
          return modalSubmit.reply({
            content: "Số tiền thêm không hợp lệ!",
            flags: MessageFlags.Ephemeral,
          });
        }

        const newCapital = capitalData + addAmount;
        await saveCapitalToSheet(newCapital);

        const newRealReceived = totalConfirmed - newCapital;

        const embed = new EmbedBuilder()
          .setTitle("💰 Báo cáo tài chính (sau khi thêm vốn)")
          .addFields(
            {
              name: "Tiền vốn mới",
              value: `${newCapital.toLocaleString()} VNĐ`,
              inline: true,
            },
            {
              name: "Tổng tiền confirmed",
              value: `${totalConfirmed.toLocaleString()} VNĐ`,
              inline: true,
            },
            {
              name: "Lợi nhuận",
              value: `${newRealReceived.toLocaleString()} VNĐ`,
              inline: true,
            }
          )
          .setColor(newRealReceived >= 0 ? "Green" : "Red")
          .setTimestamp();

        await logMessage(
          "INFO",
          `[capital-input] Admin ${
            interaction.user.tag
          } thêm vốn ${addAmount.toLocaleString()} VNĐ, vốn mới: ${newCapital.toLocaleString()} VNĐ, lợi nhuận: ${newRealReceived.toLocaleString()} VNĐ`
        );
        await modalSubmit.reply({ embeds: [embed], ephemeral: false });
      }
    }
  },
};
