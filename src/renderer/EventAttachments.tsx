import { Paperclip, FileText, FileImage, ExternalLink } from "lucide-react";
import type { CalendarAttachment } from "../shared/calendar.js";
import { attachmentSize } from "../shared/event-attachment.js";

export function EventAttachments({
  files,
  notice,
}: {
  files: CalendarAttachment[];
  notice: (message: string) => void;
}) {
  async function open(url: string) {
    try {
      const reply = await window.smallDesktop.calendar.openLink(url);
      if (!reply.ok) notice(reply.error);
    } catch {
      notice("Не удалось открыть файл.");
    }
  }
  return (
    <section
      className="event-metadata-card event-attachments"
      aria-label="Прикреплённые файлы"
    >
      <div className="event-section-label">
        <Paperclip size={20} />
        Прикреплённые файлы
      </div>
      <ul>
        {files.map((file) => {
          const extension = file.name.includes(".")
            ? file.name.split(".").pop()?.toUpperCase()
            : "";
          const Icon = /^(PNG|JPE?G|GIF|WEBP|HEIC|SVG)$/.test(extension ?? "")
            ? FileImage
            : FileText;
          const content = (
            <>
              <Icon size={20} aria-hidden="true" />
              <span className="event-file-info">
                <span className="event-file-name">{file.name}</span>
                <span className="event-file-meta">
                  {[
                    extension,
                    attachmentSize(file.size),
                    !file.url ? "Ссылка недоступна" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {file.url && <ExternalLink size={16} aria-hidden="true" />}
            </>
          );
          const url = file.url;
          return (
            <li key={file.id}>
              {url ? (
                <a
                  href={url}
                  onClick={(e) => {
                    e.preventDefault();
                    void open(url);
                  }}
                >
                  {content}
                </a>
              ) : (
                <div className="event-file-unavailable">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
