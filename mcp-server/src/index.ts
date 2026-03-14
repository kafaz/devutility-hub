import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.DEVUTILITY_AGENT_BASE_URL || "http://127.0.0.1:3001";

type JsonRecord = Record<string, unknown>;

async function requestApi(method: string, path: string, body?: JsonRecord) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({
    ok: false,
    error: `API returned non-JSON response: HTTP ${response.status}`,
  }));

  if (!response.ok || payload.ok === false) {
    throw new Error(String(payload.error || `HTTP ${response.status}`));
  }

  if (payload.data !== undefined) return payload.data;
  if (payload.result !== undefined) return payload.result;
  if (payload.sessions !== undefined) return payload.sessions;
  return payload;
}

function formatResult(title: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${title}\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  };
}

const server = new McpServer({
  name: "devutility-hub-agent",
  version: "0.1.0",
});

server.tool(
  "list_nodes",
  "List locally registered diagnosis nodes with nodeId, name, IP, role, tags, and prepare profile.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agent/nodes");
    return formatResult("Registered nodes", data);
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
  "list_prepare_profiles",
  "List available prepare profiles that can run pre-operations after a session is opened.",
  {},
  async () => {
    const data = await requestApi("GET", "/api/agent/prepare-profiles");
    return formatResult("Prepare profiles", data);
  }
);

server.tool(
  "open_session",
  "Open or reuse a diagnosis session to a node. Prefer nodeId; fall back to direct connection only when the node is not registered.",
  {
    nodeId: z.string().optional(),
    reason: z.string().optional(),
    reuseIfExists: z.boolean().optional(),
    ttlSec: z.number().int().positive().optional(),
    connection: z.record(z.string(), z.unknown()).optional(),
    auth: z.record(z.string(), z.unknown()).optional(),
    jumpAuth: z.record(z.string(), z.unknown()).optional(),
  },
  async (input) => {
    const data = await requestApi("POST", "/api/agent/sessions/open", input);
    return formatResult("Opened session", data);
  }
);

server.tool(
  "list_sessions",
  "List currently active sessions that the local diagnosis service can use.",
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
  "prepare_session",
  "Run pre-operation steps inside an existing PTY-backed session. Use profileId when possible, or pass explicit steps.",
  {
    sessionId: z.string().min(1),
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
      body
    );
    return formatResult("Prepare result", data);
  }
);

server.tool(
  "run_command",
  "Run a diagnostic command and return stdout, stderr, exitCode, and duration. Use mode=pty to keep shell context or mode=exec for stateless execution.",
  {
    sessionId: z.string().min(1),
    cmd: z.string().min(1),
    timeoutMs: z.number().int().positive().optional(),
    mode: z.enum(["pty", "exec"]).optional(),
  },
  async ({ sessionId, ...body }) => {
    const data = await requestApi(
      "POST",
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/commands`,
      body
    );
    return formatResult("Command result", data);
  }
);

server.tool(
  "close_session",
  "Close an active diagnosis session once investigation is complete.",
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
