/** Storage base used by the Small web client. Only relative object paths are accepted. */
const storageBase = "https://minio.skiftrade.kz:9000/team/";

export function attachmentUrl(path: string): string | undefined {
  if (
    !path ||
    path.length > 3000 ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    path.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(path)
  )
    return;
  try {
    const parts = path
      .replace(/^\//, "")
      .split("/")
      .map((part) => decodeURIComponent(part));
    if (
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[/\\\u0000-\u001f]/.test(part),
      )
    )
      return;
    return (
      storageBase + parts.map((part) => encodeURIComponent(part)).join("/")
    );
  } catch {
    return;
  }
}

export function attachmentName(path: string): string {
  const name = path.split("/").pop() || "Файл";
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function attachmentSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024)
    return `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(bytes / 1024)} КБ`;
  return `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} МБ`;
}
