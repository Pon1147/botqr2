const fs = require("fs");
const path = require("path");

function discoverCommandFiles(rootDir, collected = []) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      discoverCommandFiles(fullPath, collected);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      collected.push(fullPath);
    }
  }

  return collected;
}

function isValidCommandShape(command) {
  return Boolean(
    command &&
      command.data &&
      typeof command.data.name === "string" &&
      typeof command.execute === "function",
  );
}

function createLazyCommandProxy(filePath, commandMeta) {
  let runtimeCommand = null;

  const loadRuntimeCommand = () => {
    if (runtimeCommand) return runtimeCommand;

    delete require.cache[require.resolve(filePath)];
    const latestCommand = require(filePath);
    if (!isValidCommandShape(latestCommand)) {
      throw new Error(`Invalid command export at ${filePath}`);
    }

    runtimeCommand = latestCommand;
    return runtimeCommand;
  };

  return {
    data: commandMeta.data,
    adminOnly: commandMeta.adminOnly,
    ephemeral: commandMeta.ephemeral,
    autoDefer: commandMeta.autoDefer,
    async execute(interaction, config) {
      const command = loadRuntimeCommand();
      return command.execute(interaction, config);
    },
  };
}

function loadCommands({
  commandsPath,
  commands,
  lazyExecute = true,
  logger = console,
}) {
  if (!commandsPath || !commands) {
    throw new Error("loadCommands requires both commandsPath and commands");
  }

  const absoluteCommandsPath = path.resolve(commandsPath);
  const commandFiles = discoverCommandFiles(absoluteCommandsPath).sort((a, b) =>
    a.localeCompare(b),
  );

  const stats = {
    files: commandFiles.length,
    loaded: 0,
    invalid: 0,
    duplicates: 0,
  };

  for (const filePath of commandFiles) {
    let commandModule;

    try {
      delete require.cache[require.resolve(filePath)];
      commandModule = require(filePath);
    } catch (error) {
      stats.invalid += 1;
      logger.warn(
        `[CMD] Failed to load ${filePath}: ${error.message || String(error)}`,
      );
      continue;
    }

    if (!isValidCommandShape(commandModule)) {
      stats.invalid += 1;
      logger.warn(`[CMD] Invalid command shape: ${filePath}`);
      continue;
    }

    const commandName = commandModule.data.name;
    if (commands.has(commandName)) {
      stats.duplicates += 1;
      logger.warn(`[CMD] Duplicate command name "${commandName}" at ${filePath}`);
      continue;
    }

    const command = lazyExecute
      ? createLazyCommandProxy(filePath, commandModule)
      : commandModule;

    commands.set(commandName, command);
    stats.loaded += 1;
    logger.log?.(`[CMD] Loaded: ${commandName}`);

    if (lazyExecute) {
      delete require.cache[require.resolve(filePath)];
    }
  }

  return stats;
}

module.exports = {
  discoverCommandFiles,
  loadCommands,
};
