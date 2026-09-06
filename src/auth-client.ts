export type AuthUser = {
  id: number;
  login: string;
  name: string;
  avatarUrl: string;
};

export async function fetchCurrentUser(
  signal?: AbortSignal
): Promise<AuthUser | null> {
  const response = await fetch("/auth/me", {
    headers: { Accept: "application/json" },
    signal
  });

  if (response.status === 401) return null;
  if (!response.ok) throw new Error("无法读取当前登录用户");
  return (await response.json()) as AuthUser;
}

export async function signIn(username: string, password: string) {
  const response = await fetch("/auth/login", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });

  const payload = (await response.json().catch(() => ({}))) as
    | AuthUser
    | { error?: string };

  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "登录失败");
  }

  return payload as AuthUser;
}

export async function signOut() {
  const response = await fetch("/auth/logout", { method: "POST" });
  if (!response.ok) throw new Error("退出登录失败");
}
