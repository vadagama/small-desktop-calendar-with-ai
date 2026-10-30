/** An HTTP refusal from Small, before an event was accepted. Never used for transport errors. */
export class MeetingCreateRejected extends Error {
  constructor(
    public readonly status: number,
    recovery?: string,
  ) {
    super(
      recovery ??
        (status === 409
          ? "Small отклонил создание: обнаружен конфликт времени. Выберите другое время."
          : status === 401
            ? "Small отклонил создание: сессия истекла. Войдите заново."
            : status === 403
              ? "Small отклонил создание: недостаточно прав."
              : `Small отклонил создание (HTTP ${status}). Проверьте параметры встречи.`),
    );
  }
}
