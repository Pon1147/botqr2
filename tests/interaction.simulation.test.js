const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const interactionEvent = require("../src/events/interactionCreate");
const { createMockContext } = require("./helpers/mockDiscord");

function loadCommands() {
  const commands = [];
  const root = path.join(__dirname, "..", "src", "commands");

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        commands.push(require(fullPath));
      }
    }
  }

  walk(root);
  return commands;
}

test("full interaction simulation via interactionCreate", async () => {
  const ctx = createMockContext();

  for (const command of loadCommands()) {
    ctx.client.commands.set(command.data.name, command);
  }

  const admin = ctx.users.admin;
  const buyer = ctx.users.buyer;
  const other = ctx.users.other;

  const capitalShow = ctx.createInteraction({
    type: "chat",
    commandName: "capital",
    user: admin,
    isAdmin: true,
  });
  await interactionEvent.execute(capitalShow, ctx.config);
  assert.ok(
    capitalShow.responses.some((r) => r.type === "editReply"),
    "capital dashboard should edit reply"
  );

  const capitalDailyButtonId =
    capitalShow.lastMessage.components?.[0]?.components?.[0]?.customId ||
    capitalShow.lastMessage.components?.[0]?.components?.[0]?.data?.custom_id ||
    null;
  assert.ok(
    String(capitalDailyButtonId || "").startsWith("capital_daily_"),
    "capital dashboard should expose daily button"
  );

  const capitalDailyButton = ctx.createInteraction({
    type: "button",
    customId: capitalDailyButtonId,
    user: admin,
    isAdmin: true,
    channel: capitalShow.channel,
    message: capitalShow.lastMessage,
  });
  await interactionEvent.execute(capitalDailyButton, ctx.config);
  assert.ok(
    /Doanh thu hôm nay/i.test(
      capitalShow.lastMessage.embeds?.[0]?.data?.title || "",
    ),
    "capital daily button should render report"
  );

  const capitalBackButton = ctx.createInteraction({
    type: "button",
    customId: `capital_back_${capitalShow.id}`,
    user: admin,
    isAdmin: true,
    channel: capitalShow.channel,
    message: capitalShow.lastMessage,
  });
  await interactionEvent.execute(capitalBackButton, ctx.config);
  assert.ok(
    /Dashboard tài chính/i.test(
      capitalShow.lastMessage.embeds?.[0]?.data?.title || "",
    ),
    "capital back button should restore dashboard"
  );

  const capitalReportButton = ctx.createInteraction({
    type: "button",
    customId: `capital_report_${capitalShow.id}`,
    user: admin,
    isAdmin: true,
    channel: capitalShow.channel,
    message: capitalShow.lastMessage,
  });
  await interactionEvent.execute(capitalReportButton, ctx.config);
  assert.ok(
    /Báo cáo tài chính/i.test(
      capitalShow.lastMessage.embeds?.[0]?.data?.title || "",
    ),
    "capital report button should render report"
  );

  const capitalAddButton = ctx.createInteraction({
    type: "button",
    customId: `capital_add_${capitalShow.id}`,
    user: admin,
    isAdmin: true,
    channel: capitalShow.channel,
    message: capitalShow.lastMessage,
  });
  await interactionEvent.execute(capitalAddButton, ctx.config);
  assert.ok(
    capitalAddButton.responses.some((r) => r.type === "showModal"),
    "capital add button should show modal"
  );

  const capitalModal = ctx.createInteraction({
    type: "modal",
    customId: `capital_modal_${capitalShow.id}`,
    user: admin,
    fieldValues: { capital_amount: "100000" },
  });
  await interactionEvent.execute(capitalModal, ctx.config);
  assert.ok(
    capitalModal.responses.some((r) => r.type === "followUp"),
    "capital modal should followUp report"
  );
  assert.equal(ctx.state.capital, 489381);

  const payInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "pay",
    user: admin,
    isAdmin: true,
    optionValues: {
      buyer,
      amount: 130000,
      description: "flow-pay",
    },
  });
  await interactionEvent.execute(payInteraction, ctx.config);

  const createdTx = ctx.state.payments.find(
    (tx) => tx.description === "flow-pay" && tx.status === "pending"
  );
  assert.ok(createdTx, "pay should create pending transaction");
  assert.equal(
    payInteraction.lastMessage.attachments?.length,
    1,
    "pay message should initially contain the QR attachment",
  );

  const confirmButton = ctx.createInteraction({
    type: "button",
    customId: `pay_confirm_${createdTx.id}_${buyer.id}`,
    user: admin,
    isAdmin: true,
    channel: payInteraction.channel,
    message: payInteraction.lastMessage,
  });
  await interactionEvent.execute(confirmButton, ctx.config);
  const confirmModalPayload = confirmButton.modalShown;
  const confirmModalCustomId =
    confirmModalPayload?.toJSON?.().custom_id ||
    confirmModalPayload?.data?.custom_id ||
    confirmModalPayload?.custom_id;
  assert.ok(confirmModalCustomId, "confirm button should open modal");

  const confirmModal = ctx.createInteraction({
    type: "modal",
    customId: confirmModalCustomId,
    user: admin,
    fieldValues: { pay_reason: "Đã nhận đủ tiền" },
  });
  await interactionEvent.execute(confirmModal, ctx.config);

  const confirmedTx = ctx.state.payments.find((tx) => tx.id === createdTx.id);
  assert.equal(confirmedTx.status, "confirmed");
  assert.equal(confirmedTx.reason, "Đã nhận đủ tiền");
  assert.equal(
    payInteraction.lastMessage.attachments?.length,
    0,
    "confirmed payment should clear the QR attachment",
  );
  const confirmedPaymentButtonCustomIds =
    payInteraction.lastMessage.components?.[0]?.components?.map(
      (button) =>
        button?.customId ||
        button?.data?.custom_id ||
        button?.toJSON?.().custom_id ||
        null,
    ) || [];
  assert.ok(
    !confirmedPaymentButtonCustomIds.some((id) => String(id || "").startsWith("feedback_rate_")),
    "confirmed payment message should not combine feedback buttons",
  );

  const channelMessages = Array.from(payInteraction.channel._messageStore.values());
  const ticketThanksMessage = channelMessages.find(
    (message) =>
      message.id !== payInteraction.lastMessage.id &&
      String(message.content || "").includes(`<@${buyer.id}>`) &&
      String(message.content || "").includes("Y\u00ean") &&
      String(message.content || "").includes("\u0111\u00f3ng ticket"),
  );
  assert.ok(ticketThanksMessage, "confirm should send thanks in ticket");
  assert.equal(
    ticketThanksMessage.embeds?.length || 0,
    0,
    "ticket thanks should not include feedback embed when DM succeeds",
  );
  assert.equal(
    ticketThanksMessage.components?.length || 0,
    0,
    "ticket thanks should not include feedback buttons when DM succeeds",
  );

  const feedbackPromptMessage = buyer.dmMessages.find(
    (message) =>
      String(message.content || "").includes("Y\u00ean") &&
      String(message.content || "").includes("\u0111\u00e1nh gi\u00e1"),
  );
  assert.ok(feedbackPromptMessage, "confirm should DM a feedback prompt");
  assert.ok(
    feedbackPromptMessage.embeds?.[0],
    "DM feedback prompt should include an embed",
  );
  assert.match(
    feedbackPromptMessage.embeds?.[0]?.data?.title || "",
    /Đánh giá trải nghiệm mua hàng/i,
    "DM feedback prompt embed should explain the rating section",
  );

  const promptButtonCustomIds =
    feedbackPromptMessage.components?.[0]?.components?.map(
      (button) =>
        button?.customId ||
        button?.data?.custom_id ||
        button?.toJSON?.().custom_id ||
        null,
    ) || [];
  assert.ok(
    promptButtonCustomIds.some((id) => String(id || "").startsWith("feedback_rate_")),
    "DM feedback prompt should expose feedback buttons",
  );
  const promptButtonLabels =
    feedbackPromptMessage.components?.[0]?.components?.map(
      (button) => button?.label || button?.data?.label || button?.toJSON?.().label || "",
    ) || [];
  assert.deepEqual(
    promptButtonLabels,
    ["1", "2", "3", "4", "5"],
    "DM feedback prompt should keep numeric labels",
  );
  const promptButtonEmojiIds =
    feedbackPromptMessage.components?.[0]?.components?.map(
      (button) =>
        button?.emoji?.id ||
        button?.data?.emoji?.id ||
        button?.toJSON?.().emoji?.id ||
        "",
    ) || [];
  assert.ok(
    promptButtonEmojiIds.every((id) => id === "1489166513343823943"),
    "DM feedback prompt should use the custom star emoji property",
  );

  other.dmShouldFail = true;
  const fallbackPayInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "pay",
    user: admin,
    isAdmin: true,
    optionValues: {
      buyer: other,
      amount: 150000,
      description: "flow-dm-fallback",
    },
  });
  await interactionEvent.execute(fallbackPayInteraction, ctx.config);

  const fallbackTx = ctx.state.payments.find(
    (tx) => tx.description === "flow-dm-fallback" && tx.status === "pending",
  );
  assert.ok(fallbackTx, "pay should create fallback DM pending transaction");

  const fallbackConfirmButton = ctx.createInteraction({
    type: "button",
    customId: `pay_confirm_${fallbackTx.id}_${other.id}`,
    user: admin,
    isAdmin: true,
    channel: fallbackPayInteraction.channel,
    message: fallbackPayInteraction.lastMessage,
  });
  await interactionEvent.execute(fallbackConfirmButton, ctx.config);
  const fallbackConfirmModalPayload = fallbackConfirmButton.modalShown;
  const fallbackConfirmModalCustomId =
    fallbackConfirmModalPayload?.toJSON?.().custom_id ||
    fallbackConfirmModalPayload?.data?.custom_id ||
    fallbackConfirmModalPayload?.custom_id;
  assert.ok(fallbackConfirmModalCustomId, "fallback confirm button should open modal");

  const fallbackConfirmModal = ctx.createInteraction({
    type: "modal",
    customId: fallbackConfirmModalCustomId,
    user: admin,
    fieldValues: { pay_reason: "DM kh\u00f4ng m\u1edf" },
  });
  await interactionEvent.execute(fallbackConfirmModal, ctx.config);
  other.dmShouldFail = false;

  const fallbackPromptMessage = Array.from(
    fallbackPayInteraction.channel._messageStore.values(),
  ).find((message) =>
    /Đánh giá trải nghiệm mua hàng/i.test(message.embeds?.[0]?.data?.title || "") &&
    message.embeds?.[0]?.data?.fields?.some(
      (field) => field?.name === "Mã TX" && field?.value === fallbackTx.id,
    ),
  );
  assert.ok(fallbackPromptMessage, "DM failure should fall back to ticket prompt");
  assert.ok(
    fallbackPromptMessage.components?.[0]?.components?.some((button) =>
      String(
        button?.customId ||
          button?.data?.custom_id ||
          button?.toJSON?.().custom_id ||
          "",
      ).startsWith("feedback_rate_"),
    ),
    "ticket fallback prompt should expose feedback buttons",
  );

  const cancelPayInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "pay",
    user: admin,
    isAdmin: true,
    optionValues: {
      buyer: buyer,
      amount: 140000,
      description: "flow-cancel",
    },
  });
  await interactionEvent.execute(cancelPayInteraction, ctx.config);

  const cancelledTxSeed = ctx.state.payments.find(
    (tx) => tx.description === "flow-cancel" && tx.status === "pending",
  );
  assert.ok(cancelledTxSeed, "pay should create second pending transaction");

  const cancelButton = ctx.createInteraction({
    type: "button",
    customId: `pay_cancel_${cancelledTxSeed.id}_${buyer.id}`,
    user: admin,
    isAdmin: true,
    channel: cancelPayInteraction.channel,
    message: cancelPayInteraction.lastMessage,
  });
  await interactionEvent.execute(cancelButton, ctx.config);
  const cancelModalPayload = cancelButton.modalShown;
  const cancelModalCustomId =
    cancelModalPayload?.toJSON?.().custom_id ||
    cancelModalPayload?.data?.custom_id ||
    cancelModalPayload?.custom_id;
  assert.ok(cancelModalCustomId, "cancel button should open modal");

  const cancelModal = ctx.createInteraction({
    type: "modal",
    customId: cancelModalCustomId,
    user: admin,
    fieldValues: { pay_reason: "Khách đổi ý" },
  });
  await interactionEvent.execute(cancelModal, ctx.config);

  const cancelledTx = ctx.state.payments.find((tx) => tx.id === cancelledTxSeed.id);
  assert.equal(cancelledTx.status, "cancelled");
  assert.equal(cancelledTx.reason, "Khách đổi ý");

  const topInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "top",
    user: buyer,
    isAdmin: false,
  });
  await interactionEvent.execute(topInteraction, ctx.config);
  assert.ok(
    topInteraction.responses.some((r) => r.type === "editReply"),
    "top should respond"
  );

  const historyInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "history",
    user: buyer,
    isAdmin: false,
  });
  await interactionEvent.execute(historyInteraction, ctx.config);
  assert.ok(
    historyInteraction.responses.some((r) => r.type === "editReply"),
    "history should respond"
  );

  const qrInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "qr",
    user: admin,
    isAdmin: true,
    optionValues: { user: buyer },
  });
  await interactionEvent.execute(qrInteraction, ctx.config);
  assert.ok(
    qrInteraction.responses.some((r) => r.type === "editReply"),
    "qr dashboard should render"
  );

  const qrEditButtonId =
    qrInteraction.lastMessage.components?.[0]?.components?.[0]?.customId ||
    qrInteraction.lastMessage.components?.[0]?.components?.[0]?.data?.custom_id ||
    null;
  assert.ok(
    String(qrEditButtonId || "").startsWith("qr_dashboard_edit_"),
    "qr dashboard should expose edit button"
  );

  const qrEditButton = ctx.createInteraction({
    type: "button",
    customId: qrEditButtonId,
    user: admin,
    isAdmin: true,
    channel: qrInteraction.channel,
    message: qrInteraction.lastMessage,
  });
  await interactionEvent.execute(qrEditButton, ctx.config);
  assert.ok(
    qrInteraction.lastMessage.components?.some((row) =>
      row.components?.some(
        (component) =>
          component?.customId === `edit_bankcode_${buyer.id}` ||
          component?.data?.custom_id === `edit_bankcode_${buyer.id}`,
      ),
    ),
    "qr edit panel should expose field buttons"
  );
  assert.ok(
    qrInteraction.lastMessage.components?.some((row) =>
      row.components?.some(
        (component) =>
          component?.customId === `qr_dashboard_save_${qrInteraction.id}` ||
          component?.data?.custom_id === `qr_dashboard_save_${qrInteraction.id}`,
      ),
    ),
    "qr edit panel should expose save button"
  );

  const qrEditBankButton = ctx.createInteraction({
    type: "button",
    customId: `edit_bankcode_${buyer.id}`,
    user: admin,
    isAdmin: true,
    channel: qrInteraction.channel,
    message: qrInteraction.lastMessage,
  });
  await interactionEvent.execute(qrEditBankButton, ctx.config);
  const bankSelectId =
    qrInteraction.lastMessage.components?.[0]?.components?.[0]?.customId ||
    qrInteraction.lastMessage.components?.[0]?.components?.[0]?.data?.custom_id ||
    null;
  assert.ok(
    String(bankSelectId || "").startsWith(`qr_dashboard_bank_${qrInteraction.id}`),
    "bank selection should expose select menu"
  );

  const bankSelect = ctx.createInteraction({
    type: "stringSelect",
    customId: bankSelectId,
    values: ["970436"],
    user: admin,
    isAdmin: true,
    channel: qrInteraction.channel,
    message: qrInteraction.lastMessage,
  });
  await interactionEvent.execute(bankSelect, ctx.config);
  const bankFieldValue =
    qrInteraction.lastMessage.embeds?.[0]?.data?.fields?.find(
      (field) => field?.name === "Bank code",
    )?.value || "";
  assert.ok(
    /970436/.test(bankFieldValue),
    "selected bank should update draft bank code"
  );
  assert.equal(
    ctx.state.qrData.get(buyer.id).bankCode,
    "970422",
    "selected bank should stay as draft until save",
  );

  const qrSaveButton = ctx.createInteraction({
    type: "button",
    customId: `qr_dashboard_save_${qrInteraction.id}`,
    user: admin,
    isAdmin: true,
    channel: qrInteraction.channel,
    message: qrInteraction.lastMessage,
  });
  await interactionEvent.execute(qrSaveButton, ctx.config);
  assert.equal(ctx.state.qrData.get(buyer.id).bankCode, "970436");

  const qrBackButton = ctx.createInteraction({
    type: "button",
    customId: `qr_dashboard_back_${qrInteraction.id}`,
    user: admin,
    isAdmin: true,
    channel: qrInteraction.channel,
    message: qrInteraction.lastMessage,
  });
  await interactionEvent.execute(qrBackButton, ctx.config);
  assert.ok(
    /QR thanh toán của/i.test(qrInteraction.lastMessage.embeds?.[0]?.data?.title || ""),
    "qr back button should restore dashboard"
  );

  const qrRemoveButton = ctx.createInteraction({
    type: "button",
    customId: `qr_dashboard_remove_${qrInteraction.id}`,
    user: admin,
    isAdmin: true,
    channel: qrInteraction.channel,
    message: qrInteraction.lastMessage,
  });
  await interactionEvent.execute(qrRemoveButton, ctx.config);
  assert.equal(ctx.state.qrData.get(buyer.id), undefined);

  const infoInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "info",
    user: admin,
    isAdmin: true,
  });
  await interactionEvent.execute(infoInteraction, ctx.config);
  assert.ok(
    infoInteraction.responses.some((r) => r.type === "editReply"),
    "info should render dashboard"
  );

  const infoActionCustomId =
    infoInteraction.lastMessage.components?.[0]?.components?.[0]?.customId ||
    infoInteraction.lastMessage.components?.[0]?.components?.[0]?.data?.custom_id ||
    null;
  assert.ok(
    String(infoActionCustomId || "").startsWith("info_action_"),
    "info dashboard should expose action select"
  );

  const infoActionSelect = ctx.createInteraction({
    type: "stringSelect",
    customId: infoActionCustomId,
    values: ["list"],
    user: admin,
    isAdmin: true,
    channel: infoInteraction.channel,
    message: infoInteraction.lastMessage,
  });
  await interactionEvent.execute(infoActionSelect, ctx.config);
  assert.ok(
    infoInteraction.lastMessage.components?.some((row) =>
      row.components?.some(
        (component) =>
          component?.customId === `info_status_${infoInteraction.id}` ||
          component?.data?.custom_id === `info_status_${infoInteraction.id}`,
      ),
    ),
    "info list flow should show status select"
  );

  const infoStatusSelect = ctx.createInteraction({
    type: "stringSelect",
    customId: `info_status_${infoInteraction.id}`,
    values: ["confirmed"],
    user: admin,
    isAdmin: true,
    channel: infoInteraction.channel,
    message: infoInteraction.lastMessage,
  });
  await interactionEvent.execute(infoStatusSelect, ctx.config);
  assert.ok(
    /Danh sách giao dịch/i.test(
      infoInteraction.lastMessage.embeds?.[0]?.data?.title || "",
    ),
    "info status flow should render list embed"
  );

  const editBankButton = ctx.createInteraction({
    type: "button",
    customId: `edit_bank_${other.id}`,
    user: other,
    isAdmin: false,
  });
  await interactionEvent.execute(editBankButton, ctx.config);
  assert.ok(
    editBankButton.responses.some((r) => r.type === "showModal"),
    "button edit_bank should show modal"
  );

  const editBankModal = ctx.createInteraction({
    type: "modal",
    customId: `modal_bank_${other.id}`,
    user: other,
    fieldValues: { input_value: "Nguyen Van B" },
  });
  await interactionEvent.execute(editBankModal, ctx.config);
  assert.equal(ctx.state.qrData.get(other.id).bank, "Nguyen Van B");

  const unauthorizedRemove = ctx.createInteraction({
    type: "chat",
    commandName: "remove",
    user: buyer,
    isAdmin: false,
    optionValues: { transaction_code: "TXCONF2", reason: "unauthorized" },
  });
  await interactionEvent.execute(unauthorizedRemove, ctx.config);
  assert.ok(
    unauthorizedRemove.responses.some(
      (r) => r.type === "reply" && /admin/i.test(r.payload.content)
    ),
    "non-admin should be denied"
  );
});
