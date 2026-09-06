import { DurableObject } from "cloudflare:workers";

const HEYIWEI_CONSOLE_BASE_URL = "https://ai.websee.top/api/v1";
const STATUS_CACHE_MS = 45_000;
const ACCESS_TOKEN_SAFETY_MS = 60_000;
const ALLOWED_RANGES = new Set(["90m", "6h", "24h", "7d", "30d"]);

export type ProviderHealth = "healthy" | "warning" | "critical" | "unknown";

export type ProviderGroupStatus = {
  groupId: string;
  groupName: string;
  multiplier: number | null;
  successRate: number | null;
  errorRate: number | null;
  cacheRate: number | null;
  ttftP50Ms: number | null;
  health: ProviderHealth;
};

export type ProviderModelStatus = {
  model: string;
  successRate: number | null;
  errorRate: number | null;
  cacheRate: number | null;
  ttftP50Ms: number | null;
  health: ProviderHealth;
};

export type HeyiweiProviderStatus = {
  provider: "heyiwei";
  range: string;
  fetchedAt: number;
  stale: boolean;
  account: {
    status: string | null;
    balance: number | null;
    frozenBalance: number | null;
  };
  groups: ProviderGroupStatus[];
  models: ProviderModelStatus[];
  error?: string;
};

type StoredAccessToken = {
  token: string;
  expiresAt: number;
};

type RefreshResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
};

type ConsoleEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type AvailableGroup = {
  id: number;
  name: string;
  platform: string;
  status: string;
  rate_multiplier?: number;
};

type MonitorMetrics = {
  success_rate?: number;
  error_rate?: number;
  cache_rate?: number;
  ttft?: { p50_ms?: number | null };
};

type MonitorHealth = { overall?: ProviderHealth };

type MatrixItem = {
  platform: string;
  group_id: number;
  group_name: string;
  metrics?: MonitorMetrics;
  health?: MonitorHealth;
};

type MatrixResponse = {
  items?: MatrixItem[];
};

type ModelItem = {
  platform: string;
  model: string;
  metrics?: MonitorMetrics;
  health?: MonitorHealth;
};

type ModelsResponse = {
  items?: ModelItem[];
};

type AccountResponse = {
  status?: string;
  balance?: number;
  frozen_balance?: number;
};

