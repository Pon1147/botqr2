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
            content: "Ban khong co quyen admin!",
            ephemeral: true,
          });
        }

        const shouldAutoDefer = command.autoDefer !== false;
        if (shouldAutoDefer) {
          await interaction.deferReply({ ephemeral: command.ephemeral ?? false });
        }
        await command.execute(interaction, config);
      } catch (error) {
        await logger.error(
          `Loi thuc thi lenh ${interaction.commandName}: ${error.message}\nStack: ${error.stack}`,
          SHEETS_ID
        );

        const errorMsg = {
          content: "Co loi xay ra khi thuc thi lenh!",
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
              content: "Day khong phai nut cua ban!",
              ephemeral: true,
            });
          }

          const qrObj = qrDataService.getQr(userId);
          if (!qrObj) {
            return interaction.reply({
              content: "Khong tim thay du lieu QR!",
              ephemeral: true,
            });
          }

          await interaction.deferUpdate();

          switch (action) {
            case "edit_bank":
              await interaction.showModal(
                createEditModal(
                  `modal_bank_${userId}`,
                  "Sua Ten Chu TK",
                  qrObj.bank || ""
                )
              );
              break;
            case "edit_account":
              await interaction.showModal(
                createEditModal(
                  `modal_account_${userId}`,
                  "Sua So Tai Khoan",
                  qrObj.account || ""
                )
              );
              break;
            case "edit_url":
              await interaction.showModal(
                createEditModal(`modal_url_${userId}`, "Sua URL/QR", qrObj.url || "")
              );
              break;
            case "reset":
              qrDataService.deleteQr(userId);
              await qrDataService.saveQrDataToSheet(SHEETS_ID);
              await interaction.update({
                content: "Da reset toan bo QR!",
                components: [],
              });
              break;
          }
        }
      } catch (error) {
        await logger.error(`Loi xu ly button: ${error.message}`, SHEETS_ID);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Loi xu ly nut bam!",
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
              content: "So tien them khong hop le!",
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
              content: `Khong the dong bo du lieu moi nhat: ${syncError.message}`,
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
              content: `Khong the luu von: ${saveError.message}`,
              ephemeral: true,
            });
          }

          const totalConfirmed = paymentService.getTotalConfirmed();
          const profit = totalConfirmed - savedCapital;

          const embed = new EmbedBuilder()
            .setTitle("Bao cao tai chinh (sau them von)")
            .addFields(
              {
                name: "Von moi",
                value: `${savedCapital.toLocaleString()} VND`,
                inline: true,
              },
              {
                name: "Tong confirmed",
                value: `${totalConfirmed.toLocaleString()} VND`,
                inline: true,
              },
              {
                name: "Loi nhuan",
                value: `${profit.toLocaleString()} VND`,
                inline: true,
              }
            )
            .setColor(profit >= 0 ? "Green" : "Red")
            .setTimestamp();

          await logger.info(
            `[capital] ${interaction.user.tag} them ${addAmount.toLocaleString()} VND -> von moi: ${savedCapital.toLocaleString()} VND`,
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
            content: "Khong tim thay du lieu QR!",
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
                content: "URL khong hop le!",
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
        await logger.error(`Loi xu ly modal: ${error.message}`, SHEETS_ID);
        try {
          await interaction.followUp({
            content: "Loi xu ly modal!",
            ephemeral: true,
          });
        } catch {}
      }
    }
  },
};

