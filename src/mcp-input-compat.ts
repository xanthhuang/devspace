type JsonRpcId = string | number | null;

type AliasMap = Readonly<Record<string, string>>;

const LEGACY_TOOL_ARGUMENT_ALIASES: Readonly<Record<string, AliasMap>> = {
  open_workspace: {
    baseRef: "base_ref",
  },
  read: {
    workspaceId: "workspace_id",
  },
  write: {
    workspaceId: "workspace_id",
  },
  edit: {
    workspaceId: "workspace_id",
  },
  bash: {
    workspaceId: "workspace_id",
    workingDirectory: "working_directory",
  },
  apply_patch: {
    workspaceId: "workspace_id",
  },
  exec_command: {
    workspaceId: "workspace_id",
    workingDirectory: "working_directory",
    yieldTimeMs: "yield_time_ms",
    maxOutputTokens: "max_output_tokens",
  },
  write_stdin: {
    workspaceId: "workspace_id",
    sessionId: "session_id",
    yieldTimeMs: "yield_time_ms",
    maxOutputTokens: "max_output_tokens",
  },
  show_changes: {
    workspaceId: "workspace_id",
  },
  download_artifact: {
    workspaceId: "workspace_id",
  },
} as const;

export class LegacyMcpArgumentConflictError extends Error {
  readonly requestId: JsonRpcId;
  readonly toolName: string;
  readonly legacyName: string;
  readonly canonicalName: string;

  constructor(
    requestId: JsonRpcId,
    toolName: string,
    legacyName: string,
    canonicalName: string,
  ) {
    super(
      `Conflicting tool arguments for ${toolName}: ${legacyName} and ${canonicalName} must match when both are provided.`,
    );
    this.name = "LegacyMcpArgumentConflictError";
    this.requestId = requestId;
    this.toolName = toolName;
    this.legacyName = legacyName;
    this.canonicalName = canonicalName;
  }
}

export function normalizeLegacyMcpToolArguments(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map((entry) => normalizeJsonRpcMessage(entry));
  }
  return normalizeJsonRpcMessage(body);
}

function normalizeJsonRpcMessage(message: unknown): unknown {
  if (!isRecord(message) || message.method !== "tools/call") return message;
  if (!isRecord(message.params) || typeof message.params.name !== "string") return message;
  if (!isRecord(message.params.arguments)) return message;

  const aliases = LEGACY_TOOL_ARGUMENT_ALIASES[message.params.name];
  if (!aliases) return message;

  const requestId = jsonRpcId(message.id);
  let normalizedArguments = normalizeAliases(
    message.params.arguments,
    aliases,
    requestId,
    message.params.name,
  );
  if (message.params.name === "edit") {
    normalizedArguments = normalizeLegacyEditEntries(
      normalizedArguments,
      requestId,
      message.params.name,
    );
  }

  if (normalizedArguments === message.params.arguments) return message;
  return {
    ...message,
    params: {
      ...message.params,
      arguments: normalizedArguments,
    },
  };
}

function normalizeLegacyEditEntries(
  argumentsRecord: Record<string, unknown>,
  requestId: JsonRpcId,
  toolName: string,
): Record<string, unknown> {
  if (!Array.isArray(argumentsRecord.edits)) return argumentsRecord;
  let normalizedEdits: unknown[] | undefined;
  for (const [index, edit] of argumentsRecord.edits.entries()) {
    if (!isRecord(edit)) continue;
    const normalizedEdit = normalizeAliases(
      edit,
      { oldText: "old_text", newText: "new_text" },
      requestId,
      toolName,
    );
    if (normalizedEdit === edit) continue;
    normalizedEdits ??= [...argumentsRecord.edits];
    normalizedEdits[index] = normalizedEdit;
  }
  if (!normalizedEdits) return argumentsRecord;
  return { ...argumentsRecord, edits: normalizedEdits };
}

function normalizeAliases(
  record: Record<string, unknown>,
  aliases: AliasMap,
  requestId: JsonRpcId,
  toolName: string,
): Record<string, unknown> {
  let normalized: Record<string, unknown> | undefined;
  for (const [legacyName, canonicalName] of Object.entries(aliases)) {
    if (!Object.hasOwn(record, legacyName)) continue;

    const legacyValue = record[legacyName];
    if (Object.hasOwn(record, canonicalName) && !Object.is(record[canonicalName], legacyValue)) {
      throw new LegacyMcpArgumentConflictError(
        requestId,
        toolName,
        legacyName,
        canonicalName,
      );
    }

    normalized ??= { ...record };
    if (!Object.hasOwn(normalized, canonicalName)) {
      normalized[canonicalName] = legacyValue;
    }
    delete normalized[legacyName];
  }
  return normalized ?? record;
}

function jsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
