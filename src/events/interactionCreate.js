// src/events/interactionCreate.js
const { Events } = require("discord.js");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, config) {
    const {
      logger,
      qrDataService,
      paymentService,
      QRCode,
      AttachmentBuilder,
      createQrEmbed,
      createEditButtons,
      createEditModal,
      parseCustomId,
      loadCapitalFromSheet,
      saveCapitalToSheet,
      capitalData,
      SHEETS_ID,
      ADMIN_ROLES,
    } = config;

    // Helper để lấy admin role
    const isAdmin = () =>
      interaction.member?.permissions.has("Administrator") ||
      ADMIN_ROLES.some((roleName) =>
        interaction.member?.roles.cache.some((r) => r.name === roleName)
      );

    // ==================== Slash Commands ====================
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        if (command.adminOnly && !isAdmin()) {
          return interaction.reply({
            content: "Bạn không có quyền admin!",
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: command.ephemeral ?? false });
        await command.execute(interaction, config);
      } catch (error) {
        await logger.error(
          `Lỗi thực thi lệnh ${interaction.commandName}: ${error.message}\nStack: ${error.stack}`,
          SHEETS_ID
        );

        const errorMsg = {
          content: "Có lỗi xảy ra khi thực thi lệnh!",
          ephemeral: true,
        };
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(errorMsg);
          } else {
            await interaction.reply(errorMsg);
          }
        } catch {}
      }
      return;
    }

    // ==================== Buttons ====================
    if (interaction.isButton()) {
      try {
        const { action, userId } = parseCustomId(interaction.customId);

        if (action.startsWith("edit_") || action === "reset") {
          if (interaction.user.id !== userId) {
            return interaction.reply({
              content: "Đây không phải nút của bạn!",
              ephemeral: true,
            });
          }

          const qrObj = qrDataService.getQr(userId);
          if (!qrObj) {
            return interaction.reply({
              content: "Không tìm thấy dữ liệu QR!",
              ephemeral: true,
            });
          }

          await interaction.deferUpdate();

          switch (action) {
            case "edit_bank":
              await interaction.showModal(
                createEditModal(
                  `modal_bank_${userId}`,
                  "Sửa Tên Chủ TK",
                  qrObj.bank || ""
                )
              );
              break;
            case "edit_account":
              await interaction.showModal(
                createEditModal(
                  `modal_account_${userId}`,
                  "Sửa Số Tài Khoản",
                  qrObj.account || ""
                )
              );
              break;
            case "edit_url":
              await interaction.showModal(
                createEditModal(
                  `modal_url_${userId}`,
                  "Sửa URL/QR",
                  qrObj.url || ""
                )
              );
              break;
            case "reset":
              qrDataService.deleteQr(userId);
              await qrDataService.saveQrDataToSheet(SHEETS_ID);
              await interaction.update({
                content: "Đã reset toàn bộ QR!",
                components: [],
              });
              break;
          }
        }
      } catch (error) {
        await logger.error(`Lỗi xử lý button: ${error.message}`, SHEETS_ID);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Lỗi xử lý nút bấm!",
            ephemeral: true,
          });
        }
      }
      return;
    }

    // ==================== Modal Submit ====================
    if (interaction.isModalSubmit()) {
      try {
        // Modal thêm vốn (capital)
        if (interaction.customId.startsWith("capital_modal_")) {
          await interaction.deferUpdate();

          const amountInput =
            interaction.fields.getTextInputValue("capital_amount");
          const addAmount = parseFloat(amountInput.replace(/[^\d]/g, "")) || 0;

          if (addAmount <= 0) {
            return interaction.followUp({
              content: "Số tiền thêm không hợp lệ!",
              ephemeral: true,
            });
          }

          const newCapital = capitalData + addAmount;
          await saveCapitalToSheet(newCapital, config);

          const totalConfirmed = paymentService.getTotalConfirmed();
          const profit = totalConfirmed - newCapital;

          const embed = require("discord.js")
            .EmbedBuilder()
            .setTitle("💰 Báo cáo tài chính (sau thêm vốn)")
            .addFields(
              {
                name: "Vốn mới",
                value: `${newCapital.toLocaleString()} VNĐ`,
                inline: true,
              },
              {
                name: "Tổng confirmed",
                value: `${totalConfirmed.toLocaleString()} VNĐ`,
                inline: true,
              },
              {
                name: "Lợi nhuận",
                value: `${profit.toLocaleString()} VNĐ`,
                inline: true,
              }
            )
            .setColor(profit >= 0 ? "Green" : "Red")
            .setTimestamp();

          await logger.info(
            `[capital] ${
              interaction.user.tag
            } thêm ${addAmount.toLocaleString()} VNĐ → vốn mới: ${newCapital.toLocaleString()} VNĐ`,
            SHEETS_ID
          );

          await interaction.followUp({ embeds: [embed], ephemeral: false });
          return;
        }

        // Modal chỉnh sửa QR
        const { action: modalType, userId } = parseCustomId(
          interaction.customId
        );
        const value = interaction.fields.getTextInputValue("input_value");
        const qrObj = qrDataService.getQr(userId);

        if (!qrObj) {
          return interaction.reply({
            content: "Không tìm thấy dữ liệu QR!",
            ephemeral: true,
          });
        }

        await interaction.deferUpdate();

        let updated = false;
        switch (modalType) {
          case "modal_bank":
            qrObj.bank = value;
            updated = true;
            break;
          case "modal_account":
            qrObj.account = value;
            updated = true;
            break;
          case "modal_url":
            try {
              new URL(value.startsWith("http") ? value : "http://" + value);
              qrObj.url = value;
              updated = true;
            } catch {
              return interaction.followUp({
                content: "URL không hợp lệ!",
                ephemeral: true,
              });
            }
            break;
        }

        if (updated) {
          qrDataService.setQr(userId, qrObj);
          await qrDataService.saveQrDataToSheet(SHEETS_ID);

          const qrBuffer = await QRCode.toBuffer(qrObj.url, {
            width: 256,
            margin: 2,
            color: { dark: "#000000", light: "#FFFFFF" },
          });

          const attachment = new AttachmentBuilder(qrBuffer, {
            name: "my_qr.png",
          });
          const embed = createQrEmbed(qrObj);
          const components = [createEditButtons(userId)];

          await interaction.editReply({
            embeds: [embed],
            files: [attachment],
            components,
          });
        }
      } catch (error) {
        await logger.error(`Lỗi xử lý modal: ${error.message}`, SHEETS_ID);
        try {
          await interaction.followUp({
            content: "Lỗi xử lý modal!",
            ephemeral: true,
          });
        } catch {}
      }
    }
  },
};
