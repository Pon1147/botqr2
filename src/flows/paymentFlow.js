const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { isAdmin } = require('../handlers/interactionDispatcher');

const PAYMENT_SESSION_TTL_MS = 15 * 60 * 1000;
const FEEDBACK_STAR_EMOJI = '<:317852starids:1489166513343823943>';
const PAYMENT_PUBLIC_THANKS_MESSAGE =
  'C\u1ea3m \u01a1n t\u00ecnh iu \u0111\u00e3 \u1ee7ng h\u1ed9 Y\u00ean. N\u1ebfu h\u00f4ng c\u00f3 g\u00ec n\u1eefa th\u00ec Y\u00ean xin ph\u00e9p \u0111\u00f3ng ticket n\u00e0y, c\u00f3 g\u00ec c\u1ea7n h\u1ed7 tr\u1ee3 c\u00f3 th\u1ec3 ib ri\u00eang em Y\u00ean ho\u1eb7c t\u1ea1o ticket m\u1edbi nhennnnn \u2764\ufe0f';
const paymentSessions = new Map();

function cleanupPaymentSessions() {
  const now = Date.now();
  for (const [sessionId, session] of paymentSessions.entries()) {
    if (session.expiresAt <= now) {
      paymentSessions.delete(sessionId);
    }
  }
}

function createSessionId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parsePaymentButtonId(customId) {
  const match = customId.match(/^pay_(confirm|cancel)_([A-Za-z0-9]+)_(\d{15,20})$/);
  if (!match) return null;

  return {
    action: match[1],
    txId: match[2],
    buyerId: match[3],
  };
}

function parsePaymentModalId(customId) {
  const match = customId.match(/^pay_modal_(confirm|cancel)_([A-Za-z0-9]+)$/);
  if (!match) return null;

  return {
    action: match[1],
    sessionId: match[2],
  };
}

function isPaymentButton(customId) {
  return /^pay_(confirm|cancel)_([A-Za-z0-9]+)_(\d{15,20})$/.test(customId);
}

function isPaymentModal(customId) {
  return /^pay_modal_(confirm|cancel)_([A-Za-z0-9]+)$/.test(customId);
}

