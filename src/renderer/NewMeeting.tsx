import { useState } from "react";
import { DiscardMeetingDialog } from "./DiscardMeetingDialog";
import { X, Video, Plus, Paperclip } from "lucide-react";
import { MeetingPeoplePicker } from "./MeetingPeoplePicker";
import { MeetingSchedule } from "./MeetingSchedule";
import { useNewMeeting } from "./useNewMeeting";
import { SmallAuthNotice } from "./SmallAuthNotice";
export function NewMeeting(props: Parameters<typeof useNewMeeting>[0]) {
  const { account, close, authRequired } = props;
  const data = useNewMeeting(props);
  const [confirmClose, setConfirmClose] = useState(false);
  function requestClose() {
    if (data.busy) return;
    if (data.dirty && !data.locked) setConfirmClose(true);
    else close();
  }
  const {
    dialog,
    title,
    setTitle,
    agenda,
    setAgenda,
    url,
    setUrl,
    room,
    setRoom,
    rooms,
    roomError,
    inform,
    setInform,
    files,
    setFiles,
    busy,
    error,
    result,
    people,
    recipients,
    locked,
    attach,
    create,
    reconcile,
  } = data;
  return (
    <>
      <dialog
        ref={dialog}
        className="modal new-meeting"
        aria-labelledby="new-meeting-title"
        onCancel={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onClose={close}
      >
        <div className="modal-header">
          <h2 id="new-meeting-title">Новое событие</h2>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="Закрыть новое событие"
            onClick={requestClose}
          >
            <X size={24} />
          </button>
        </div>
        {authRequired && <SmallAuthNotice expired />}
        <form
          className="meeting-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="new-meeting-body">
            <fieldset
              disabled={busy || locked || authRequired}
              className="new-meeting-fields"
            >
              <label>
                Наименование <span className="required-mark">*</span>
                <input
                  required
                  maxLength={200}
                  placeholder="Введите наименование"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Описание
                <textarea
                  maxLength={5000}
                  rows={1}
                  placeholder="Введите описание"
                  value={agenda}
                  onChange={(e) => setAgenda(e.target.value)}
                />
              </label>
              <label>
                Ссылка на встречу
                <input
                  type="url"
                  placeholder="Добавьте ссылку"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="meeting-link-action"
                onClick={() =>
                  setUrl(`https://meet.small.kz/${crypto.randomUUID()}`)
                }
              >
                <Video size={18} />
                Сгенерировать ссылку
              </button>
              <div>
                <label className="meeting-field-title">Участники</label>
                <p className="meeting-organizer">Организатор: {account.name}</p>
                <MeetingPeoplePicker data={people} label="участников" />
              </div>
              <button
                type="button"
                className="meeting-link-action"
                aria-expanded={inform}
                onClick={() => setInform(!inform)}
              >
                <Plus size={18} />
                Информируемые
              </button>
              {inform && (
                <MeetingPeoplePicker data={recipients} label="информируемых" />
              )}
              <label>
                Переговорная
                <select
                  aria-label="Переговорная"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                >
                  <option value="">Без переговорной</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {roomError && <p className="form-error">{roomError}</p>}
              <MeetingSchedule data={data} />
              <button
                type="button"
                className="meeting-link-action"
                disabled={files.length >= 5}
                onClick={() => void attach()}
              >
                <Paperclip size={18} />
                Прикрепить файл
              </button>
              <small>
                До 5 файлов по 10 МБ. Файлы загружаются в Small при выборе.
              </small>
              {files.length > 0 && (
                <ul className="meeting-files">
                  {files.map((f) => (
                    <li key={f.id}>
                      {f.name}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Убрать файл ${f.name}`}
                        onClick={() =>
                          setFiles((old) => old.filter((x) => x.id !== f.id))
                        }
                      >
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {(busy || result) && (
            <p role="status">
              {busy ? "Проверяю и отправляю…" : result?.message}
            </p>
          )}
          <div className="new-meeting-footer">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={requestClose}
            >
              {result?.phase === "succeeded" ? "Готово" : "Отмена"}
            </button>
            {!locked && (
              <button
                className="primary"
                type="submit"
                disabled={busy || authRequired}
              >
                Создать
              </button>
            )}
            {result?.phase === "unknown" && (
              <button
                className="primary"
                type="button"
                disabled={busy || authRequired}
                onClick={() => void reconcile()}
              >
                Проверить результат
              </button>
            )}
          </div>
        </form>
      </dialog>
      {confirmClose && (
        <DiscardMeetingDialog
          keepEditing={() => setConfirmClose(false)}
          discard={close}
        />
      )}
    </>
  );
}