function unwrapConsoleResponse<T>(value: ConsoleEnvelope<T> | T): T {
  if (
    value &&
    typeof value === "object" &&
    "code" in value &&
    (value as ConsoleEnvelope<T>).code !== undefined
  ) {
    const envelope = value as ConsoleEnvelope<T>;
    if (envelope.code !== 0 || envelope.data === undefined) {
      throw new Error(envelope.message || `何意味 Console API code=${envelope.code}`);
    }
    return envelope.data;
  }
  return value as T;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeHealth(value: unknown): ProviderHealth {
  return value === "healthy" ||
    value === "warning" ||
    value === "critical" ||
    value === "unknown"
    ? value
    : "unknown";
}

/**
 * ProviderStatus 只负责供应商运行元数据，不参与模型推理。
 *
 * 为什么单独用一个 DO：
 * - 何意味 refresh token 会轮换，必须把最新 token 持久化；
 * - access token 与监控结果适合短期缓存，避免每次打开模型选择器都打 Console；
 * - Console 暂时不可用时，可以返回上一次成功快照并标记 stale。
 */
export class ProviderStatus extends DurableObject<Env> {
  private accessToken: StoredAccessToken | null = null;

  private async refreshAccessToken(force = false): Promise<string> {
    if (
      !force &&
      this.accessToken &&
      this.accessToken.expiresAt - ACCESS_TOKEN_SAFETY_MS > Date.now()
    ) {
      return this.accessToken.token;
    }

    const stored = await this.ctx.storage.get<string>("heyiwei_refresh_token");
    const seed = this.env.HEYIWEI_CONSOLE_REFRESH_TOKEN;
    const candidates = Array.from(
      new Set([stored, seed].filter((value): value is string => Boolean(value)))
    );
    if (candidates.length === 0) {
      throw new Error("缺少 HEYIWEI_CONSOLE_REFRESH_TOKEN");
    }

    let lastError = "何意味 Console 认证刷新失败";
    for (const refreshToken of candidates) {
      const response = await fetch(`${HEYIWEI_CONSOLE_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      const raw = (await response.json()) as
        | ConsoleEnvelope<RefreshResponse>
        | RefreshResponse;
      if (!response.ok) {
        const envelope = raw as ConsoleEnvelope<RefreshResponse>;
        lastError = envelope.message || `何意味 refresh HTTP ${response.status}`;
        continue;
      }

      const data = unwrapConsoleResponse(raw);
      if (!data.access_token || !Number.isFinite(data.expires_in)) {
        lastError = "何意味 refresh 响应缺少 access_token/expires_in";
        continue;
      }

      this.accessToken = {
        token: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000
      };

      // Refresh token 会轮换；同时允许部署 Secret 作为恢复种子。当 DO storage
      // 中的 token 已失效但新 Secret 可用时，用种子成功刷新后立即覆盖旧值，
      // 避免“Secret 已更新但 DO 永远卡在坏 token”这一死锁。
      const nextRefreshToken = data.refresh_token || refreshToken;
      if (nextRefreshToken !== stored) {
        await this.ctx.storage.put("heyiwei_refresh_token", nextRefreshToken);
      }

      return data.access_token;
    }

    throw new Error(lastError);
  }

  private async consoleGet<T>(path: string): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.refreshAccessToken(attempt > 0);
      const response = await fetch(`${HEYIWEI_CONSOLE_BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Accept-Language": "zh-CN"
        }
      });

      if (response.status === 401 && attempt === 0) {
        this.accessToken = null;
        continue;
      }

      const raw = (await response.json()) as ConsoleEnvelope<T> | T;
      if (!response.ok) {
        const envelope = raw as ConsoleEnvelope<T>;
        throw new Error(envelope.message || `何意味 Console HTTP ${response.status}`);
      }
      return unwrapConsoleResponse(raw);
    }

    throw new Error("何意味 Console 认证刷新失败");
  }

  private async collectHeyiwei(range: string): Promise<HeyiweiProviderStatus> {
    const cacheKey = `heyiwei_status:${range}`;
    const cached = await this.ctx.storage.get<HeyiweiProviderStatus>(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < STATUS_CACHE_MS) {
      return cached;
    }

    try {
      const timezone = "Asia%2FShanghai";
      const [groups, matrix, models, account] = await Promise.all([
        this.consoleGet<AvailableGroup[]>(`/groups/available?timezone=${timezone}`),
        this.consoleGet<MatrixResponse>(
          `/channel-monitor-v2/matrix?range=${encodeURIComponent(range)}&group_by=platform_group&timezone=${timezone}`
        ),
        this.consoleGet<ModelsResponse>(
          `/channel-monitor-v2/models?range=${encodeURIComponent(range)}&timezone=${timezone}`
        ),
        this.consoleGet<AccountResponse>(`/auth/me`)
      ]);

      const matrixByGroup = new Map(
        (matrix.items || [])
          .filter((item) => item.platform === "openai")
          .map((item) => [String(item.group_id), item] as const)
      );

      const status: HeyiweiProviderStatus = {
        provider: "heyiwei",
        range,
        fetchedAt: Date.now(),
        stale: false,
        account: {
          status: account.status ?? null,
          balance: finiteNumber(account.balance),
          frozenBalance: finiteNumber(account.frozen_balance)
        },
        groups: groups
          .filter((group) => group.platform === "openai" && group.status === "active")
          .map((group) => {
            const monitor = matrixByGroup.get(String(group.id));
            return {
              groupId: String(group.id),
              groupName: group.name,
              multiplier: finiteNumber(group.rate_multiplier),
              successRate: finiteNumber(monitor?.metrics?.success_rate),
              errorRate: finiteNumber(monitor?.metrics?.error_rate),
              cacheRate: finiteNumber(monitor?.metrics?.cache_rate),
              ttftP50Ms: finiteNumber(monitor?.metrics?.ttft?.p50_ms),
              health: normalizeHealth(monitor?.health?.overall)
            };
          }),
        models: (models.items || [])
          .filter((model) => model.platform === "openai")
          .map((model) => ({
            model: model.model,
            successRate: finiteNumber(model.metrics?.success_rate),
            errorRate: finiteNumber(model.metrics?.error_rate),
            cacheRate: finiteNumber(model.metrics?.cache_rate),
            ttftP50Ms: finiteNumber(model.metrics?.ttft?.p50_ms),
            health: normalizeHealth(model.health?.overall)
          }))
      };

      await this.ctx.storage.put(cacheKey, status);
      return status;
    } catch (error) {
      if (cached) {
        return {
          ...cached,
          stale: true,
          error: error instanceof Error ? error.message : "何意味 Console 请求失败"
        };
      }
      throw error;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname !== "/heyiwei") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const requestedRange = url.searchParams.get("range") || "90m";
    const range = ALLOWED_RANGES.has(requestedRange) ? requestedRange : "90m";

    try {
      return Response.json(await this.collectHeyiwei(range), {
        headers: { "Cache-Control": "private, max-age=30" }
      });
    } catch (error) {
      // ProviderStatus 只是模型选择器的辅助元数据，不应因为 Console refresh
      // token 失效/缺失就把页面制造成一片 502。主模型请求完全不依赖这里，
      // 因此用一个显式 stale/unknown 快照降级，让 UI 可以显示“状态不可用”并
      // 继续正常选择/调用模型；真正的供应商错误仍由聊天请求自己上报。
      const unavailable: HeyiweiProviderStatus = {
        provider: "heyiwei",
        range,
        fetchedAt: Date.now(),
        stale: true,
        account: {
          status: null,
          balance: null,
          frozenBalance: null
        },
        groups: [],
        models: [],
        error: error instanceof Error ? error.message : "Provider status failed"
      };
      return Response.json(unavailable, {
        headers: { "Cache-Control": "private, max-age=10" }
      });
    }
  }
}
