import { LoaderCircleIcon } from "lucide-react";
import type { FileUIPart } from "ai";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentConfig } from "../../agents/assistant/types";
import { fetchCurrentUser, signOut, type AuthUser } from "../auth-client";
import { useChats } from "../use-chats";
import { ChatShell } from "./chat-shell";
import { DraftChatShell } from "./draft-chat-shell";
import { LoginScreen } from "./login-screen";
import { DesktopSidebar, MobileSidebar } from "./sidebar";

function provisionalTitle(text: string, files: FileUIPart[]) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return files.length > 0 ? "文件处理" : "新聊天";
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

function AuthenticatedApp({
  user,
  onSignedOut
}: {
  user: AuthUser;
  onSignedOut: () => void;
}) {
  const {
    directory,
    chats,
    stateReady,
    createChat,
    deleteChat
  } = useChats();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [draftMode, setDraftMode] = useState(false);
  const [pendingFirstTurn, setPendingFirstTurn] = useState<{
    chatId: string;
    text: string;
    files: FileUIPart[];
    config: AgentConfig;
  } | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  // 优先恢复该家庭账号上次打开的聊天；如果已经被删除，就回退到最近一条。
  useEffect(() => {
    if (!stateReady || draftMode) return;
    if (chats.length === 0) {
      setActiveChatId(null);
      setDraftMode(true);
      return;
    }
    const storageKey = `family-ai:last-chat:${user.login}`;
    const saved = localStorage.getItem(storageKey);
    const next =
      (saved && chats.find((chat) => chat.id === saved)?.id) ?? chats[0].id;
    if (!activeChatId || !chats.some((chat) => chat.id === activeChatId)) {
      setActiveChatId(next);
    }
  }, [activeChatId, chats, draftMode, stateReady, user.login]);

  useEffect(() => {
    if (!activeChatId) return;
    localStorage.setItem(`family-ai:last-chat:${user.login}`, activeChatId);
  }, [activeChatId, user.login]);

  const newChat = useCallback(() => {
    setPendingFirstTurn(null);
    setActiveChatId(null);
    setDraftMode(true);
    setMobileSidebarOpen(false);
  }, []);

  const materializeDraft = useCallback(
    async (text: string, files: FileUIPart[], config: AgentConfig) => {
      await directory.ready;
      const chat = await createChat({ title: provisionalTitle(text, files) });
      setPendingFirstTurn({ chatId: chat.id, text, files, config });
      setDraftMode(false);
      setActiveChatId(chat.id);
    },
    [createChat, directory]
  );

  const removeChat = useCallback(
    async (chatId: string) => {
      if (activeChatId === chatId) {
        const replacement = chats.find((chat) => chat.id !== chatId);
        setActiveChatId(replacement?.id ?? null);
        setDraftMode(!replacement);
        // Let React unmount the child ChatShell first. Otherwise an open child
        // WebSocket can race deleteSubAgent() and recreate the facet we just
        // deleted.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      await deleteChat(chatId);
    },
    [activeChatId, chats, deleteChat]
  );

  const logout = useCallback(async () => {
    await signOut();
    onSignedOut();
  }, [onSignedOut]);

  const sidebarProps = {
    user,
    chats,
    activeChatId,
    onSelectChat: (chatId: string) => {
      setPendingFirstTurn(null);
      setDraftMode(false);
      setActiveChatId(chatId);
    },
    onNewChat: newChat,
    onDeleteChat: removeChat,
    onSignOut: logout
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <DesktopSidebar {...sidebarProps} />
      <MobileSidebar
        {...sidebarProps}
        open={mobileSidebarOpen}
        onOpenChange={setMobileSidebarOpen}
      />
      {!stateReady ? (
        <main className="flex h-dvh min-w-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
          <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
          正在恢复聊天…
        </main>
      ) : activeChat ? (
        <ChatShell
          key={activeChat.id}
          chat={activeChat}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          onNewChat={newChat}
          onDeleteChat={removeChat}
          initialTurn={
            pendingFirstTurn?.chatId === activeChat.id
              ? pendingFirstTurn
              : null
          }
          onInitialTurnConsumed={() => setPendingFirstTurn(null)}
        />
      ) : (
        <DraftChatShell
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          onMaterialize={materializeDraft}
        />
      )}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCurrentUser(controller.signal)
      .then(setUser)
      .catch((reason) => {
        if (!controller.signal.aborted) {
          console.error("Failed to restore Family AI session", reason);
          setUser(null);
        }
      });
    return () => controller.abort();
  }, []);

  if (user === undefined) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          正在打开 Family AI…
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen onSignedIn={setUser} />;
  }

  return <AuthenticatedApp user={user} onSignedOut={() => setUser(null)} />;
}
