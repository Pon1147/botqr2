const { EventEmitter } = require("events");
const { Collection } = require("discord.js");
const { parseCustomId } = require("../../src/utils/embedUtils");

let interactionSeq = 0;
let messageSeq = 0;

function createAckError() {
  const err = new Error("Interaction has already been acknowledged.");
  err.code = 40060;
  return err;
}

function createUser(id, username = "User") {
  return {
    id,
    username,
    globalName: username,
    tag: `${username}#0001`,
    toString() {
      return `<@${id}>`;
    },
  };
}

class MockCollector extends EventEmitter {
  constructor() {
    super();
    this.ended = false;
  }

  stop(reason = "manual") {
    if (this.ended) return;
    this.ended = true;
    this.emit("end", [], reason);
  }
}

class MockMessage {
  constructor({ channel = null } = {}) {
    this.id = `msg_${++messageSeq}`;
    this.channel = channel;
    this.deleted = false;
    this.collector = new MockCollector();
    this.components = [];
    this.embeds = [];
    this.content = "";
  }

  createMessageComponentCollector() {
    return this.collector;
  }

  async delete() {
    this.deleted = true;
  }

  async edit(payload = {}) {
    if (payload.content !== undefined) this.content = payload.content;
    if (payload.components) this.components = payload.components;
    if (payload.embeds) this.embeds = payload.embeds;
    return this;
  }
}

class MockInteraction {
  constructor({
    type = "chat",
    commandName = null,
    customId = null,
    optionValues = {},
    fieldValues = {},
    user,
    member,
    client,
    guild,
    channel,
    message,
  }) {
    this.id = `int_${++interactionSeq}`;
    this._type = type;
    this.commandName = commandName;
    this.customId = customId;
    this._optionValues = optionValues;
    this._fieldValues = fieldValues;
    this.user = user;
    this.member = member;
    this.client = client;
    this.guild = guild;
    this.channel = channel;
    this.channelId = channel?.id || null;
    this.message = message || null;

    this.deferred = false;
    this.replied = false;
    this.responses = [];
    this.modalShown = null;
    this.lastMessage = new MockMessage();

    this.options = {
      getString: (name) => {
        const value = this._optionValues[name];
        if (value === undefined || value === null) return null;
        return String(value);
      },
      getInteger: (name) => {
        const value = this._optionValues[name];
        if (value === undefined || value === null) return null;
        return Number(value);
      },
      getUser: (name) => this._optionValues[name] || null,
      getChannel: (name) => this._optionValues[name] || null,
    };

    this.fields = {
      getTextInputValue: (name) => {
        if (!(name in this._fieldValues)) return "";
        return String(this._fieldValues[name]);
      },
      getStringSelectValues: (name) => {
        const value = this._fieldValues[name];
        if (Array.isArray(value)) return value;
        if (value === undefined || value === null) return [];
        return [String(value)];
      },
    };
  }

  isChatInputCommand() {
    return this._type === "chat";
  }

  isButton() {
    return this._type === "button";
  }

  isModalSubmit() {
    return this._type === "modal";
  }

  async deferReply(options = {}) {
    if (this.deferred || this.replied) throw createAckError();
    this.deferred = true;
    this.responses.push({ type: "deferReply", payload: options });
  }

  async reply(payload) {
    if (this.deferred || this.replied) throw createAckError();
    this.replied = true;
    this.responses.push({ type: "reply", payload });
    return this.lastMessage;
  }

  async editReply(payload) {
    if (!this.deferred && !this.replied) {
      this.replied = true;
    }
    this.responses.push({ type: "editReply", payload });
    if (payload) {
      const nextMessage = payload.fetchReply
        ? new MockMessage({ channel: this.channel })
        : this.lastMessage;

      if (payload.content !== undefined) nextMessage.content = payload.content;
      if (payload.components) nextMessage.components = payload.components;
      if (payload.embeds) nextMessage.embeds = payload.embeds;

      this.lastMessage = nextMessage;
      if (this.channel?._messageStore) {
        this.channel._messageStore.set(this.lastMessage.id, this.lastMessage);
      }
      return this.lastMessage;
    }
    return this.lastMessage;
  }

  async deleteReply() {
    this.responses.push({ type: "deleteReply" });
  }

  async followUp(payload) {
    if (!this.deferred && !this.replied) {
      throw new Error("Cannot followUp before acknowledge");
    }
    this.responses.push({ type: "followUp", payload });
    return this.lastMessage;
  }

  async showModal(modal) {
    if (this.deferred || this.replied) throw createAckError();
    this.replied = true;
    this.modalShown = modal;
    this.responses.push({ type: "showModal", payload: modal });
  }

  async deferUpdate() {
    if (this.deferred || this.replied) throw createAckError();
    this.deferred = true;
    this.responses.push({ type: "deferUpdate", payload: null });
  }

