// src/events/interactionCreate.js
const {
  Events,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const FEEDBACK_SESSION_TTL_MS = 15 * 60 * 1000;
const FEEDBACK_RATE_LIMIT_MS = 1500;

const feedbackSessions = new Map();
const submittedFeedback = new Set();
const feedbackRateLimit = new Map();

function cleanupFeedbackSessions() {
  const now = Date.now();
  for (const [sessionId, session] of feedbackSessions.entries()) {
    if (session.expiresAt <= now) {
      feedbackSessions.delete(sessionId);
    }
  }
}

function createSessionId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseFeedbackRateId(customId) {
  const match = customId.match(/^feedback_rate_([1-5])_([A-Za-z0-9]+)_(\d{15,20})$/);
  if (!match) return null;

  return {
    rating: Number.parseInt(match[1], 10),
    txId: match[2],
    buyerId: match[3],
  };
}

function createFeedbackModal(sessionId, rating) {
  const modal = new ModalBuilder()
    .setCustomId(`feedback_modal_${sessionId}`)
    .setTitle(`Feedback ${rating} sao`);

  const commentInput = new TextInputBuilder()
    .setCustomId("feedback_comment")
    .setLabel("Đánh giá quy trình mua hàng")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Hãy chia sẻ trải nghiệm của bạn...")
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(commentInput));

  return modal;
}

async function resolveFeedbackChannelId(config) {
  if (config.FEEDBACK_CHANNEL_ID) return config.FEEDBACK_CHANNEL_ID;

  if (typeof config.getSetting !== "function") return "";

  const channelId = await config.getSetting(config.SHEETS_ID, "FEEDBACK_CHANNEL_ID");
  if (channelId) {
    config.FEEDBACK_CHANNEL_ID = channelId;
    return channelId;
  }

  return "";
}

