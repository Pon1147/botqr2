const { handleSlashCommand } = require("./interactionDispatcher");
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
const { handleCapitalModal, isCapitalModal } = require("../flows/capitalFlow");

async function handleInteraction(interaction, config) {
  if (interaction.isChatInputCommand()) {
    return handleSlashCommand(interaction, config);
  }

  if (interaction.isButton()) {
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
