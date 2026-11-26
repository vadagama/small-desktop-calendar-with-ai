import { generateConferenceLink } from "../shared/meeting-link.js";
import { useState } from "react";
import { DiscardMeetingDialog } from "./DiscardMeetingDialog";
import { X, Video, Plus, Paperclip } from "lucide-react";
import { MeetingPeoplePicker } from "./MeetingPeoplePicker";
import { MeetingSchedule } from "./MeetingSchedule";
import { useNewMeeting } from "./useNewMeeting";
import { SmallAuthNotice } from "./SmallAuthNotice";
import { MeetingConflictDialog } from "./MeetingConflictDialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/shadcn/select";
import "./ui/shadcn/meeting-controls.css";

const noRoom = "no-room";

export function NewMeeting(
  props: Parameters<typeof useNewMeeting>[0] & {
    notice?: import("react").ReactNode;
  },
) {
  const { close, authRequired } = props;
  const data = useNewMeeting(props);
  const [confirmClose, setConfirmClose] = useState(false);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
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
  const fieldsDisabled = busy || locked || !!authRequired || !!props.disabled;
  return (
    <>
      <dialog
        ref={dialog}
        className="modal new-meeting"
        aria-labelledby="new-meeting-title"
        onCancel={(e) => {
          e.preventDefault();
          e.stopPropagation();
          requestClose();
        }}
        onClose={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <div className="modal-header">
          <h2 id="new-meeting-title">
            {props.editEvent ? "Редактирование события" : "Новое событие"}
          </h2>
          <button
            className="icon-button"
            disabled={busy}
            aria-label={
              props.editEvent
                ? "Закрыть редактирование"
                : "Закрыть новое событие"
            }
            onClick={requestClose}
          >
            <X size={24} />
          </button>
        </div>
        {authRequired && <SmallAuthNotice expired />}
        {props.notice}
        <form
          className="meeting-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="new-meeting-body">
            <fieldset disabled={fieldsDisabled} className="new-meeting-fields">
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
                onClick={() => setUrl(generateConferenceLink())}
              >
                <Video size={18} />
                Сгенерировать ссылку
              </button>
              <div>
                <label className="meeting-field-title">Участники</label>
                <p className="meeting-organizer">
                  Организатор: {data.organizerName}
                </p>
                <MeetingPeoplePicker
                  data={people}
                  label="участников"
                  overlayRoot={overlayRoot}
                  disabled={fieldsDisabled}
                />
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
                <MeetingPeoplePicker
                  data={recipients}
                  label="информируемых"
                  overlayRoot={overlayRoot}
                  disabled={fieldsDisabled}
                />
              )}
              <div className="meeting-room-field">
                <label htmlFor="meeting-room">Переговорная</label>
                <Select
                  value={room || noRoom}
                  disabled={fieldsDisabled}
                  onValueChange={(value) =>
                    setRoom(value === noRoom ? "" : value)
                  }
                >
                  <SelectTrigger id="meeting-room">
                    <SelectValue />
                  </SelectTrigger>
                  {overlayRoot && (
                    <SelectContent
                      container={overlayRoot}
                      collisionBoundary={overlayRoot.parentElement}
                    >
                      <SelectGroup>
                        <SelectItem value={noRoom}>Без переговорной</SelectItem>
                        {rooms.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  )}
                </Select>
              </div>
              {roomError && <p className="form-error">{roomError}</p>}
              <MeetingSchedule
                data={data}
                disabled={fieldsDisabled}
                overlayRoot={overlayRoot}
              />
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
                disabled={
                  busy ||
                  authRequired ||
                  props.disabled ||
                  (!!props.editEvent && !data.dirty)
                }
              >
                {props.editEvent ? "Сохранить" : "Создать"}
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
        {/* Keep portals inside the modal's top layer and outside the scrollable form. */}
        <div ref={setOverlayRoot} />
      </dialog>
      {confirmClose && (
        <DiscardMeetingDialog
          keepEditing={() => setConfirmClose(false)}
          discard={close}
        />
      )}
      {data.conflict && (
        <MeetingConflictDialog
          editing={!!props.editEvent}
          names={data.conflict.names}
          cancel={data.cancelConflict}
          confirm={() => void data.confirmConflict()}
        />
      )}
    </>
  );
}
