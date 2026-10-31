import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { profileLabels } from "../shared/profiles.js";
import type { ProfileId, ProfileState } from "../shared/profiles.js";

export function ModelPicker({
  state,
  disabled,
  update,
  onError,
}: {
  state: ProfileState | null;
  disabled: boolean;
  update: (state: ProfileState) => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const label =
    state?.profiles.find((profile) => profile.id === state.active)?.modelId ??
    (state ? "Выбрать модель" : "Загрузка…");
  async function select(profileId: ProfileId) {
    if (disabled || saving) return;
    setSaving(true);
    onError("");
    try {
      const reply = await window.smallDesktop.profiles.activate(profileId);
      if (reply.ok) update(reply.state);
      else onError(reply.error);
    } catch {
      onError("Не удалось переключить модель. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
      menu.current?.hidePopover();
      trigger.current?.focus();
    }
  }
  return (
    <>
      <button
        ref={trigger}
        className="composer-model-button"
        type="button"
        aria-label={`Выбрать модель: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        popoverTarget={id}
        disabled={!state || disabled || saving}
        title="Выбрать модель"
      >
        <Sparkles size={14} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {createPortal(
        <div
          id={id}
          ref={menu}
          popover="auto"
          className="model-picker-menu"
          role="menu"
          aria-label="Выбор модели"
          onToggle={(event) => {
            const isOpen = event.newState === "open";
            setOpen(isOpen);
            if (isOpen)
              (
                menu.current?.querySelector<HTMLElement>(
                  '[aria-checked="true"]:not(:disabled)',
                ) ??
                menu.current?.querySelector<HTMLElement>(
                  "button:not(:disabled)",
                )
              )?.focus();
          }}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) ?? [],
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }}
        >
          {!state?.profiles.length ? (
            <p>
              Нет настроенных моделей
              <br />
              <span>Добавьте модель кнопкой настроек с ползунками.</span>
            </p>
          ) : (
            state.profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={state.active === profile.id}
                disabled={disabled || saving || !profile.hasKey}
                onClick={() => void select(profile.id)}
              >
                <span>
                  <span>{profile.modelId}</span>
                  <small>
                    {profileLabels[profile.id]}
                    {!profile.hasKey ? " · нужен ключ" : ""}
                  </small>
                </span>
                {state.active === profile.id && (
                  <Check size={14} aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
