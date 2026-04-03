const { MessageFlags } = require("discord.js");

function isAdmin(interaction, adminRoles = []) {
  return (
    interaction.member?.permissions.has("Administrator") ||
    adminRoles.some((roleName) =>
      interaction.member?.roles.cache.some((role) => role.name === roleName),
    )
  );
}

async function safeDeferReply(interaction, command) {
  const shouldAutoDefer = command.autoDefer !== false;
  if (!shouldAutoDefer) return true;

  const shouldBeEphemeral = command.ephemeral ?? false;
  const deferOptions = shouldBeEphemeral ? { flags: MessageFlags.Ephemeral } : {};

  try {
    await interaction.deferReply(deferOptions);
    return true;
  } catch (deferError) {
    const code = deferError?.code ?? deferError?.rawError?.code;
    if (
      code === 40060 ||
      /already been acknowledged/i.test(String(deferError?.message || ""))
    ) {
      return false;
    }
    throw deferError;
  }
}

async function handleSlashCommand(interaction, config) {
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  const { logger, SHEETS_ID, ADMIN_ROLES = [] } = config;

  try {
    if (command.adminOnly && !isAdmin(interaction, ADMIN_ROLES)) {
      return interaction.reply({
        content: "Bạn không có quyền admin!",
        ephemeral: true,
      });
    }

    const didDefer = await safeDeferReply(interaction, command);
    if (didDefer === false) {
      return;
    }
    await command.execute(interaction, config);
  } catch (error) {
    await logger.error(
      `Lỗi thực thi lệnh ${interaction.commandName}: ${error.message}\nStack: ${error.stack}`,
      SHEETS_ID,
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
}

module.exports = {
  handleSlashCommand,
  isAdmin,
  safeDeferReply,
};
