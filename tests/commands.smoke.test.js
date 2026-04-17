const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

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
        const command = require(fullPath);
        commands.push(command);
      }
    }
  }

  walk(root);
  return commands;
}

function scenarioFor(name, ctx) {
  switch (name) {
    case "capital":
      return {
        defer: false,
        user: ctx.users.admin,
        optionValues: {},
      };
    case "feedback-channel":
      return {
        defer: true,
        user: ctx.users.admin,
        optionValues: { action: "show" },
      };
    case "info":
      return {
        defer: true,
        user: ctx.users.admin,
        optionValues: {},
      };
    case "qr":
      return {
        defer: true,
        user: ctx.users.admin,
        optionValues: {},
      };
    case "menu":
      return {
        defer: true,
        user: ctx.users.admin,
        optionValues: {},
      };
    case "pay":
      return {
        defer: true,
        user: ctx.users.admin,
        optionValues: {
          buyer: ctx.users.buyer,
          amount: 120000,
          description: "test pay",
        },
      };
    case "remove":
      return {
        defer: true,
        user: ctx.users.admin,
        optionValues: { transaction_code: "TXCONF1", reason: "cleanup" },
      };
    case "history":
      return {
        defer: true,
        user: ctx.users.buyer,
        optionValues: {},
      };
    case "top":
      return {
        defer: true,
        user: ctx.users.buyer,
        optionValues: {},
      };
    default:
      throw new Error(`Missing scenario for command: ${name}`);
  }
}

const commands = loadCommands();

test("loads all command modules", () => {
  assert.equal(commands.length, 9);
  for (const command of commands) {
    assert.ok(command.data, "command.data must exist");
    assert.equal(typeof command.execute, "function", "command.execute must be function");
  }
});

for (const command of commands) {
  const name = command.data.name;

  test(`smoke /${name}`, async () => {
    const ctx = createMockContext();
    const scenario = scenarioFor(name, ctx);

    const interaction = ctx.createInteraction({
      type: "chat",
      commandName: name,
      optionValues: scenario.optionValues,
      user: scenario.user,
      isAdmin: true,
    });

    if (scenario.defer) {
      await interaction.deferReply({});
    }

    await command.execute(interaction, ctx.config);

    const hasResponse = interaction.responses.length > 0 || interaction.modalShown;
    assert.equal(hasResponse, true, `/${name} should emit a response`);
  });
}
