import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

import { events, type Notice } from "./notification-events.js";
function Notification({
  notice,
  dismiss,
}: {
  notice: Notice;
  dismiss: (id: number) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pause = () => clearTimeout(timer.current);
  const resume = () => {
    pause();
    if (notice.type !== "error")
      timer.current = setTimeout(() => dismiss(notice.id), 5000);
  };
  useEffect(() => {
    resume();
    return pause;
  }, []);
  return (
    <div
      className={`notification notification-${notice.type}`}
      role={notice.type === "error" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      {notice.type === "success" ? (
        <CheckCircle2 size={20} />
      ) : notice.type === "info" ? (
        <Info size={20} />
      ) : (
        <CircleAlert size={20} />
      )}
      <div>
        <strong>
          {notice.type === "success"
            ? "Успешно"
            : notice.type === "info"
              ? "Обновление"
              : "Ошибка"}
        </strong>
        <p>{notice.message}</p>
      </div>
      <button
        className="icon-button"
        aria-label="Закрыть уведомление"
        onClick={() => dismiss(notice.id)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
export function Notifications() {
  const [items, setItems] = useState<Notice[]>([]);
  const [host, setHost] = useState<Element>(document.body);
  useEffect(() => {
    const update = () =>
      setHost(
        Array.from(document.querySelectorAll("dialog[open]")).at(-1) ??
          document.body,
      );
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const notice = (event as CustomEvent<Notice>).detail;
      setItems((items) =>
        [
          ...items.filter((item) => item.message !== notice.message),
          notice,
        ].slice(-4),
      );
    };
    events.addEventListener("notice", receive);
    return () => events.removeEventListener("notice", receive);
  }, []);
  useEffect(() => {
    if (!layer.current?.isConnected) return;
    if (items.length) {
      layer.current?.hidePopover();
      layer.current?.showPopover();
    } else layer.current?.hidePopover();
  }, [items, host]);
  return createPortal(
    <div
      ref={layer}
      popover="manual"
      className="notifications"
      aria-label="Уведомления"
    >
      {items.map((notice) => (
        <Notification
          key={notice.id}
          notice={notice}
          dismiss={(id) =>
            setItems((items) => items.filter((item) => item.id !== id))
          }
        />
      ))}
    </div>,
    host,
  );
}
