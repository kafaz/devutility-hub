import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveBaseUrl(): string {
  if (process.env.DEVUTILITY_AGENT_BASE_URL) {
    return process.env.DEVUTILITY_AGENT_BASE_URL;
  }
  try {
    const portFilePath = resolve(__dirname, '../../.runtime-port');
    const port = readFileSync(portFilePath, 'utf8').trim();
    if (/^\d+$/.test(port)) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // .runtime-port 不存在，使用默认值
  }
  return "http://127.0.0.1:3001";
}

const BASE_URL = resolveBaseUrl();

type JsonRecord = Record<string, unknown>;
const looseObjectSchema = z.record(z.string(), z.unknown());
const targetAssertionSchema = z.object({
  nodeId: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  username: z.string().min(1).optional(),
}).refine(
  (target) => Boolean(target.nodeId || target.host),
  { message: "target must include nodeId or host" }
);

function unwrapPayload(payload: JsonRecord) {
  const preferredKeys = [
    "data",
    "result",
    "sessions",
    "presets",
    "policy",
    "run",
    "matches",
    "agents",
  ] as const;

  for (const key of preferredKeys) {
    if (payload[key] !== undefined) return payload[key];
  }

  if (payload.ok === true) {
    const keys = Object.keys(payload).filter((key) => key !== "ok");
    if (keys.length === 1) {
      return payload[keys[0]];
    }
  }

  return payload;
}

