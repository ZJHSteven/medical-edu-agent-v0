import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPublicMedicalCase } from "../../shared/medical-cases";
import { fetchCurrentUser, signOut, type AuthUser } from "../auth-client";
import { useChats } from "../use-chats";
import { CaseStartShell } from "./case-start-shell";
import { LoginScreen } from "./login-screen";
import { MedicalChatShell } from "./medical-chat-shell";
import { DesktopSidebar, MobileSidebar } from "./sidebar";

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
  const [casePickerMode, setCasePickerMode] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  // 优先恢复该参与者上次打开的训练；如果已经被删除，就回退到最近一条。
  useEffect(() => {
    if (!stateReady || casePickerMode) return;
    if (chats.length === 0) {
      setActiveChatId(null);
      setCasePickerMode(true);
      return;
    }
    const storageKey = `medical-edu:last-training:${user.login}`;
    const saved = localStorage.getItem(storageKey);
    const next =
      (saved && chats.find((chat) => chat.id === saved)?.id) ?? chats[0].id;
    if (!activeChatId || !chats.some((chat) => chat.id === activeChatId)) {
      setActiveChatId(next);
    }
  }, [activeChatId, casePickerMode, chats, stateReady, user.login]);

  useEffect(() => {
    if (!activeChatId) return;
    localStorage.setItem(`medical-edu:last-training:${user.login}`, activeChatId);
  }, [activeChatId, user.login]);

  const newChat = useCallback(() => {
    setActiveChatId(null);
    setCasePickerMode(true);
    setMobileSidebarOpen(false);
  }, []);

  const startCase = useCallback(
    async (caseId: string) => {
      await directory.ready;
      const medicalCase = getPublicMedicalCase(caseId);
      if (!medicalCase) throw new Error(`未知病例：${caseId}`);
      const chat = await createChat({ caseId, title: medicalCase.title });
      setCasePickerMode(false);
      setActiveChatId(chat.id);
    },
    [createChat, directory]
  );

  const removeChat = useCallback(
    async (chatId: string) => {
      if (activeChatId === chatId) {
        const replacement = chats.find((chat) => chat.id !== chatId);
        setActiveChatId(replacement?.id ?? null);
        setCasePickerMode(!replacement);
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
      setCasePickerMode(false);
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
        <MedicalChatShell
          key={activeChat.id}
          chat={activeChat}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          onNewChat={newChat}
          onDeleteChat={removeChat}
        />
      ) : (
        <CaseStartShell
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          onStartCase={startCase}
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
          正在打开医学临床推理训练…
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen onSignedIn={setUser} />;
  }

  return <AuthenticatedApp user={user} onSignedOut={() => setUser(null)} />;
}
