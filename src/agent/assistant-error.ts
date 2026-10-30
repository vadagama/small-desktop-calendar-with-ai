import { APICallError } from "ai";

/** Only fixed messages and HTTP status codes cross into the chat, never API payloads. */
export function assistantErrorMessage(error: unknown): string {
  if (APICallError.isInstance(error) && error.statusCode) {
    const status = error.statusCode;
    if (status === 401)
      return "Сервер модели отклонил API-ключ (HTTP 401). Проверьте ключ в настройках модели.";
    if (status === 403)
      return "Сервер модели запретил доступ (HTTP 403). Проверьте права API-ключа на выбранную модель.";
    if (status === 404)
      return "Модель или адрес API не найдены (HTTP 404). Проверьте Base URL и Model ID в настройках модели.";
    if (status === 429)
      return "Достигнут лимит запросов модели (HTTP 429). Повторите позже или проверьте квоту.";
    if (status >= 500)
      return `Сервер модели временно недоступен (HTTP ${status}). Повторите позже.`;
    return `Сервер модели отклонил запрос (HTTP ${status}). Проверьте совместимость выбранной модели с инструментами и формат запроса.`;
  }
  const chain: unknown[] = [error];
  for (let i = 0; i < chain.length && i < 5; i++) {
    const item = chain[i];
    if (!item || typeof item !== "object") continue;
    if ("name" in item && item.name === "TimeoutError")
      return "Истекло время ожидания ответа модели. Повторите запрос.";
    const code =
      "code" in item && typeof item.code === "string" ? item.code : "";
    if (
      [
        "CERT_HAS_EXPIRED",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "SELF_SIGNED_CERT_IN_CHAIN",
      ].includes(code)
    )
      return "Не удалось проверить TLS-сертификат сервера модели. Проверьте сертификат и настройки подключения.";
    if (
      [
        "ENOTFOUND",
        "EAI_AGAIN",
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "UND_ERR_CONNECT_TIMEOUT",
      ].includes(code)
    )
      return "Не удалось подключиться к серверу модели. Проверьте адрес, сеть или VPN.";
    if ("cause" in item && item.cause !== item) chain.push(item.cause);
  }
  return "Не удалось обработать ответ модели. Попробуйте ещё раз.";
}