async function requestApi(
  method: string,
  path: string,
  body?: JsonRecord,
  options: { allowPolicyBlock?: boolean; timeoutMs?: number } = {}
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({
      ok: false,
      error: `API returned non-JSON response: HTTP ${response.status}`,
    }));

    if (!response.ok || payload.ok === false) {
      if (
        (options.allowPolicyBlock || response.status === 409) &&
        (response.status === 403 || response.status === 409) &&
        payload &&
        typeof payload === "object" &&
        "data" in payload
      ) {
        return (payload as JsonRecord).data;
      }
      throw new Error(String(payload.error || `HTTP ${response.status}`));
    }

    return unwrapPayload(payload as JsonRecord);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时（${(options.timeoutMs ?? 60000) / 1000}s）: ${method} ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatResult(title: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${title}\n${JSON.stringify(data)}`,
      },
    ],
  };
}

const server = new McpServer({
  name: "devutility-hub-agent",
  version: "0.1.0",
});

server.tool(
  "health_check",
  "Check whether the local DevUtility Hub service is reachable.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/health");
    return formatResult("Health check", data);
  }
);

server.tool(
  "list_ssh_agents",
  "List local SSH agent sockets or agent providers that DevUtility Hub can use for agent-based authentication.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agents");
    return formatResult("SSH agents", data);
  }
);

server.tool(
  "list_login_presets",
  "List saved login presets that can be used for preset-based auto-login.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agent/login-presets");
    return formatResult("Login presets", data);
  }
);

server.tool(
  "save_login_preset",
  "Create or update a login preset. preset must include id, name, host, username, and authType.",
  {
    preset: looseObjectSchema,
  },
  async ({ preset }) => {
    const data = await requestApi("POST", "/api/agent/login-presets", preset);
    return formatResult("Saved login preset", data);
  }
);

server.tool(
  "delete_login_preset",
  "Delete a saved login preset by preset id.",
  {
    presetId: z.string().min(1),
  },
  async ({ presetId }) => {
    const data = await requestApi("DELETE", `/api/agent/login-presets/${encodeURIComponent(presetId)}`);
    return formatResult("Deleted login preset", data);
  }
);

server.tool(
  "list_nodes",
  "List locally registered SSH nodes with nodeId, name, IP, role, tags, and prepare profile.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agent/nodes");
    return formatResult("Registered nodes", data);
  }
);

server.tool(
  "save_node",
  "Create or update a registered node. node must include nodeId, name, host, and username.",
  {
    node: looseObjectSchema,
  },
  async ({ node }) => {
    const data = await requestApi("POST", "/api/agent/nodes", node);
    return formatResult("Saved node", data);
  }
);

server.tool(
  "delete_node",
  "Delete a registered node by nodeId.",
  {
    nodeId: z.string().min(1),
  },
  async ({ nodeId }) => {
    const data = await requestApi("DELETE", `/api/agent/nodes/${encodeURIComponent(nodeId)}`);
    return formatResult("Deleted node", data);
  }
);

server.tool(
  "update_node",
  "Patch an existing registered node by nodeId.",
  {
    nodeId: z.string().min(1),
    patch: looseObjectSchema,
  },
  async ({ nodeId, patch }) => {
    const data = await requestApi("PATCH", `/api/agent/nodes/${encodeURIComponent(nodeId)}`, patch);
    return formatResult("Updated node", data);
  }
);

server.tool(
  "resolve_node",
  "Resolve a node alias, node name, role, tag, or IP into a concrete registered node.",
  {
    query: z.string().min(1),
  },
  async ({ query }) => {
    const data = await requestApi("POST", "/api/agent/nodes/resolve", { query });
    return formatResult("Resolved node", data);
  }
);

server.tool(
  "save_prepare_profile",
  "Create or update a prepare profile. profile must include profileId and name.",
  {
    profile: looseObjectSchema,
  },
  async ({ profile }) => {
    const data = await requestApi("POST", "/api/agent/prepare-profiles", profile);
    return formatResult("Saved prepare profile", data);
  }
);

server.tool(
  "delete_prepare_profile",
  "Delete a prepare profile by profileId.",
  {
    profileId: z.string().min(1),
  },
  async ({ profileId }) => {
    const data = await requestApi("DELETE", `/api/agent/prepare-profiles/${encodeURIComponent(profileId)}`);
    return formatResult("Deleted prepare profile", data);
  }
);

server.tool(
  "update_prepare_profile",
  "Patch an existing prepare profile by profileId.",
  {
    profileId: z.string().min(1),
    patch: looseObjectSchema,
  },
  async ({ profileId, patch }) => {
    const data = await requestApi("PATCH", `/api/agent/prepare-profiles/${encodeURIComponent(profileId)}`, patch);
    return formatResult("Updated prepare profile", data);
  }
);

server.tool(
  "list_prepare_profiles",
  "List available prepare profiles that can run pre-operations after a session is opened.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agent/prepare-profiles");
    return formatResult("Prepare profiles", data);
  }
);

server.tool(
  "get_command_policy",
  "Get the current service-side command whitelist and fixed blocking rules.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agent/command-policy");
    return formatResult("Command policy", data);
  }
);

server.tool(
  "validate_command",
  "Validate a remote command against the service-side whitelist before running it. Use this when a command is not a trivial known-good read-only probe.",
  {
    cmd: z.string().min(1),
    context: z.string().optional(),
  },
  async ({ cmd, context }) => {
    const data = await requestApi("POST", "/api/agent/command-policy/validate", {
      cmd,
      context: context || "mcp-preflight",
    });
    return formatResult("Command policy validation", data);
  }
);

server.tool(
  "replace_command_policy",
  "Replace the full command whitelist with the provided allowedBaseCommands array.",
  {
    allowedBaseCommands: z.array(z.string().min(1)).min(1),
  },
  async ({ allowedBaseCommands }) => {
    const data = await requestApi("PUT", "/api/agent/command-policy", { allowedBaseCommands });
    return formatResult("Replaced command policy", data);
  }
);

server.tool(
  "allow_command",
  "Allow one additional base command in the service-side command whitelist.",
  {
    command: z.string().min(1),
  },
  async ({ command }) => {
    const data = await requestApi("POST", "/api/agent/command-policy/allow", { command });
    return formatResult("Allowed command", data);
  }
);

server.tool(
  "remove_allowed_command",
  "Remove one base command from the service-side command whitelist.",
  {
    command: z.string().min(1),
  },
  async ({ command }) => {
    const data = await requestApi("DELETE", `/api/agent/command-policy/allow/${encodeURIComponent(command)}`);
    return formatResult("Removed command", data);
  }
);

server.tool(
  "reset_command_policy",
  "Reset the command whitelist back to the service default.",
  {},
  async () => {
    const data = await requestApi("POST", "/api/agent/command-policy/reset");
    return formatResult("Reset command policy", data);
  }
);

server.tool(
  "open_session",
  "Open or reuse an SSH session. Use presetId for preset-based auto-login, otherwise use nodeId, connection/auth, or direct host/username/password fields.",
  {
    presetId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    nodeId: z.string().optional(),
    name: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    username: z.string().optional(),
    authType: z.enum(["privateKey", "password", "agent"]).optional(),
    password: z.string().optional(),
    keyContent: z.string().optional(),
    keyFilePath: z.string().optional(),
    passphrase: z.string().optional(),
    agent: z.string().optional(),
    readyTimeout: z.number().int().positive().optional(),
    jumpHostId: z.string().optional(),
    jumpHost: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().optional(),
    reuseIfExists: z.boolean().optional(),
    ttlSec: z.number().int().positive().optional(),
    connection: z.record(z.string(), z.unknown()).optional(),
    auth: z.record(z.string(), z.unknown()).optional(),
    jumpAuth: z.record(z.string(), z.unknown()).optional(),
  },
  async (input) => {
    const route = input.presetId ? "/api/agent/connect" : "/api/agent/sessions/open";
    const data = await requestApi("POST", route, input);
    return formatResult("Opened session", data);
  }
);

server.tool(
  "list_sessions",
  "List currently active SSH sessions that the local gateway can use.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agent/sessions");
    return formatResult("Active sessions", data);
  }
);

server.tool(
  "get_session",
  "Get a single active session by sessionId.",
  {
    sessionId: z.string().min(1),
  },
  async ({ sessionId }) => {
    const data = await requestApi("GET", `/api/agent/sessions/${encodeURIComponent(sessionId)}`);
    return formatResult("Session detail", data);
  }
);


server.tool(
  "get_session_logs",
  "Get recent Agent session activity logs, including command execution and returned stdout/stderr snapshots.",
  {
    sessionId: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
  },
  async ({ sessionId, limit }) => {
    const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
    const data = await requestApi(
      "GET",
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/logs${query}`
    );
    return formatResult("Session logs", data);
  }
);