  async update(payload) {
    if (this.deferred || this.replied) throw createAckError();
    this.replied = true;
    this.responses.push({ type: "update", payload });
  }
}

function createMockContext() {
  const sellerId = process.env.DEFAULT_SELLER_ID || "755200447358173233";
  process.env.DEFAULT_SELLER_ID = sellerId;

  const users = {
    admin: createUser("100000000000000001", "AdminUser"),
    buyer: createUser("100000000000000002", "BuyerUser"),
    seller: createUser(sellerId, "SellerUser"),
    other: createUser("100000000000000003", "OtherUser"),
  };

  const usersMap = new Map(Object.values(users).map((u) => [u.id, u]));

  const logs = [];
  const logger = {
    async info(message, spreadsheetId) {
      logs.push({ level: "INFO", message, spreadsheetId });
    },
    async warn(message, spreadsheetId) {
      logs.push({ level: "WARN", message, spreadsheetId });
    },
    async error(message, spreadsheetId) {
      logs.push({ level: "ERROR", message, spreadsheetId });
    },
    async debug(message, spreadsheetId) {
      logs.push({ level: "DEBUG", message, spreadsheetId });
    },
  };

  const now = new Date().toISOString();
  const payments = [
    {
      id: "TXPENDING1",
      buyerId: users.buyer.id,
      amount: 150000,
      description: "Pending smoke tx",
      status: "pending",
      date: now,
      processedDate: "",
      reason: "",
      sheetRow: 2,
    },
    {
      id: "TXCONF1",
      buyerId: users.buyer.id,
      amount: 250000,
      description: "Confirmed smoke tx",
      status: "confirmed",
      date: now,
      processedDate: now,
      reason: "",
      sheetRow: 3,
    },
    {
      id: "TXCONF2",
      buyerId: users.other.id,
      amount: 320000,
      description: "Second confirmed tx",
      status: "confirmed",
      date: now,
      processedDate: now,
      reason: "",
      sheetRow: 4,
    },
  ];

  const getTotalConfirmed = () =>
    payments
      .filter((tx) => tx.status === "confirmed")
      .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

  let nextSheetRow = payments.length + 2;
  const paymentSheetOps = [];

  function clonePayment(tx) {
    return { ...tx };
  }

  const paymentService = {
    async loadPaymentsFromSheet() {},
    async savePaymentsToSheet() {},
    async addPayment(newTx) {
      newTx.sheetRow = nextSheetRow;
      nextSheetRow += 1;
      payments.unshift(newTx);
    },
    getSortedPayments() {
      return [...payments].sort((a, b) => new Date(b.date) - new Date(a.date));
    },
    getPaymentsByBuyerId(buyerId) {
      return payments.filter((tx) => tx.buyerId === buyerId);
    },
    getPaymentById(id) {
      return payments.find((tx) => tx.id === id) || null;
    },
    getTotalConfirmed,
    async updatePaymentInSheet(tx, spreadsheetId) {
      void spreadsheetId;
      paymentSheetOps.push({
        type: "update",
        id: tx?.id || null,
        sheetRow: tx?.sheetRow || null,
        tx: tx ? clonePayment(tx) : null,
      });
      return Boolean(tx?.sheetRow);
    },
    async clearPaymentFromSheet(tx, spreadsheetId) {
      void spreadsheetId;
      paymentSheetOps.push({
        type: "clear",
        id: tx?.id || null,
        sheetRow: tx?.sheetRow || null,
        tx: tx ? clonePayment(tx) : null,
      });
      return Boolean(tx?.sheetRow);
    },
    removePaymentById(id) {
      const index = payments.findIndex((tx) => tx.id === id);
      if (index === -1) return null;
      return payments.splice(index, 1)[0];
    },
  };

  const qrData = new Map([
    [
      users.seller.id,
      {
        bank: "VCB Seller",
        account: "123456",
        url: "https://pay.example/seller",
        logo: "",
        bankCode: "970422",
        accountName: "Ebe Yen",
      },
    ],
    [
      users.buyer.id,
      {
        bank: "VCB Buyer",
        account: "654321",
        url: "https://pay.example/buyer",
        logo: "",
        bankCode: "970422",
        accountName: "Buyer User",
      },
    ],
  ]);

  const qrDataService = {
    getQr(userId) {
      return qrData.get(userId) || null;
    },
    setQr(userId, qrObj) {
      qrData.set(userId, qrObj);
    },
    deleteQr(userId) {
      qrData.delete(userId);
    },
    async saveQrDataToSheet() {},
    async loadQrDataFromSheet() {},
  };

  const categoriesService = {
    async getCategories() {
      return [
        {
          label: "Dich vu A",
          value: "service_a",
          desc: "Mo ta A",
          imageUrl: "",
        },
      ];
    },
  };

  const subItemsService = {
    async getSubItemsByCategory(config, categoryValue) {
      if (categoryValue !== "service_a") return [];
      return [
        {
          subName: "Goi 1",
          subPrice: "100.000 VND",
          subDesc: "Co ban",
          groupEmoji: "?",
        },
      ];
    },
  };

  let capital = 389381;
  async function loadCapitalFromSheet() {
    return capital;
  }
  function getCapitalData() {
    return capital;
  }
  async function saveCapitalToSheet(amount) {
    capital = Number(amount);
    return capital;
  }

  class FakeAttachmentBuilder {
    constructor(payload, options = {}) {
      this.payload = payload;
      this.options = options;
    }
  }

  const client = {
    commands: new Collection(),
    users: {
      async fetch(id) {
        if (usersMap.has(id)) return usersMap.get(id);
        return createUser(id, `User${String(id).slice(-4)}`);
      },
    },
    channels: {
      cache: new Map(),
      async fetch(id) {
        return this.cache.get(id) || null;
      },
    },
    guilds: {
      cache: new Map(),
    },
  };

  const guild = {
    id: "guild_test_1",
    name: "Test Guild",
    members: {
      async fetch(id) {
        const user = usersMap.get(id) || createUser(id, `User${String(id).slice(-4)}`);
        return { user };
      },
    },
    commands: {
      async set() {},
    },
  };

  client.guilds.cache.set(guild.id, guild);

  const defaultChannel = {
    id: "channel_test_1",
    _messageStore: new Map(),
    isTextBased() {
      return true;
    },
    createMessageComponentCollector() {
      return new MockCollector();
    },
    messages: {
      async fetch(id) {
        return defaultChannel._messageStore.get(id) || null;
      },
    },
    async send(payload) {
      const message = new MockMessage({ channel: defaultChannel });
      if (payload?.content !== undefined) message.content = payload.content;
      if (payload?.components) message.components = payload.components;
      if (payload?.embeds) message.embeds = payload.embeds;
      defaultChannel._messageStore.set(message.id, message);
      return message;
    },
  };
  client.channels.cache.set(defaultChannel.id, defaultChannel);

  const settings = new Map();
  const feedbackRows = [];

  const config = {
    TOKEN: "test-token",
    GUILD_ID: guild.id,
    ADMIN_ROLES: ["Admin"],
    SHEETS_ID: "SHEET_TEST",
    logger,
    qrDataService,
    paymentService,
    categoriesService,
    subItemsService,
    QRCode: {
      async toBuffer() {
        return Buffer.from("mock-qr");
      },
    },
    AttachmentBuilder: FakeAttachmentBuilder,
    createQrEmbed(qrObj) {
      return { type: "qr-embed", qrObj };
    },
    createEditButtons(userId) {
      return { type: "edit-buttons", userId };
    },
    createEditModal(customId, title, placeholder = "") {
      return { customId, title, placeholder };
    },
    createFeedbackThanksEmbed(username) {
      return { type: "thanks-embed", username };
    },
    createFeedbackPublicEmbed(payload) {
      return { type: "public-feedback-embed", payload };
    },
    async appendFeedback(spreadsheetId, payload) {
      feedbackRows.push({ spreadsheetId, payload });
    },
    async getSetting(spreadsheetId, key) {
      void spreadsheetId;
      return settings.get(key) || null;
    },
    async setSetting(spreadsheetId, key, value) {
      void spreadsheetId;
      settings.set(key, value);
    },
    async clearSetting(spreadsheetId, key) {
      void spreadsheetId;
      settings.delete(key);
    },
    parseCustomId,
    getCapitalData,
    loadCapitalFromSheet,
    saveCapitalToSheet,
    FEEDBACK_CHANNEL_ID: defaultChannel.id,
  };

  function createInteraction({
    type = "chat",
    commandName = null,
    customId = null,
    optionValues = {},
    fieldValues = {},
    user = users.admin,
    isAdmin = true,
    channel = defaultChannel,
    message = null,
  } = {}) {
    const member = {
      permissions: {
        has() {
          return isAdmin;
        },
      },
      roles: {
        cache: isAdmin ? [{ name: "Admin" }] : [],
      },
    };

    return new MockInteraction({
      type,
      commandName,
      customId,
      optionValues,
      fieldValues,
      user,
      member,
      client,
      guild,
      channel,
      message,
    });
  }

  return {
    config,
    users,
    client,
    guild,
    state: {
      payments,
      qrData,
      logs,
      settings,
      feedbackRows,
      paymentSheetOps,
      get capital() {
        return capital;
      },
    },
    createInteraction,
  };
}

module.exports = {
  createMockContext,
  createUser,
  MockCollector,
};
