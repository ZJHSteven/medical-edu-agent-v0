/**
 * 医学教育 Demo 的轻量参与者账号认证。
 *
 * 当前 Demo 先准备 3 个固定参与者账号：A / B / C。
 * 密码按用户要求分别为 AAA / BBB / CCC，但源码里只保存 SHA-256 摘要；
 * 浏览器成功登录后拿到一个 HMAC 签名的 HttpOnly Cookie，之后 Worker 根据
 * Cookie 中的 login 把请求路由到对应的 AssistantDirectory Durable Object。
 *
 * 这不是正式研究账号系统。真正给学生开放前应改成由教师生成的匿名参与者编号，
 * 并把研究身份信息与聊天内容分离保存；Agent 与 DO 架构本身无需因此重写。
 */

const SESSION_COOKIE = "family_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = {
  id: number;
  login: string;
  name: string;
  avatarUrl: string;
};

type SessionPayload = {
  login: string;
  exp: number;
};

type CookieOptions = {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
};

/**
 * 三个 Demo 参与者账号。passwordHash 是 SHA-256(UTF-8 password) 的十六进制值，
 * 避免把 AAA/BBB/CCC 直接暴露在客户端 bundle 或 API 响应中。
 */
const TEST_USERS: Record<
  string,
  AuthUser & { passwordHash: string }
> = {
  A: {
    id: 1,
    login: "A",
    name: "参与者 A",
    avatarUrl: "",
    passwordHash: "cb1ad2119d8fafb69566510ee712661f9f14b83385006ef92aec47f523a38358"
  },
  B: {
    id: 2,
    login: "B",
    name: "参与者 B",
    avatarUrl: "",
    passwordHash: "dcdb704109a454784b81229d2b05f368692e758bfa33cb61d04c1b93791b0273"
  },
  C: {
    id: 3,
    login: "C",
    name: "参与者 C",
    avatarUrl: "",
    passwordHash: "8c55ff95a660f37cb05e644e7691e6c66593f453cb2cbaa4d64aa59b40ae8032"
  }
};

function shouldUseSecureCookies(request: Request) {
  return new URL(request.url).protocol === "https:";
}

function buildCookie(name: string, value: string, options: CookieOptions = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    `SameSite=${options.sameSite ?? "Lax"}`
  ];

  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  return parts.join("; ");
}

function clearCookie(name: string, request: Request) {
  return buildCookie(name, "", {
    httpOnly: true,
    maxAge: 0,
    secure: shouldUseSecureCookies(request)
  });
}

function getCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const cookie of header.split(";")) {
    const [rawName, ...rest] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }

  return null;
}

function createNoStoreHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  return result;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
}

/** 小数组定长比较，避免直接字符串短路比较密码摘要。 */
function constantTimeStringEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function toBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getSigningKey(env: Env) {
  if (!env.AUTH_SECRET) {
    throw new Error("缺少 Worker Secret：AUTH_SECRET");
  }

  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSessionToken(env: Env, login: string) {
  const payload: SessionPayload = {
    login,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  };
  const encodedPayload = new TextEncoder().encode(JSON.stringify(payload));
  const payloadPart = toBase64Url(encodedPayload);
  const key = await getSigningKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart)
  );
  return `${payloadPart}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifySessionToken(env: Env, token: string) {
  const [payloadPart, signaturePart, ...extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra.length > 0) return null;

  try {
    const key = await getSigningKey(env);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signaturePart),
      new TextEncoder().encode(payloadPart)
    );
    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payloadPart))
    ) as SessionPayload;

    if (
      typeof payload.login !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return TEST_USERS[payload.login] ?? null;
  } catch {
    return null;
  }
}

export function createUnauthorizedResponse(request: Request) {
  const headers = createNoStoreHeaders({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, request));
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers
  });
}

export async function getAuthenticatedUserFromRequest(
  request: Request,
  env: Env
): Promise<AuthUser | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const user = await verifySessionToken(env, token);
  if (!user) return null;
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

export async function handlePasswordLogin(request: Request, env: Env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return Response.json({ error: "登录请求格式错误" }, { status: 400 });
  }

  const username = body.username?.trim().toUpperCase() ?? "";
  const password = body.password ?? "";
  const candidate = TEST_USERS[username];
  const passwordHash = await sha256Hex(password);

  if (
    !candidate ||
    !constantTimeStringEqual(passwordHash, candidate.passwordHash)
  ) {
    return Response.json(
      { error: "账号或密码错误" },
      { status: 401, headers: createNoStoreHeaders() }
    );
  }

  const token = await createSessionToken(env, candidate.login);
  const headers = createNoStoreHeaders({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    buildCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: shouldUseSecureCookies(request)
    })
  );

  const { passwordHash: _passwordHash, ...publicUser } = candidate;
  return new Response(JSON.stringify(publicUser), { status: 200, headers });
}

export function handleLogout(request: Request) {
  const headers = createNoStoreHeaders();
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, request));
  return new Response(null, { status: 204, headers });
}
