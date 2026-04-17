const { handleSlashCommand } = require("./interactionDispatcher");
const {
  handleInfoButton,
  handleInfoSelectMenu,
  isInfoButton,
  isInfoSelectMenu,
} = require("../flows/infoFlow");
const {
  handlePayButton,
  handlePayModal,
  isPaymentButton,
  isPaymentModal,
} = require("../flows/paymentFlow");
const {
  handleFeedbackModal,
  handleFeedbackRateButton,
  isFeedbackModal,
  isFeedbackRateButton,
} = require("../flows/feedbackFlow");
const {
  handleQrButton,
  handleQrModal,
  isQrButton,
  isQrModal,
} = require("../flows/qrFlow");
const {
  handleCapitalButton,
  handleCapitalModal,
  isCapitalButton,
  isCapitalModal,
} = require("../flows/capitalFlow");

async function handleInteraction(interaction, config) {
  if (interaction.isChatInputCommand()) {
    return handleSlashCommand(interaction, config);
  }

  if (interaction.isButton()) {
    if (isInfoButton(interaction.customId)) {
      return handleInfoButton(interaction, config);
    }

    if (isCapitalButton(interaction.customId)) {
      return handleCapitalButton(interaction, config);
    }

    if (isPaymentButton(interaction.customId)) {
      return handlePayButton(interaction, config);
    }

    if (isFeedbackRateButton(interaction.customId)) {
      return handleFeedbackRateButton(interaction, config);
    }

    if (isQrButton(interaction.customId)) {
      return handleQrButton(interaction, config);
    }

    return;
  }

  const isStringSelectMenu =
    typeof interaction.isStringSelectMenu === "function" &&
    interaction.isStringSelectMenu();
  const isUserSelectMenu =
    typeof interaction.isUserSelectMenu === "function" &&
    interaction.isUserSelectMenu();

  if (isStringSelectMenu || isUserSelectMenu) {
    if (isInfoSelectMenu(interaction.customId)) {
      return handleInfoSelectMenu(interaction, config);
    }
  }

  if (interaction.isModalSubmit()) {
    if (isPaymentModal(interaction.customId)) {
      return handlePayModal(interaction, config);
    }

    if (isFeedbackModal(interaction.customId)) {
      return handleFeedbackModal(interaction, config);
    }

    if (isCapitalModal(interaction.customId)) {
      return handleCapitalModal(interaction, config);
    }

    if (isQrModal(interaction.customId)) {
      return handleQrModal(interaction, config);
    }
  }
}

module.exports = {
  handleInteraction,
};