function buildPaymentActionRow(txId, buyerId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pay_confirm_${txId}_${buyerId}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`pay_cancel_${txId}_${buyerId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function buildRatingButtons(txId, buyerId) {
  const row = new ActionRowBuilder();

  for (let rating = 1; rating <= 5; rating += 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`feedback_rate_${rating}_${txId}_${buyerId}`)
        .setLabel(`${FEEDBACK_STAR_EMOJI} ${rating}`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  return row;
}

function createPaymentModal(action, sessionId) {
  const title = action === 'confirm' ? 'Xác nhận thanh toán' : 'Hủy giao dịch';
  const modal = new ModalBuilder().setCustomId(`pay_modal_${action}_${sessionId}`).setTitle(title);

  const reasonInput = new TextInputBuilder()
    .setCustomId('pay_reason')
    .setLabel(action === 'confirm' ? 'Ghi chú xác nhận' : 'Lý do hủy')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(
      action === 'confirm'
        ? 'Nhập ghi chú nếu cần, có thể để trống...'
        : 'Nhập lý do hủy giao dịch...',
    )
    .setRequired(action === 'cancel')
    .setMinLength(action === 'cancel' ? 3 : 0)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function buildPendingPaymentContent({ buyerId, sellerId }) {
  return `<@${buyerId}> <@${sellerId}> Quét QR trên để thanh toán nhé!`;
}

function buildConfirmedPaymentContent({ buyerId }) {
  return `<@${buyerId}> Thanh toán đã xác nhận!`;
}

function buildCancelledPaymentContent({ buyerId, reason }) {
  return `<@${buyerId}> Giao dịch đã hủy: ${reason}`;
}

function buildPaymentThanksContent(buyerId) {
  return `${PAYMENT_PUBLIC_THANKS_MESSAGE} <@${buyerId}>`;
}

function buildPaymentFeedbackPromptContent(buyerId, { directMessage = false } = {}) {
  const prefix = directMessage ? '' : `<@${buyerId}> `;
  return `${prefix}Yên xin bạn đánh giá đơn này một xíu nha ❤️`;
}

function buildPendingPaymentEmbed({
  txId,
  amount,
  buyerId,
  sellerId,
  sellerTag,
  description,
  qrObj,
}) {
  return new EmbedBuilder()
    .setTitle('💳 Yêu cầu thanh toán')
    .addFields(
      { name: 'Mã TX', value: txId, inline: true },
      {
        name: 'Số tiền',
        value: `${amount.toLocaleString()} VNĐ`,
        inline: true,
      },
      { name: 'Buyer', value: `<@${buyerId}>`, inline: true },
      { name: 'Seller', value: sellerTag || `<@${sellerId}>`, inline: true },
      { name: 'Mô tả', value: description },
      { name: 'Trạng thái', value: '⏳ Chờ xác nhận' },
      {
        name: 'Tên Chủ TK',
        value: qrObj.bank || 'Chưa set',
        inline: false,
      },
      {
        name: 'Số Tài Khoản',
        value: qrObj.account || 'Chưa set',
        inline: false,
      },
      {
        name: '⚠️ CẢNH BÁO',
        value: '**CẤM GHI MUA/BÁN VÀ CHỈNH SỬA NỘI DUNG - CỐ Ý GHI PHẠT 10%**',
        inline: false,
      },
      { name: 'Quét QR để trả', value: '\u200B', inline: false },
    )
    .setColor('Blue')
    .setImage('attachment://my_qr.png')
    .setTimestamp()
    .setFooter({
      text: 'Vui lòng kiểm tra thật kỹ khi chuyển khoản và gửi bill sau khi thanh toán thành công ',
    })
    .setThumbnail(qrObj.logo || null);
}

function buildConfirmedPaymentEmbed({ tx, sellerTag, note }) {
  const embed = new EmbedBuilder()
    .setTitle('✅ Thanh toán xác nhận')
    .setColor('Green')
    .addFields(
      { name: 'Mã TX', value: tx.id, inline: true },
      {
        name: 'Số tiền',
        value: `${tx.amount.toLocaleString()} VNĐ`,
        inline: true,
      },
      { name: 'Người mua', value: `<@${tx.buyerId}>`, inline: true },
      { name: 'Người bán', value: sellerTag || 'Seller Fixed', inline: true },
      { name: 'Mô tả', value: tx.description || 'N/A' },
      {
        name: 'Ngày xử lý',
        value: new Date(tx.processedDate).toLocaleDateString('vi-VN'),
        inline: true,
      },
    )
    .setTimestamp();

  if (note) {
    embed.addFields({ name: 'Ghi chú', value: note, inline: false });
  }

  return embed;
}

function buildPaymentFeedbackPromptEmbed({ tx }) {
  return new EmbedBuilder()
    .setTitle('⭐ Đánh giá trải nghiệm mua hàng')
    .setDescription('Chọn số sao bên dưới để mở form đánh giá.')
    .setColor('Gold')
    .addFields(
      { name: 'Mã TX', value: tx.id, inline: true },
      {
        name: 'Số tiền',
        value: `${tx.amount.toLocaleString()} VNĐ`,
        inline: true,
      },
      { name: 'Đơn hàng', value: tx.description || 'N/A', inline: false },
    )
    .setTimestamp();
}

function buildPaymentFeedbackPromptPayload(tx, { directMessage = false } = {}) {
  return {
    content: buildPaymentFeedbackPromptContent(tx.buyerId, { directMessage }),
    embeds: [buildPaymentFeedbackPromptEmbed({ tx })],
    components: [buildRatingButtons(tx.id, tx.buyerId)],
  };
}

function buildPaymentTicketFeedbackFallbackPayload(tx) {
  return {
    content: `${buildPaymentThanksContent(tx.buyerId)}\n\n${buildPaymentFeedbackPromptContent(
      tx.buyerId,
    )}`,
    embeds: [buildPaymentFeedbackPromptEmbed({ tx })],
    components: [buildRatingButtons(tx.id, tx.buyerId)],
  };
}

function buildCancelledPaymentEmbed({ tx, sellerTag, reason }) {
  return new EmbedBuilder()
    .setTitle('❌ Giao dịch hủy')
    .addFields(
      { name: 'Mã TX', value: tx.id, inline: true },
      {
        name: 'Số tiền',
        value: `${tx.amount.toLocaleString()} VNĐ`,
        inline: true,
      },
      { name: 'Buyer', value: `<@${tx.buyerId}>`, inline: true },
      { name: 'Seller', value: sellerTag || 'Seller Fixed', inline: true },
      { name: 'Lý do', value: reason || 'Không có lý do' },
    )
    .setColor('Red')
    .setTimestamp();
}

async function resolveTextChannel(client, channelId) {
  if (!channelId) return null;

  return (
    client.channels.cache.get(channelId) ||
    (await client.channels.fetch(channelId).catch(() => null))
  );
}

async function resolveUser(client, userId) {
  if (!userId) return null;

  return client.users?.fetch ? await client.users.fetch(userId).catch(() => null) : null;
}

function createPaymentSession(action, tx, interaction) {
  const sessionId = createSessionId();

  paymentSessions.set(sessionId, {
    action,
    txId: tx.id,
    buyerId: tx.buyerId,
    sourceChannelId: interaction.channelId || interaction.channel?.id || null,
    sourceMessageId: interaction.message?.id || null,
    userId: interaction.user.id,
    expiresAt: Date.now() + PAYMENT_SESSION_TTL_MS,
  });

  return sessionId;
}

async function handlePayButton(interaction, config) {
  const parsed = parsePaymentButtonId(interaction.customId);
  if (!parsed) return;

  const { logger, paymentService, SHEETS_ID, ADMIN_ROLES = [] } = config;

  cleanupPaymentSessions();

  if (!isAdmin(interaction, ADMIN_ROLES)) {
    return interaction.reply({
      content: 'Bạn không có quyền admin để xử lý giao dịch.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const tx = paymentService.getPaymentById(parsed.txId);
  if (!tx || tx.status !== 'pending') {
    return interaction.reply({
      content: 'Giao dịch không còn ở trạng thái chờ xử lý.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (tx.buyerId !== parsed.buyerId) {
    return interaction.reply({
      content: 'Thông tin buyer không khớp với giao dịch.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const sessionId = createPaymentSession(parsed.action, tx, interaction);
  const modal = createPaymentModal(parsed.action, sessionId);

  await logger.info(
    `[pay] Admin ${interaction.user.tag} mở modal ${parsed.action} cho TX ${tx.id}`,
    SHEETS_ID,
  );

  await interaction.showModal(modal);
}

async function handlePayModal(interaction, config) {
  const { logger, paymentService, SHEETS_ID } = config;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  cleanupPaymentSessions();

  const parsed = parsePaymentModalId(interaction.customId);
  if (!parsed) {
    return interaction.editReply({
      content: 'Phiên xử lý không hợp lệ.',
    });
  }

  const session = paymentSessions.get(parsed.sessionId);
  if (!session || session.action !== parsed.action) {
    return interaction.editReply({
      content: 'Phiên xử lý đã hết hạn. Vui lòng thao tác lại từ embed payment.',
    });
  }

  if (session.userId !== interaction.user.id) {
    return interaction.editReply({
      content: 'Bạn không được phép xử lý phiên này.',
    });
  }

  const tx = paymentService.getPaymentById(session.txId);
  if (!tx || tx.status !== 'pending') {
    paymentSessions.delete(parsed.sessionId);
    return interaction.editReply({
      content: 'Giao dịch không còn ở trạng thái chờ xử lý.',
    });
  }

  const reason = interaction.fields.getTextInputValue('pay_reason')?.trim();
  if (session.action === 'cancel' && !reason) {
    return interaction.editReply({
      content: 'Vui lòng nhập lý do hủy.',
    });
  }

  tx.status = session.action === 'confirm' ? 'confirmed' : 'cancelled';
  tx.processedDate = new Date().toISOString();
  tx.reason = reason || '';

  const updated = await paymentService.updatePaymentInSheet(tx, SHEETS_ID);
  if (!updated) {
    await paymentService.savePaymentsToSheet(SHEETS_ID);
  }

  const sellerTag = tx.sellerTag || 'Seller Fixed';
  const sourceChannel = await resolveTextChannel(interaction.client, session.sourceChannelId);
  const sourceMessage = sourceChannel?.messages?.fetch
    ? await sourceChannel.messages.fetch(session.sourceMessageId).catch(() => null)
    : null;

  const isConfirm = session.action === 'confirm';

  const components = isConfirm
    ? []
    : [buildPaymentActionRow(tx.id, tx.buyerId, { disabled: true })];

  const embed = isConfirm
    ? buildConfirmedPaymentEmbed({ tx, sellerTag, note: reason })
    : buildCancelledPaymentEmbed({ tx, sellerTag, reason });

  const content = isConfirm
    ? buildConfirmedPaymentContent({ buyerId: tx.buyerId })
    : buildCancelledPaymentContent({ buyerId: tx.buyerId, reason: reason || 'Không có lý do' });

  if (sourceMessage?.edit) {
    await sourceMessage
      .edit({
        content,
        embeds: [embed],
        components,
        attachments: [],
      })
      .catch((error) =>
        logger.warn(
          `[pay] Không thể cập nhật message gốc cho TX ${tx.id}: ${error.message}`,
          SHEETS_ID,
        ),
      );
  } else {
    await logger.warn(`[pay] Không tìm thấy message gốc để cập nhật cho TX ${tx.id}`, SHEETS_ID);
  }

  if (isConfirm) {
    const buyerUser = await resolveUser(interaction.client, tx.buyerId);
    let sentFeedbackPromptToDm = false;

    if (buyerUser?.send) {
      sentFeedbackPromptToDm = await buyerUser
        .send(buildPaymentFeedbackPromptPayload(tx, { directMessage: true }))
        .then(() => true)
        .catch((error) => {
          void logger.warn(
            `[pay] Không thể DM prompt feedback cho TX ${tx.id}: ${error.message}`,
            SHEETS_ID,
          );
          return false;
        });
    }

    if (sourceChannel?.isTextBased?.()) {
      const ticketPayload = sentFeedbackPromptToDm
        ? { content: buildPaymentThanksContent(tx.buyerId) }
        : buildPaymentTicketFeedbackFallbackPayload(tx);

      await sourceChannel
        .send(ticketPayload)
        .catch((error) =>
          logger.warn(
            `[pay] Không thể gửi prompt feedback cho TX ${tx.id}: ${error.message}`,
            SHEETS_ID,
          ),
        );
    }
  }

  paymentSessions.delete(parsed.sessionId);

  await interaction.editReply({
    content: session.action === 'confirm' ? `Đã xác nhận TX ${tx.id}.` : `Đã hủy TX ${tx.id}.`,
  });
}

module.exports = {
  buildPaymentActionRow,
  buildPendingPaymentContent,
  buildPendingPaymentEmbed,
  buildConfirmedPaymentContent,
  buildConfirmedPaymentEmbed,
  buildPaymentFeedbackPromptContent,
  buildPaymentFeedbackPromptEmbed,
  buildPaymentFeedbackPromptPayload,
  buildPaymentTicketFeedbackFallbackPayload,
  buildPaymentThanksContent,
  buildCancelledPaymentContent,
  buildCancelledPaymentEmbed,
  buildRatingButtons,
  handlePayButton,
  handlePayModal,
  isPaymentButton,
  isPaymentModal,
};
