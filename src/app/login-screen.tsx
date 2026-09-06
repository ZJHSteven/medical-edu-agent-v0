import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LockKeyholeIcon, SparklesIcon, UserIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { signIn, type AuthUser } from "../auth-client";

type LoginScreenProps = {
  onSignedIn: (user: AuthUser) => void;
};

/**
 * 内测期家庭登录页。
 * 浏览器不保存密码；登录成功后只有 Worker 下发的 HttpOnly 签名 Cookie。
 */
export function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const user = await signIn(username, password);
      onSignedIn(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-sm border-border/70 shadow-xl shadow-black/5">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-11 items-center justify-center rounded-2xl bg-foreground text-background">
            <SparklesIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Family AI</CardTitle>
          <p className="text-sm text-muted-foreground">
            家庭共享的现代 AI 助手
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoComplete="username"
                autoCapitalize="characters"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="账号"
                className="pl-9"
                aria-label="账号"
              />
            </div>
            <div className="relative">
              <LockKeyholeIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码"
                className="pl-9"
                aria-label="密码"
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="mt-1 w-full" disabled={submitting}>
              {submitting ? "正在登录…" : "登录"}
            </Button>
            <p className="pt-1 text-center text-[11px] leading-5 text-muted-foreground">
              当前为家庭内测账号 A / B / C。每个账号拥有独立聊天、文件与 MCP 空间。
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
