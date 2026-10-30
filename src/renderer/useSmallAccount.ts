import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SmallAuthReply,
  SmallAuthFailureKind,
  SmallAuthState,
  SmallAuthStatus,
} from "../shared/small-auth.js";

export const openSmallAccount = () =>
  window.dispatchEvent(new Event("small:open-account"));
export const requireSmallAccount = () =>
  window.dispatchEvent(new Event("small:auth-required"));

export function useSmallAccount(
  onChange?: (state: SmallAuthState) => void,
  onStatusChange?: (status: SmallAuthStatus) => void,
) {
  const [state, setState] = useState<SmallAuthState>({ status: "signed-out" });
  const [status, setStatus] = useState<SmallAuthStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<SmallAuthFailureKind | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const profile = useRef<SmallAuthState>({ status: "signed-out" });
  const running = useRef(false);
  const mounted = useRef(false);
  const lastAttempt = useRef(0);
  const generation = useRef(0);
  const updateStatus = useCallback(
    (next: SmallAuthStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange],
  );
  const required = useCallback(() => {
    generation.current++;
    setError("");
    setErrorKind(null);
    setNeedsLogin(true);
    updateStatus(
      profile.current.status === "signed-in" ? "required" : "signed-out",
    );
  }, [updateStatus]);
  const perform = useCallback(
    async (
      action: () => Promise<SmallAuthReply>,
      intent: "check" | "login" | "logout" = "check",
    ) => {
      if (running.current) return;
      running.current = true;
      const version = generation.current;
      lastAttempt.current = Date.now();
      setBusy(true);
      setError("");
      setErrorKind(null);
      updateStatus("checking");
      try {
        const reply = await action();
        if (!mounted.current) return;
        if (reply.ok) {
          if (reply.state.status === "signed-in") {
            // A newer expiry wins over an old check still in flight.
            if (intent === "check" && generation.current !== version) return;
            profile.current = reply.state;
            setNeedsLogin(false);
            setState(reply.state);
            setCheckedAt(Date.now());
            onChange?.(reply.state);
            updateStatus("verified");
          } else if (
            intent === "logout" ||
            profile.current.status !== "signed-in"
          ) {
            profile.current = reply.state;
            setNeedsLogin(true);
            setState(reply.state);
            onChange?.(reply.state);
            updateStatus("signed-out");
          } else {
            setNeedsLogin(true);
            updateStatus("required");
          }
        } else {
          if (reply.kind === "auth" || intent !== "check") setNeedsLogin(true);
          setError(reply.error);
          setErrorKind(reply.kind ?? "network");
          updateStatus(
            intent === "login" &&
              reply.kind === "auth" &&
              profile.current.status !== "signed-in"
              ? "signed-out"
              : reply.kind === "auth" ||
                  (intent === "login" && profile.current.status === "signed-in")
                ? "required"
                : "unknown",
          );
        }
      } catch {
        if (mounted.current) {
          if (intent !== "check") setNeedsLogin(true);
          setErrorKind("network");
          setError(
            "Не удалось связаться с Small. Проверьте подключение и повторите проверку.",
          );
          updateStatus("unknown");
        }
      } finally {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [onChange, updateStatus],
  );
  const check = useCallback(
    () => perform(() => window.smallDesktop.smallAuth.read()),
    [perform],
  );
  useEffect(() => {
    mounted.current = true;
    const unsubscribe =
      window.smallDesktop.smallAuth.subscribeRequired(required);
    window.addEventListener("small:auth-required", required);
    void check();
    const recheck = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastAttempt.current >= 60_000
      )
        void check();
    };
    const online = () => {
      void check();
    };
    window.addEventListener("focus", recheck);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", recheck);
    const timer = window.setInterval(recheck, 60_000);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener("small:auth-required", required);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", recheck);
      window.clearInterval(timer);
    };
  }, [check, required]);
  return {
    state,
    status,
    busy,
    error,
    errorKind,
    checkedAt,
    needsLogin,
    perform,
    check,
  };
}