async function disableFeedbackSourceButton(
  client,
  session,
  txId,
  buyerId,
  selectedRating
) {
  if (!session.sourceChannelId || !session.sourceMessageId) return;

  const channel =
    client.channels.cache.get(session.sourceChannelId) ||
    (await client.channels.fetch(session.sourceChannelId).catch(() => null));

  if (!channel?.messages?.fetch) return;

  const sourceMessage = await channel.messages
    .fetch(session.sourceMessageId)
    .catch(() => null);

  if (!sourceMessage) return;

  const disabledRow = new ActionRowBuilder();
  for (let rating = 1; rating <= 5; rating += 1) {
    disabledRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`feedback_done_${rating}_${txId}_${buyerId}`)
        .setLabel(`${rating} sao`)
        .setStyle(rating === selectedRating ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(true)
    );
  }

  await sourceMessage.edit({ components: [disabledRow] }).catch(() => {});
}

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
      createFeedbackThanksEmbed,
      createFeedbackPublicEmbed,
      appendFeedback,
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
        // Feedback button flow
        if (interaction.customId.startsWith("feedback_rate_")) {
          cleanupFeedbackSessions();

          const now = Date.now();
          const lastTapAt = feedbackRateLimit.get(interaction.user.id) || 0;
          if (now - lastTapAt < FEEDBACK_RATE_LIMIT_MS) {
            return interaction.reply({
              content: "Bạn thao tác quá nhanh, vui lòng thử lại sau 1-2 giây.",
              flags: MessageFlags.Ephemeral,
            });
          }
          feedbackRateLimit.set(interaction.user.id, now);

          const parsed = parseFeedbackRateId(interaction.customId);
          if (!parsed) {
            return interaction.reply({
              content: "Nút feedback không hợp lệ.",
              flags: MessageFlags.Ephemeral,
            });
          }

          if (interaction.user.id !== parsed.buyerId) {
            return interaction.reply({
              content: "Chỉ buyer của đơn hàng mới được đánh giá.",
              flags: MessageFlags.Ephemeral,
            });
          }

          const tx = paymentService.getPaymentById(parsed.txId);
          if (!tx || tx.status !== "confirmed") {
            return interaction.reply({
              content: "Đơn hàng không tồn tại hoặc chưa ở trạng thái đã xác nhận.",
              flags: MessageFlags.Ephemeral,
            });
          }

          if (tx.buyerId !== parsed.buyerId) {
            return interaction.reply({
              content: "Thông tin đơn hàng không hợp lệ.",
              flags: MessageFlags.Ephemeral,
            });
          }

          const dedupeKey = `${parsed.txId}:${parsed.buyerId}`;
          if (submittedFeedback.has(dedupeKey)) {
            return interaction.reply({
              content: "Bạn đã gửi feedback cho đơn này rồi.",
              flags: MessageFlags.Ephemeral,
            });
          }

          const sessionId = createSessionId();
          feedbackSessions.set(sessionId, {
            rating: parsed.rating,
            txId: parsed.txId,
            buyerId: parsed.buyerId,
            username:
              interaction.user.globalName || interaction.user.username || interaction.user.tag,
            orderItems: tx.description || "N/A",
            sourceChannelId: interaction.channelId || interaction.channel?.id || null,
            sourceMessageId: interaction.message?.id || null,
            expiresAt: now + FEEDBACK_SESSION_TTL_MS,
          });

          await logger.info(
            `[feedback] Mở modal feedback cho TX ${parsed.txId} với ${parsed.rating} sao bởi ${interaction.user.tag}`,
            SHEETS_ID
          );

          const modal = createFeedbackModal(sessionId, parsed.rating);
          await interaction.showModal(modal);
          return;
        }

        // Existing QR edit buttons
        if (
          !interaction.customId.startsWith("edit_") &&
          !interaction.customId.startsWith("reset_")
        ) {
          return;
        }

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
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      return;
    }

    // Modal submit
    if (interaction.isModalSubmit()) {
      try {
        // Feedback modal
        if (interaction.customId.startsWith("feedback_modal_")) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          cleanupFeedbackSessions();

          const sessionId = interaction.customId.replace("feedback_modal_", "");
          const session = feedbackSessions.get(sessionId);

          if (!session) {
            return interaction.editReply({
              content: "Phiên feedback đã hết hạn. Vui lòng bấm nút feedback lại.",
            });
          }

          if (Date.now() > session.expiresAt) {
            feedbackSessions.delete(sessionId);
            return interaction.editReply({
              content: "Phiên feedback đã hết hạn (quá 15 phút). Vui lòng mở lại.",
            });
          }

          if (session.buyerId !== interaction.user.id) {
            return interaction.editReply({
              content: "Bạn không được phép gửi feedback cho đơn này.",
            });
          }

          const dedupeKey = `${session.txId}:${session.buyerId}`;
          if (submittedFeedback.has(dedupeKey)) {
            feedbackSessions.delete(sessionId);
            return interaction.editReply({
              content: "Bạn đã gửi feedback cho đơn này rồi.",
            });
          }

          const rating = Number.parseInt(session.rating, 10);
          if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            feedbackSessions.delete(sessionId);
            return interaction.editReply({
              content: "Phiên feedback không hợp lệ. Vui lòng bấm sao lại.",
            });
          }

          const comment = interaction.fields
            .getTextInputValue("feedback_comment")
            ?.trim();
          if (!comment) {
            return interaction.editReply({
              content: "Nhận xét không được để trống.",
            });
          }

          const category = "purchase_flow";

          const tx = paymentService.getPaymentById(session.txId);
          if (!tx || tx.status !== "confirmed") {
            feedbackSessions.delete(sessionId);
            return interaction.editReply({
              content: "Đơn hàng không còn hợp lệ để gửi feedback.",
            });
          }

          const username =
            interaction.user.globalName || interaction.user.username || interaction.user.tag;
          const orderItems = tx.description || session.orderItems || "N/A";

          await appendFeedback(SHEETS_ID, {
            timestamp: new Date().toISOString(),
            userId: interaction.user.id,
            username,
            txId: tx.id,
            orderItems,
            rating,
            category,
            comment,
          });

          submittedFeedback.add(dedupeKey);
          feedbackSessions.delete(sessionId);

          await disableFeedbackSourceButton(
            interaction.client,
            session,
            tx.id,
            tx.buyerId,
            rating
          );

          const thanksEmbed =
            typeof createFeedbackThanksEmbed === "function"
              ? createFeedbackThanksEmbed(username)
              : new EmbedBuilder()
                  .setColor("Green")
                  .setDescription(`Cảm ơn ${username}! Đánh giá của bạn đã được ghi nhận.`)
                  .setTimestamp();

          await interaction.followUp({ embeds: [thanksEmbed] });
          await interaction.deleteReply().catch(() => {});

          const feedbackChannelId = await resolveFeedbackChannelId(config);
          if (feedbackChannelId) {
            const feedbackChannel =
              interaction.client.channels.cache.get(feedbackChannelId) ||
              (await interaction.client.channels.fetch(feedbackChannelId).catch(() => null));

            if (feedbackChannel?.isTextBased?.()) {
              const publicEmbed =
                typeof createFeedbackPublicEmbed === "function"
                  ? createFeedbackPublicEmbed({
                      username,
                      rating,
                      comment,
                      orderItems,
                      txId: tx.id,
                    })
                  : new EmbedBuilder()
                      .setColor("Blue")
                      .setTitle("Đánh giá mới")
                      .setDescription(`${username}: ${rating}/5\n${comment}`)
                      .setTimestamp();

              await feedbackChannel.send({
                content: `Feedback của <@${interaction.user.id}>`,
                embeds: [publicEmbed],
              });
            } else {
              await logger.warn(
                `[feedback] Kênh feedback không hợp lệ hoặc không hỗ trợ text: ${feedbackChannelId}`,
                SHEETS_ID
              );
            }
          } else {
            await logger.warn(
              "[feedback] FEEDBACK_CHANNEL_ID chưa được cấu hình",
              SHEETS_ID
            );
          }

          await logger.info(
            `[feedback] Đã lưu feedback cho TX ${tx.id} by ${interaction.user.tag} (${rating}/5)`,
            SHEETS_ID
          );

          return;
        }

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
              new URL(value.startsWith("http") ? value : `http://${value}`);
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