server.tool(
  "prepare_session",
  "Run pre-operation steps inside an existing PTY-backed session. Use profileId when possible, or pass explicit steps.",
  {
    sessionId: z.string().min(1),
    target: targetAssertionSchema,
    profileId: z.string().optional(),
    continueOnError: z.boolean().optional(),
    variables: z.record(z.string(), z.string()).optional(),
    steps: z.array(
      z.object({
        name: z.string().optional(),
        cmd: z.string(),
        timeoutMs: z.number().int().positive().optional(),
        captureVar: z.string().optional(),
        capturePattern: z.string().optional(),
        normalRegex: z.string().optional(),
        abnormalRegex: z.string().optional(),
        scriptPath: z.string().optional(),
      })
    ).optional(),
  },
  async ({ sessionId, ...body }) => {
    const data = await requestApi(
      "POST",
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/prepare`,
      { ...body, requireTarget: true }
    );
    return formatResult("Prepare result", data);
  }
);

server.tool(
  "run_command",
  "Run a command in an SSH session and return stdout, stderr, exitCode, and duration. Use mode=pty to keep shell context or mode=exec for stateless execution.",
  {
    sessionId: z.string().min(1),
    target: targetAssertionSchema,
    cmd: z.string().min(1),
    timeoutMs: z.number().int().positive().optional(),
    mode: z.enum(["pty", "exec"]).optional(),
  },
  async ({ sessionId, ...body }) => {
    const data = await requestApi(
      "POST",
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/commands`,
      { ...body, requireTarget: true },
      { allowPolicyBlock: true }
    );
    return formatResult("Command result", data);
  }
);

server.tool(
  "run_commands_batch",
  "Run multiple commands in sequence within the same SSH session. Returns all results at once, reducing round-trips. Use this instead of multiple run_command calls when you need to execute several commands.",
  {
    sessionId: z.string().min(1),
    target: targetAssertionSchema,
    commands: z.array(
      z.object({
        cmd: z.string().min(1),
        timeoutMs: z.number().int().positive().optional(),
        mode: z.enum(["pty", "exec"]).optional(),
      })
    ).min(1).max(20),
    stopOnFailure: z.boolean().optional(),
  },
  async ({ sessionId, ...body }) => {
    const data = await requestApi(
      "POST",
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/commands/batch`,
      { ...body, requireTarget: true },
      { allowPolicyBlock: true, timeoutMs: 120000 }
    );
    return formatResult("Batch command results", data);
  }
);

server.tool(
  "close_session",
  "Close an active SSH session once remote access is complete.",
  {
    sessionId: z.string().min(1),
  },
  async ({ sessionId }) => {
    const data = await requestApi("DELETE", `/api/agent/sessions/${encodeURIComponent(sessionId)}`);
    return formatResult("Session closed", data);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[devutility-hub-agent] MCP server failed:", error);
  process.exit(1);
});
