// src/events/interactionCreate.js
const { Events, EmbedBuilder, MessageFlags } = require("discord.js");

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
      getCapitalData,
      loadCapitalFromSheet,
      saveCapitalToSheet,
      SHEETS_ID,
      ADMIN_ROLES,
    } = config;

    const isAdmin = () =>
      interaction.member?.permissions.has("Administrator") ||
      ADMIN_ROLES.some((roleName) =>
        interaction.member?.roles.cache.some((r) => r.name === roleName)
      );

    // Slash commands
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

        const shouldAutoDefer = command.autoDefer !== false;
        if (shouldAutoDefer) {
          const shouldBeEphemeral = command.ephemeral ?? false;
          const deferOptions = shouldBeEphemeral
            ? { flags: MessageFlags.Ephemeral }
            : {};

          try {
            await interaction.deferReply(deferOptions);
          } catch (deferError) {
            const code = deferError?.code ?? deferError?.rawError?.code;
            if (
              code === 40060 ||
              /already been acknowledged/i.test(String(deferError?.message || ""))
            ) {
              // Interaction was already acknowledged by another live bot instance.
              return;
            }
            throw deferError;
          }
        }
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

    // Buttons
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
                createEditModal(`modal_url_${userId}`, "Sửa URL/QR", qrObj.url || "")
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

    // Modal submit
    if (interaction.isModalSubmit()) {
      try {
        // Capital modal
        if (interaction.customId.startsWith("capital_modal_")) {
          await interaction.deferUpdate();

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
              }
            )
            .setColor(profit >= 0 ? "Green" : "Red")
            .setTimestamp();

          await logger.info(
            `[capital] ${interaction.user.tag} thêm ${addAmount.toLocaleString()} VND -> vốn mới: ${savedCapital.toLocaleString()} VND`,
            SHEETS_ID
          );

          await interaction.followUp({ embeds: [embed], ephemeral: false });
          return;
        }

        // QR edit modal
        const { action: modalType, userId } = parseCustomId(interaction.customId);
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
