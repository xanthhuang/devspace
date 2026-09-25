import * as z from "zod/v4";
import type { DurableJobRecord, JobLogsResult } from "../durable-jobs.js";
import {
  SHELL_TOOL_ANNOTATIONS,
  workspaceIdDescription,
  type ToolRegistrationContext,
} from "./types.js";
import { textBlock } from "./shared.js";

const jobStatusSchema = {
  job_id: z.string(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  pid: z.number().int().nullable(),
  pgid: z.number().int().nullable(),
  exit_code: z.number().int().nullable(),
  signal: z.string().nullable(),
  created_at: z.number().int(),
  started_at: z.number().int().nullable(),
  ended_at: z.number().int().nullable(),
  max_runtime_seconds: z.number().positive(),
  cancellation_requested_at: z.number().int().nullable(),
  cancellation_signal_sent_at: z.number().int().nullable(),
  cancellation_verified_at: z.number().int().nullable(),
  error: z.string().nullable(),
  result: z.string().nullable(),
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function registerDurableJobTools(context: ToolRegistrationContext): void {
  const { server, workspaces, durableJobs } = context;

  server.registerTool(
    "job_start",
    {
      title: "Start durable job",
      description:
        "Start a detached shell command that continues across MCP disconnects and DevSpace restarts. Returns immediately with a durable job ID.",
      inputSchema: {
        workspace_id: z.string().describe(workspaceIdDescription),
        command: z.string().min(1).describe("Shell command to execute."),
        working_directory: z.string().optional().describe("Directory relative to the workspace root."),
        max_runtime_seconds: z.number().int().positive().optional().describe("Maximum runtime in seconds. Defaults to 86400."),
      },
      outputSchema: jobStatusSchema,
      annotations: SHELL_TOOL_ANNOTATIONS,
    },
    async ({ workspace_id, command, working_directory, max_runtime_seconds }) => {
      const workspace = await workspaces.getWorkspace(workspace_id);
      const cwd = await workspaces.resolveWorkingDirectory(workspace, working_directory);
      const job = await durableJobs.start({
        workspaceId: workspace_id,
        workspaceRoot: workspace.canonicalRoot,
        command,
        workingDirectory: cwd,
        maxRuntimeSeconds: max_runtime_seconds,
      });
      return jobResponse(job, `Started durable job ${job.id} with status ${job.status}.`);
    },
  );

  server.registerTool(
    "job_status",
    {
      title: "Get durable job status",
      description: "Read the current status and terminal result of a durable job.",
      inputSchema: jobIdentityInput(),
      outputSchema: jobStatusSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workspace_id, job_id }) => {
      const workspace = await workspaces.getWorkspace(workspace_id);
      const job = await durableJobs.status(job_id, workspace.canonicalRoot);
      return jobResponse(job, formatJob(job));
    },
  );

  server.registerTool(
    "job_logs",
    {
      title: "Read durable job logs",
      description: "Read a bounded byte range or tail of a durable job's combined stdout and stderr log.",
      inputSchema: {
        ...jobIdentityInput(),
        offset: z.number().int().nonnegative().optional().describe("Byte offset. Defaults to 0."),
        max_bytes: z.number().int().positive().max(512 * 1024).optional().describe("Maximum bytes to return. Defaults to 65536."),
        tail: z.boolean().optional().describe("Read the last max_bytes when offset is omitted."),
      },
      outputSchema: {
        job_id: z.string(),
        content: z.string(),
        offset: z.number().int().nonnegative(),
        next_offset: z.number().int().nonnegative(),
        total_bytes: z.number().int().nonnegative(),
        has_more: z.boolean(),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ workspace_id, job_id, offset, max_bytes, tail }) => {
      const workspace = await workspaces.getWorkspace(workspace_id);
      const logs = await durableJobs.logs(job_id, workspace.canonicalRoot, {
        offset,
        maxBytes: max_bytes,
        tail,
      });
      return logsResponse(logs);
    },
  );

  server.registerTool(
    "job_wait",
    {
      title: "Wait for durable job",
      description: "Wait for a completion event for at most 45 seconds and include a small terminal log tail.",
      inputSchema: {
        ...jobIdentityInput(),
        timeout_seconds: z.number().nonnegative().max(45).optional().describe("Bounded wait. Defaults to 25 seconds; maximum 45."),
      },
      outputSchema: {
        ...jobStatusSchema,
        timed_out: z.boolean(),
        tail: z.string(),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ workspace_id, job_id, timeout_seconds }) => {
      const workspace = await workspaces.getWorkspace(workspace_id);
      const waited = await durableJobs.wait(job_id, workspace.canonicalRoot, timeout_seconds);
      const status = serializeJob(waited.job);
      const text = waited.timedOut
        ? `Job ${job_id} is still running after the bounded wait.`
        : `${formatJob(waited.job)}${waited.tail ? `\n\n${waited.tail}` : ""}`;
      return {
        content: [textBlock(text)],
        structuredContent: { ...status, timed_out: waited.timedOut, tail: waited.tail },
      };
    },
  );

  server.registerTool(
    "job_cancel",
    {
      title: "Cancel durable job",
      description: "Request cancellation and report cancelled only after the original process is verified gone.",
      inputSchema: jobIdentityInput(),
      outputSchema: {
        ...jobStatusSchema,
        cancelled: z.boolean(),
        cancellation_error: z.string().optional(),
      },
      annotations: SHELL_TOOL_ANNOTATIONS,
    },
    async ({ workspace_id, job_id }) => {
      const workspace = await workspaces.getWorkspace(workspace_id);
      const cancelled = await durableJobs.cancel(job_id, workspace.canonicalRoot);
      const text = cancelled.cancelled
        ? `Cancellation of job ${job_id} was verified.`
        : cancelled.error ?? `Job ${job_id} was not cancelled.`;
      return {
        content: [textBlock(text)],
        structuredContent: {
          ...serializeJob(cancelled.job),
          cancelled: cancelled.cancelled,
          ...(cancelled.error ? { cancellation_error: cancelled.error } : {}),
        },
      };
    },
  );
}

function jobIdentityInput() {
  return {
    workspace_id: z.string().describe(workspaceIdDescription),
    job_id: z.string().describe("Durable job ID returned by job_start."),
  };
}

function serializeJob(job: DurableJobRecord) {
  return {
    job_id: job.id,
    status: job.status,
    pid: job.pid,
    pgid: job.pgid,
    exit_code: job.exitCode,
    signal: job.signal,
    created_at: job.createdAt,
    started_at: job.startedAt,
    ended_at: job.endedAt,
    max_runtime_seconds: job.maxRuntimeSeconds,
    cancellation_requested_at: job.cancellationRequestedAt,
    cancellation_signal_sent_at: job.cancellationSignalSentAt,
    cancellation_verified_at: job.cancellationVerifiedAt,
    error: job.error,
    result: job.result,
  };
}

function jobResponse(job: DurableJobRecord, text: string) {
  return { content: [textBlock(text)], structuredContent: serializeJob(job) };
}

function logsResponse(logs: JobLogsResult) {
  return {
    content: [textBlock(logs.content)],
    structuredContent: {
      job_id: logs.jobId,
      content: logs.content,
      offset: logs.offset,
      next_offset: logs.nextOffset,
      total_bytes: logs.totalBytes,
      has_more: logs.hasMore,
    },
  };
}

function formatJob(job: DurableJobRecord): string {
  if (job.status === "running") return `Job ${job.id} is running.`;
  if (job.status === "succeeded") return `Job ${job.id} succeeded with exit code ${job.exitCode ?? 0}.`;
  if (job.status === "cancelled") return `Job ${job.id} was cancelled.`;
  return `Job ${job.id} failed${job.exitCode === null ? "" : ` with exit code ${job.exitCode}`}${job.error ? `: ${job.error}` : "."}`;
}
