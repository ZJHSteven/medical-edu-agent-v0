import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTitle
} from "@/components/ui/sheet";
import type { ChatSummary } from "../../agents/assistant/types";
import type { AuthUser } from "../auth-client";
import {
  FolderIcon,
  LogOutIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

type SidebarProps = {
  user: AuthUser;
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void | Promise<void>;
  onDeleteChat: (chatId: string) => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
};

type MobileSidebarProps = SidebarProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ChatList({
  chats,
  activeChatId,
  onSelectChat,
  onDeleteChat
}: Pick<
  SidebarProps,
  "chats" | "activeChatId" | "onSelectChat" | "onDeleteChat"
>) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return chats;
    return chats.filter((chat) =>
      `${chat.title} ${chat.lastMessagePreview ?? ""}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [chats, query]);

  return (
    <>
      <div className="relative px-2">
        <SearchIcon className="absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索聊天"
          // 手机侧栏里的搜索框也必须保持 16px，避免 iOS Safari 聚焦后放大整页。
          // 桌面侧栏从 md 起恢复紧凑的 12px。
          className="h-8 border-transparent bg-muted/60 pl-8 text-base shadow-none md:text-xs"
        />
      </div>

      <div className="px-3 pb-1 pt-4 text-[11px] font-medium text-muted-foreground">
        项目
      </div>
      <button
        type="button"
        className="mx-2 flex h-9 w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-accent"
      >
        <FolderIcon className="size-4 text-muted-foreground" />
        <span className="truncate">家庭</span>
      </button>

      <div className="px-3 pb-1 pt-4 text-[11px] font-medium text-muted-foreground">
        最近聊天
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="flex flex-col gap-0.5 pb-4">
          {visible.length === 0 ? (
            <div className="px-2 py-5 text-center text-xs text-muted-foreground">
              {query ? "没有匹配的聊天" : "还没有聊天"}
            </div>
          ) : null}
          {visible.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center rounded-lg transition-colors ${
                activeChatId === chat.id ? "bg-accent" : "hover:bg-accent/60"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectChat(chat.id)}
                className="min-w-0 flex-1 px-2.5 py-2 text-left"
              >
                <div className="truncate text-[13px] font-medium">{chat.title}</div>
                {chat.lastMessagePreview ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {chat.lastMessagePreview}
                  </div>
                ) : null}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mr-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      aria-label="聊天菜单"
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void onDeleteChat(chat.id)}
                  >
                    <Trash2Icon />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

function SidebarInner(props: SidebarProps & { mobile?: boolean; onClose?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/25">
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <div className="flex size-8 items-center justify-center rounded-xl bg-foreground text-background">
          <SparklesIcon className="size-4" />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Family AI</span>
        {props.mobile && props.onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={props.onClose}
            aria-label="关闭侧栏"
          >
            <PanelLeftCloseIcon />
          </Button>
        ) : null}
      </div>

      <div className="px-2 pb-2">
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-start rounded-lg bg-background text-sm shadow-none"
          onClick={() => void props.onNewChat()}
        >
          <PlusIcon />
          新聊天
        </Button>
      </div>

      <ChatList
        chats={props.chats}
        activeChatId={props.activeChatId}
        onSelectChat={(chatId) => {
          props.onSelectChat(chatId);
          props.onClose?.();
        }}
        onDeleteChat={props.onDeleteChat}
      />

      <Separator />
      <div className="shrink-0 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-accent"
              />
            }
          >
            <div className="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
              {props.user.login.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{props.user.name}</div>
              <div className="truncate text-[10px] text-muted-foreground">
                账号 {props.user.login}
              </div>
            </div>
            <MoreHorizontalIcon className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-48">
            <DropdownMenuItem disabled>
              <SettingsIcon />
              设置
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void props.onSignOut()}>
              <LogOutIcon />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function DesktopSidebar(props: SidebarProps) {
  return (
    <aside className="hidden h-dvh w-[280px] shrink-0 border-r border-border/70 md:block">
      <SidebarInner {...props} />
    </aside>
  );
}

export function MobileSidebar({
  open,
  onOpenChange,
  ...props
}: MobileSidebarProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[min(88vw,320px)] p-0"
        // SidebarInner 已经提供更符合产品语义的 PanelLeftClose 按钮；
        // 关闭 Sheet 自带的通用 X，避免手机右上角两个关闭图标叠在一起。
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">Family AI 导航</SheetTitle>
        <SidebarInner {...props} mobile onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
