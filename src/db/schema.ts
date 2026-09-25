import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaceSessions = sqliteTable(
  "workspace_sessions",
  {
    id: text("id").primaryKey(),
    root: text("root").notNull(),
    status: text("status").notNull().default("active"),
    mode: text("mode").notNull().default("checkout"),
    sourceRoot: text("source_root"),
    baseRef: text("base_ref"),
    baseSha: text("base_sha"),
    managed: text("managed").notNull().default("false"),
    recoveryKind: text("recovery_kind"),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at").notNull(),
  },
  (table) => [
    index("workspace_sessions_root_idx").on(table.root, table.lastUsedAt),
    index("workspace_sessions_status_idx").on(table.status, table.lastUsedAt),
  ],
);

export const loadedAgentFiles = sqliteTable(
  "loaded_agent_files",
  {
    workspaceSessionId: text("workspace_session_id")
      .notNull()
      .references(() => workspaceSessions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    content: text("content").notNull(),
    loadedAt: text("loaded_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceSessionId, table.path] }),
    index("loaded_agent_files_path_idx").on(table.path),
  ],
);

export const workspaceConversationBindings = sqliteTable(
  "workspace_conversation_bindings",
  {
    conversationScopeId: text("conversation_scope_id").notNull(),
    targetKey: text("target_key").notNull(),
    workspaceSessionId: text("workspace_session_id")
      .notNull()
      .references(() => workspaceSessions.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationScopeId, table.targetKey] }),
    index("workspace_conversation_bindings_workspace_idx").on(table.workspaceSessionId),
  ],
);

export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    clientId: text("client_id").primaryKey(),
    clientJson: text("client_json").notNull(),
    issuedAt: integer("issued_at").notNull(),
  },
);

export const oauthAccessTokens = sqliteTable(
  "oauth_access_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    scopesJson: text("scopes_json").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resource: text("resource"),
  },
);

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    scopesJson: text("scopes_json").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resource: text("resource"),
  },
);

export const localAgentSessions = sqliteTable(
  "local_agent_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    workspaceRoot: text("workspace_root").notNull(),
    profileName: text("profile_name").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    effort: text("effort"),
    providerSessionId: text("provider_session_id"),
    status: text("status").notNull(),
    latestResponse: text("latest_response"),
    error: text("error"),
    errorCode: text("error_code"),
    errorRetryable: text("error_retryable"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("local_agent_sessions_workspace_id_idx").on(table.workspaceId, table.updatedAt),
    index("local_agent_sessions_workspace_root_idx").on(table.workspaceRoot, table.updatedAt),
    index("local_agent_sessions_provider_session_id_idx").on(table.providerSessionId),
  ],
);

export const localAgentUsageMetering = sqliteTable(
  "local_agent_usage_metering",
  {
    agentId: text("agent_id").notNull(),
    turnId: text("turn_id").notNull(),
    workspaceId: text("workspace_id"),
    workspaceRoot: text("workspace_root").notNull(),
    profileName: text("profile_name").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    effort: text("effort"),
    providerSessionId: text("provider_session_id"),
    meter: text("meter").notNull(),
    meterVersion: text("meter_version").notNull(),
    complete: text("complete").notNull(),
    snapshotInputTokens: integer("snapshot_input_tokens").notNull(),
    snapshotOutputTokens: integer("snapshot_output_tokens").notNull(),
    snapshotCacheCreationTokens: integer("snapshot_cache_creation_tokens").notNull(),
    snapshotCacheReadTokens: integer("snapshot_cache_read_tokens").notNull(),
    snapshotTotalTokens: integer("snapshot_total_tokens").notNull(),
    snapshotTotalCost: real("snapshot_total_cost").notNull(),
    snapshotModelsJson: text("snapshot_models_json").notNull(),
    deltaInputTokens: integer("delta_input_tokens").notNull(),
    deltaOutputTokens: integer("delta_output_tokens").notNull(),
    deltaCacheCreationTokens: integer("delta_cache_creation_tokens").notNull(),
    deltaCacheReadTokens: integer("delta_cache_read_tokens").notNull(),
    deltaTotalTokens: integer("delta_total_tokens").notNull(),
    deltaTotalCost: real("delta_total_cost").notNull(),
    deltaModelsJson: text("delta_models_json").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.turnId] }),
    index("local_agent_usage_metering_recorded_at_idx").on(table.recordedAt),
    index("local_agent_usage_metering_profile_idx").on(table.profileName, table.recordedAt),
    index("local_agent_usage_metering_provider_idx").on(table.provider, table.recordedAt),
    index("local_agent_usage_metering_session_idx").on(
      table.provider,
      table.providerSessionId,
      table.recordedAt,
    ),
  ],
);

export const agentEventOutbox = sqliteTable(
  "agent_event_outbox",
  {
    eventId: text("event_id").primaryKey(),
    transitionKey: text("transition_key").notNull(),
    type: text("type").notNull(),
    agentId: text("agent_id").notNull(),
    workspaceId: text("workspace_id"),
    workspaceRoot: text("workspace_root").notNull(),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id"),
    terminalStatus: text("terminal_status").notNull(),
    createdAt: text("created_at").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    deliveryState: text("delivery_state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    deliveredAt: text("delivered_at"),
  },
  (table) => [
    uniqueIndex("agent_event_outbox_transition_key_idx").on(table.transitionKey),
    index("agent_event_outbox_delivery_idx").on(table.deliveryState, table.createdAt),
    index("agent_event_outbox_agent_idx").on(table.agentId, table.createdAt),
  ],
);

export type WorkspaceSessionRow = typeof workspaceSessions.$inferSelect;
export type NewWorkspaceSessionRow = typeof workspaceSessions.$inferInsert;
export type LoadedAgentFileRow = typeof loadedAgentFiles.$inferSelect;
export type NewLoadedAgentFileRow = typeof loadedAgentFiles.$inferInsert;
export type WorkspaceConversationBindingRow = typeof workspaceConversationBindings.$inferSelect;
export type NewWorkspaceConversationBindingRow = typeof workspaceConversationBindings.$inferInsert;
export type LocalAgentSessionRow = typeof localAgentSessions.$inferSelect;
export type NewLocalAgentSessionRow = typeof localAgentSessions.$inferInsert;
