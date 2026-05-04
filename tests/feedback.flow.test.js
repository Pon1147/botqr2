const test = require("node:test");
const assert = require("node:assert/strict");

const interactionEvent = require("../src/events/interactionCreate");
const { createMockContext } = require("./helpers/mockDiscord");

test("feedback submit posts review public without thanking source channel", async () => {
  const ctx = createMockContext();
  const buyer = ctx.users.buyer;

  const sourceChannelId = "source_channel_test";
  const sourcePayloads = [];
  ctx.client.channels.cache.set(sourceChannelId, {
    id: sourceChannelId,
    isTextBased() {
      return true;
    },
    messages: {
      async fetch() {
        return null;
      },
    },
    async send(payload) {
      sourcePayloads.push(payload);
      return payload;
    },
  });

  const feedbackChannelId = "feedback_channel_test";
  const feedbackPayloads = [];
  ctx.client.channels.cache.set(feedbackChannelId, {
    id: feedbackChannelId,
    isTextBased() {
      return true;
    },
    messages: {
      async fetch() {
        return null;
      },
    },
    async send(payload) {
      feedbackPayloads.push(payload);
      return payload;
    },
  });
  ctx.config.FEEDBACK_CHANNEL_ID = feedbackChannelId;

  const rateInteraction = ctx.createInteraction({
    type: "button",
    user: buyer,
    isAdmin: false,
    customId: `feedback_rate_5_TXCONF1_${buyer.id}`,
    channel: ctx.client.channels.cache.get(sourceChannelId),
  });

  await interactionEvent.execute(rateInteraction, ctx.config);

  const modalPayload = rateInteraction.responses.find((r) => r.type === "showModal")?.payload;
  const modalCustomId =
    modalPayload?.toJSON?.().custom_id || modalPayload?.data?.custom_id || modalPayload?.custom_id;

  assert.ok(
    modalCustomId?.startsWith("feedback_modal_"),
    "feedback button should open modal",
  );

  const modalInteraction = ctx.createInteraction({
    type: "modal",
    user: buyer,
    isAdmin: false,
    customId: modalCustomId,
    fieldValues: {
      feedback_comment: "Rất hài lòng, hỗ trợ nhanh.",
    },
  });

  await interactionEvent.execute(modalInteraction, ctx.config);

  assert.ok(
    modalInteraction.responses.some((r) => r.type === "deleteReply"),
    "feedback submit should remove the private ack",
  );
  assert.ok(
    !modalInteraction.responses.some((r) => r.type === "editReply"),
    "feedback submit should not keep a private editReply",
  );

  assert.equal(feedbackPayloads.length, 1);
  assert.equal(feedbackPayloads[0].content, `Feedback của <@${buyer.id}>`);
  assert.equal(sourcePayloads.length, 0);
  assert.equal(ctx.state.feedbackRows.length, 1);
});

test("feedback submit still records feedback when feedback channel is inaccessible", async () => {
  const ctx = createMockContext();
  const buyer = ctx.users.other;

  const sourceChannelId = "source_channel_test_2";
  const sourcePayloads = [];
  ctx.client.channels.cache.set(sourceChannelId, {
    id: sourceChannelId,
    isTextBased() {
      return true;
    },
    messages: {
      async fetch() {
        return null;
      },
    },
    async send(payload) {
      sourcePayloads.push(payload);
      return payload;
    },
  });

  const feedbackChannelId = "feedback_channel_test_2";
  ctx.client.channels.cache.set(feedbackChannelId, {
    id: feedbackChannelId,
    isTextBased() {
      return true;
    },
    messages: {
      async fetch() {
        return null;
      },
    },
    async send() {
      const error = new Error("Missing Access");
      error.code = 50001;
      throw error;
    },
  });
  ctx.config.FEEDBACK_CHANNEL_ID = feedbackChannelId;

  const rateInteraction = ctx.createInteraction({
    type: "button",
    user: buyer,
    isAdmin: false,
    customId: `feedback_rate_5_TXCONF2_${buyer.id}`,
    channel: ctx.client.channels.cache.get(sourceChannelId),
  });
  await interactionEvent.execute(rateInteraction, ctx.config);

  const modalPayload = rateInteraction.responses.find((r) => r.type === "showModal")?.payload;
  const modalCustomId =
    modalPayload?.toJSON?.().custom_id ||
    modalPayload?.data?.custom_id ||
    modalPayload?.custom_id ||
    rateInteraction.modalShown?.custom_id ||
    rateInteraction.modalShown?.data?.custom_id;

  assert.ok(modalCustomId, "feedback button should open modal");

  const modalInteraction = ctx.createInteraction({
    type: "modal",
    user: buyer,
    isAdmin: false,
    customId: modalCustomId,
    fieldValues: {
      feedback_comment: "Rất hài lòng, hỗ trợ nhanh.",
    },
  });

  await interactionEvent.execute(modalInteraction, ctx.config);

  assert.ok(
    modalInteraction.responses.some((r) => r.type === "deleteReply"),
    "feedback submit should still clear the private response",
  );
  assert.ok(
    ctx.state.logs.some(
      (entry) =>
        entry.level === "WARN" &&
        String(entry.message).includes("Không thể gửi feedback vào kênh"),
    ),
    "should log inaccessible feedback channel",
  );
  assert.equal(sourcePayloads.length, 0);
});
