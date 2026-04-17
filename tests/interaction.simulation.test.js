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

  const capitalShow = ctx.createInteraction({
    type: "chat",
    commandName: "capital",
    user: admin,
    isAdmin: true,
    optionValues: { action: "show" },
  });
  await interactionEvent.execute(capitalShow, ctx.config);
  assert.ok(
    capitalShow.responses.some((r) => r.type === "editReply"),
    "capital show should edit reply"
  );

  const capitalAddCommand = ctx.createInteraction({
    type: "chat",
    commandName: "capital",
    user: admin,
    isAdmin: true,
    optionValues: { action: "add" },
  });
  await interactionEvent.execute(capitalAddCommand, ctx.config);
  assert.ok(
    capitalAddCommand.responses.some((r) => r.type === "showModal"),
    "capital add should show modal"
  );

  const capitalModal = ctx.createInteraction({
    type: "modal",
    customId: `capital_modal_${admin.id}`,
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
  const ratingButtonCustomIds =
    payInteraction.lastMessage.components?.[0]?.components?.map(
      (button) =>
        button?.customId ||
        button?.data?.custom_id ||
        button?.toJSON?.().custom_id ||
        null,
    ) || [];
  assert.ok(
    ratingButtonCustomIds.some((id) => String(id || "").startsWith("feedback_rate_")),
    "confirmed payment should expose feedback buttons",
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
    customId: `edit_bank_${buyer.id}`,
    user: buyer,
    isAdmin: false,
  });
  await interactionEvent.execute(editBankButton, ctx.config);
  assert.ok(
    editBankButton.responses.some((r) => r.type === "showModal"),
    "button edit_bank should show modal"
  );

  const editBankModal = ctx.createInteraction({
    type: "modal",
    customId: `modal_bank_${buyer.id}`,
    user: buyer,
    fieldValues: { input_value: "Nguyen Van B" },
  });
  await interactionEvent.execute(editBankModal, ctx.config);
  assert.equal(ctx.state.qrData.get(buyer.id).bank, "Nguyen Van B");

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
