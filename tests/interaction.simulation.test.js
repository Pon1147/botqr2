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

  const confirmInteraction = ctx.createInteraction({
    type: "chat",
    commandName: "confirm",
    user: admin,
    isAdmin: true,
    optionValues: { transaction_code: createdTx.id },
  });
  await interactionEvent.execute(confirmInteraction, ctx.config);

  const confirmedTx = ctx.state.payments.find((tx) => tx.id === createdTx.id);
  assert.equal(confirmedTx.status, "confirmed");

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
