const {
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const path = require("path");

const FEEDBACK_SESSION_TTL_MS = 15 * 60 * 1000;
const FEEDBACK_RATE_LIMIT_MS = 1500;
const FEEDBACK_PUBLIC_THANKS_MESSAGE =
  "Cảm ơn tình iu đã ủng hộ Yên. Nếu hông có gì nữa thì Yên xin phép đóng ticket này, có gì cần hỗ trợ có thể ib riêng em Yên hoặc tạo ticket mới nhennnnn ❤️";

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

function isFeedbackRateButton(customId) {
  return customId.startsWith("feedback_rate_");
}

function isFeedbackModal(customId) {
  return customId.startsWith("feedback_modal_");
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

async function resolveTextChannel(client, channelId) {
  if (!channelId) return null;

  return (
    client.channels.cache.get(channelId) ||
    (await client.channels.fetch(channelId).catch(() => null))
  );
}

function buildFeedbackPublicContent(userId) {
  return `Feedback của <@${userId}>`;
}

async function sendChannelMessage(channel, payload, logger, sheetsId, errorContext) {
  try {
    await channel.send(payload);
    return true;
  } catch (error) {
    await logger.warn(
      `[feedback] ${errorContext}: ${error.message}`,
      sheetsId,
    );
    return false;
  }
}

async function disableFeedbackSourceButton(
  client,
  session,
  txId,
  buyerId,
  selectedRating,
) {
  if (!session.sourceChannelId || !session.sourceMessageId) return;

  const channel = await resolveTextChannel(client, session.sourceChannelId);

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
        .setDisabled(true),
    );
  }

  await sourceMessage.edit({ components: [disabledRow] }).catch(() => {});
}

async function handleFeedbackRateButton(interaction, config) {
  const { logger, paymentService, SHEETS_ID } = config;

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
    SHEETS_ID,
  );

  const modal = createFeedbackModal(sessionId, parsed.rating);
  await interaction.showModal(modal);
}

async function handleFeedbackModal(interaction, config) {
  const {
    logger,
    paymentService,
    createFeedbackThanksEmbed,
    createFeedbackPublicEmbed,
    appendFeedback,
    SHEETS_ID,
  } = config;

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

  const comment = interaction.fields.getTextInputValue("feedback_comment")?.trim();
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
    rating,
  );

  const thanksEmbed =
    typeof createFeedbackThanksEmbed === "function"
      ? createFeedbackThanksEmbed(username, rating)
      : new EmbedBuilder()
          .setColor("Green")
          .setDescription(`Cảm ơn ${username}! Đánh giá của bạn đã được ghi nhận.`)
          .setTimestamp();

  const feedbackChannelId = await resolveFeedbackChannelId(config);
  if (feedbackChannelId) {
    const feedbackChannel = await resolveTextChannel(interaction.client, feedbackChannelId);

    if (feedbackChannel?.isTextBased?.()) {
      const thumbnailPath = path.join(__dirname, "..", "assets", "thubnail_2.webp");
      const thumbnailAttachment = new config.AttachmentBuilder(thumbnailPath, {
        name: "thubnail_2.webp",
      });

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

      const publicFeedbackSent = await sendChannelMessage(
        feedbackChannel,
        {
          content: buildFeedbackPublicContent(interaction.user.id),
          embeds: [publicEmbed],
          files: [thumbnailAttachment],
        },
        logger,
        SHEETS_ID,
        `Không thể gửi feedback vào kênh ${feedbackChannelId}`,
      );

      if (publicFeedbackSent) {
        await sendChannelMessage(
          feedbackChannel,
          {
            content: FEEDBACK_PUBLIC_THANKS_MESSAGE,
          },
          logger,
          SHEETS_ID,
          `Không thể gửi lời cảm ơn feedback vào kênh ${feedbackChannelId}`,
        );
      }
    } else {
      await logger.warn(
        `[feedback] Kênh feedback không hợp lệ hoặc không hỗ trợ text: ${feedbackChannelId}`,
        SHEETS_ID,
      );
    }
  } else {
    await logger.warn("[feedback] FEEDBACK_CHANNEL_ID chưa được cấu hình", SHEETS_ID);
  }

  await interaction.deleteReply().catch(() => {});

  await logger.info(
    `[feedback] Đã lưu feedback cho TX ${tx.id} by ${interaction.user.tag} (${rating}/5)`,
    SHEETS_ID,
  );
}

module.exports = {
  handleFeedbackModal,
  handleFeedbackRateButton,
  isFeedbackModal,
  isFeedbackRateButton,
};
