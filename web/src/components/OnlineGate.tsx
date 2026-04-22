import { AlertCircle, Check, Link2, Loader2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { RoomStatus } from "@/hooks/useRemoteRoom";
import { cn } from "@/lib/utils";

interface OnlineGateProps {
  status: RoomStatus;
  error: string | null;
  roomId: string | null;
  /// Populated when arriving via `?room=XXXX`; pre-fills the input.
  initialRoomId?: string;
  onEnter: (roomId: string) => void;
  onLeave: () => void;
  onRetry: () => void;
}

export function OnlineGate({
  status,
  error,
  roomId,
  initialRoomId,
  onEnter,
  onLeave,
  onRetry,
}: OnlineGateProps) {
  return (
    <main className="flex-1 min-h-0 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {status === "idle" && (
          <SetupCard initialRoomId={initialRoomId} onEnter={onEnter} />
        )}
        {status === "connecting" && <StatusCard icon="spin" title="正在连接" />}
        {status === "waiting_peer" && roomId && (
          <WaitingCard roomId={roomId} onLeave={onLeave} />
        )}
        {status === "ready" && (
          // Brief window between both peers being present and the first
          // peer's `assign` reaching us. Usually invisible.
          <StatusCard icon="spin" title="配对中" message="正在分配执子" />
        )}
        {status === "ended" && (
          <StatusCard
            icon="warn"
            title="对局结束"
            message="对方已离开房间"
            primary={{ label: "返回首页", onClick: onLeave }}
          />
        )}
        {status === "error" && (
          <StatusCard
            icon="error"
            title="无法进入"
            message={error ?? "未知错误"}
            primary={{ label: "重试", onClick: onRetry }}
            secondary={{ label: "返回首页", onClick: onLeave }}
          />
        )}
      </div>
    </main>
  );
}

function SetupCard({
  initialRoomId,
  onEnter,
}: {
  initialRoomId?: string;
  onEnter: (id: string) => void;
}) {
  const [value, setValue] = useState(initialRoomId ?? "");
  const valid = /^\d{4}$/.test(value);

  // If we arrived with a valid deep-link, auto-submit so the user
  // doesn't have to click "进入" on a URL they already committed to.
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (initialRoomId && /^\d{4}$/.test(initialRoomId)) {
      autoSubmittedRef.current = true;
      onEnter(initialRoomId);
    }
  }, [initialRoomId, onEnter]);

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-7 shadow-sm space-y-6">
      <div className="space-y-1.5 text-center">
        <h2 className="text-xl font-semibold tracking-tight">加入房间</h2>
        <p className="text-sm text-muted-foreground">
          和朋友输入同一个 4 位数字即可开局
        </p>
      </div>
      <PinInput
        value={value}
        onChange={setValue}
        onSubmit={() => valid && onEnter(value)}
      />
      <Button
        className="w-full h-11 text-sm"
        disabled={!valid}
        onClick={() => onEnter(value)}
      >
        进入
      </Button>
    </div>
  );
}

function PinInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      {/* Native input holds canonical value (good IME/paste handling).
          It's positioned full-cover on top, fully transparent — clicks
          anywhere on the "boxes" just focus it. The boxes below are
          purely decorative and don't participate in events. */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) =>
          onChange(e.target.value.replace(/\D/g, "").slice(0, 4))
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        type="text"
        autoComplete="one-time-code"
        name="gomind-room-pin"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="房间号"
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
      />
      <div
        aria-hidden="true"
        className="flex items-center justify-between gap-2.5 pointer-events-none"
      >
        {[0, 1, 2, 3].map((i) => {
          const ch = value[i];
          const filled = ch !== undefined;
          const active = i === value.length;
          return (
            <div
              key={i}
              className={cn(
                "flex-1 aspect-square rounded-xl border-2",
                "flex items-center justify-center",
                "text-4xl font-semibold font-mono",
                "transition-colors select-none",
                filled
                  ? "border-foreground/50 bg-background text-foreground"
                  : active
                    ? "border-foreground/70 bg-background"
                    : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {ch ?? ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  message,
  primary,
  secondary,
}: {
  icon: "spin" | "warn" | "error";
  title: string;
  message?: string;
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-7 shadow-sm space-y-4 text-center">
      <div className="flex justify-center">
        {icon === "spin" && (
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        )}
        {icon === "warn" && <AlertCircle className="size-8 text-amber-500" />}
        {icon === "error" && <AlertCircle className="size-8 text-red-500" />}
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      {(primary || secondary) && (
        <div className="flex flex-col gap-2 pt-1">
          {primary && (
            <Button className="w-full" onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button
              className="w-full"
              variant="outline"
              onClick={secondary.onClick}
            >
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function WaitingCard({
  roomId,
  onLeave,
}: {
  roomId: string;
  onLeave: () => void;
}) {
  const shareUrl = (() => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}${window.location.pathname.replace(/\/?$/, "")}`;
    return `${base}?room=${roomId}`;
  })();

  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-7 shadow-sm space-y-6">
      <div className="space-y-3 text-center">
        <Users className="size-7 text-muted-foreground mx-auto" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">等待对手加入</h2>
          <p className="text-sm text-muted-foreground">
            告诉朋友房号或发他链接
          </p>
        </div>
      </div>
      <div className="rounded-xl bg-muted/60 py-5">
        <div
          className="text-4xl font-mono font-semibold tracking-[0.5em] pl-[0.5em] text-center"
          aria-label={`房间号 ${roomId}`}
        >
          {roomId}
        </div>
      </div>
      <div className="space-y-2">
        <Button className="w-full" onClick={copy}>
          {copied ? (
            <>
              <Check className="size-4" />
              链接已复制
            </>
          ) : (
            <>
              <Link2 className="size-4" />
              复制分享链接
            </>
          )}
        </Button>
        <Button className="w-full" variant="outline" onClick={onLeave}>
          离开
        </Button>
      </div>
    </div>
  );
}
