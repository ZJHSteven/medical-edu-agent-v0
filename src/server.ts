/**
 * Family Agent V0 — Worker 入口。
 *
 * 这里故意只负责两件事：
 * 1. 家庭账号认证；
 * 2. 把认证用户的 `/chat*` 请求路由到该用户独享的 AssistantDirectory DO。
 *
 * 模型、Memory、Workspace、Tools 等能力都属于 Agent 层，不和 HTTP 认证混写。
 */

import {
  camelCaseToKebabCase,
  getAgentByName,
  routeSubAgentRequest
} from "agents";
import { AssistantDirectory } from "../agents/assistant/agent";
import { MyAssistant } from "../agents/assistant/agents/my-assistant/agent";
import { ProviderStatus } from "./provider-status";
import {
  createUnauthorizedResponse,
  getAuthenticatedUserFromRequest,
  handleLogout,
  handlePasswordLogin
} from "./auth";

export { AssistantDirectory, MyAssistant, ProviderStatus };

const SUB_AGENT_SEGMENT = camelCaseToKebabCase(MyAssistant.name);
const SUB_AGENT_PREFIX = `/chat/sub/${SUB_AGENT_SEGMENT}/`;

function createJsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/auth/login") {
        return await handlePasswordLogin(request, env);
      }

      if (url.pathname === "/auth/logout") {
        if (request.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        return handleLogout(request);
      }

      if (url.pathname === "/auth/me") {
        const user = await getAuthenticatedUserFromRequest(request, env);
        if (!user) return createUnauthorizedResponse(request);
        return createJsonResponse(user);
      }

      if (url.pathname === "/api/provider-status/heyiwei") {
        const user = await getAuthenticatedUserFromRequest(request, env);
        if (!user) return createUnauthorizedResponse(request);

        const id = env.ProviderStatus.idFromName("global");
        const providerStatus = env.ProviderStatus.get(id);
        const range = url.searchParams.get("range") || "90m";
        return providerStatus.fetch(
          new Request(
            `https://provider-status/heyiwei?range=${encodeURIComponent(range)}`,
            { method: "GET" }
          )
        );
      }

      /**
       * 用户级隔离的关键点：浏览器永远不能自己指定 Directory 名。
       * Worker 从签名 Cookie 还原 login，然后才获取 `AssistantDirectory[login]`。
       * 因而 A/B/C 即使知道别人的聊天 ID，也无法越过这里直连另一个 DO。
       */
      if (url.pathname === "/chat" || url.pathname.startsWith("/chat/")) {
        const user = await getAuthenticatedUserFromRequest(request, env);
        if (!user) return createUnauthorizedResponse(request);

        const directory = await getAgentByName(
          env.AssistantDirectory as DurableObjectNamespace<AssistantDirectory>,
          user.login
        );

        if (url.pathname.startsWith(SUB_AGENT_PREFIX)) {
          const childPath = url.pathname.slice(SUB_AGENT_PREFIX.length);
          return routeSubAgentRequest(request, directory, {
            fromPath: `/sub/${SUB_AGENT_SEGMENT}/${childPath}`
          });
        }

        return directory.fetch(request);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      console.error("[Family Agent] request failed", error);
      return createJsonResponse({ error: message }, { status: 500 });
    }

    // 其他路径交给静态 assets；这里不暴露 `/agents/*` 原生路由。
    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
