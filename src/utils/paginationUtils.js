const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function createPaginationRow({
  prevCustomId,
  nextCustomId,
  page,
  totalPages,
  prevLabel = "Trước",
  nextLabel = "Sau",
  buttonStyle = ButtonStyle.Secondary,
}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(prevCustomId)
      .setLabel(prevLabel)
      .setStyle(buttonStyle)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(nextCustomId)
      .setLabel(nextLabel)
      .setStyle(buttonStyle)
      .setDisabled(page >= totalPages - 1),
  );
}

function attachPaginationCollector({
  message,
  interaction,
  prevCustomId,
  nextCustomId,
  time = 300000,
  onPage,
  onEnd,
}) {
  const collector = message.createMessageComponentCollector({
    filter: (i) =>
      i.user.id === interaction.user.id &&
      (i.customId === prevCustomId || i.customId === nextCustomId),
    time,
  });

  collector.on("collect", async (i) => {
    await i.deferUpdate();
    await onPage(i);
  });

  if (typeof onEnd === "function") {
    collector.on("end", async (_, reason) => {
      await onEnd(reason);
    });
  }

  return collector;
}

module.exports = {
  attachPaginationCollector,
  createPaginationRow,
};
