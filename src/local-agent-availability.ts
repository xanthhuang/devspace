import {
  LOCAL_AGENT_PROVIDERS,
  type LocalAgentProvider,
} from "./local-agent-profiles.js";
import { resolveExecutableCommand } from "./local-agent-command.js";
import { claudeUnsandboxedWindowsEnabled } from "./local-agent-claude.js";
import {
  localAgentProviderEnvironment,
  type SubagentsConfig,
} from "./local-agent-config.js";

export interface LocalAgentProviderAvailability {
  name: LocalAgentProvider;
  available: boolean;
  reason?: string;
  note?: string;
}

export function getLocalAgentProviderAvailabilitySnapshot(
  env: NodeJS.ProcessEnv = process.env,
  config?: SubagentsConfig,
): LocalAgentProviderAvailability[] {
  return LOCAL_AGENT_PROVIDERS.map((provider) => (
    checkLocalAgentProviderAvailability(provider, env, config)
  ));
}

function checkLocalAgentProviderAvailability(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv = process.env,
  config?: SubagentsConfig,
): LocalAgentProviderAvailability {
  const providerEnv = config ? localAgentProviderEnvironment(config, provider, env) : env;
  switch (provider) {
    case "codex":
      return codexAvailability(providerEnv);
    case "claude":
      return claudeAvailability(providerEnv);
    case "opencode":
      return packageAvailability(provider, "@opencode-ai/sdk/v2");
    case "pi":
      return packageAvailability(provider, "@earendil-works/pi-coding-agent");
    case "cursor":
      return commandAvailability(provider, providerEnv.CURSOR_COMMAND ?? "cursor-agent", providerEnv);
    case "copilot":
      return commandAvailability(provider, providerEnv.COPILOT_COMMAND ?? "copilot", providerEnv);
    case "grok":
      return commandAvailability(provider, providerEnv.GROK_COMMAND ?? "grok", providerEnv);
  }
}

export function assertLocalAgentProviderAvailable(
  provider: LocalAgentProvider,
  env: NodeJS.ProcessEnv = process.env,
  config?: SubagentsConfig,
): void {
  const availability = checkLocalAgentProviderAvailability(provider, env, config);
  if (availability.available) return;
  throw new Error(
    `${provider} provider is not available: ${availability.reason ?? "provider preflight failed"}`,
  );
}

function packageAvailability(
  provider: LocalAgentProvider,
  packageName: string,
): LocalAgentProviderAvailability {
  try {
    import.meta.resolve(packageName);
    return { name: provider, available: true };
  } catch {
    return {
      name: provider,
      available: false,
      reason: `${packageName} package not found`,
    };
  }
}

function codexAvailability(env: NodeJS.ProcessEnv): LocalAgentProviderAvailability {
  const availability = commandAvailability("codex", env.CODEX_COMMAND ?? "codex", env);
  return availability.available
    ? {
        ...availability,
        note: "available",
      }
    : availability;
}

function claudeAvailability(env: NodeJS.ProcessEnv): LocalAgentProviderAvailability {
  const availability = env.CLAUDE_COMMAND
    ? commandAvailability("claude", env.CLAUDE_COMMAND, env)
    : packageAvailability("claude", "@anthropic-ai/claude-agent-sdk");
  if (!availability.available) return availability;
  if (process.platform !== "win32" || claudeUnsandboxedWindowsEnabled(env)) return availability;
  return {
    name: "claude",
    available: false,
    reason: [
      "native Windows restricted execution requires Claude sandbox support; run under WSL2 or set",
      "DEVSPACE_CLAUDE_ALLOW_UNSANDBOXED_WINDOWS=1 to explicitly accept unsandboxed shell authority",
    ].join(" "),
  };
}

function commandAvailability(
  provider: LocalAgentProvider,
  command: string,
  env: NodeJS.ProcessEnv,
): LocalAgentProviderAvailability {
  if (resolveExecutableCommand(command, env)) return { name: provider, available: true };
  return {
    name: provider,
    available: false,
    reason: `${command} executable not found`,
  };
}
