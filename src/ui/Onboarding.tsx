import React, { useEffect, useState } from "react";
import { request } from "../shared/messages";
import type { PublicSettings, PlayerBinding } from "../shared/types";
import type { createOverlay } from "../content/overlay";
import { Panel } from "./Panel";
import { PanelSkeleton } from "./Skeleton";

export function Onboarding({
  button,
  binding,
  overlay,
}: {
  button: HTMLButtonElement;
  binding: PlayerBinding;
  overlay: ReturnType<typeof createOverlay>;
}) {
  const [settings, setSettings] = useState<PublicSettings>();
  const [visible, setVisible] = useState(false);
  const [opened, setOpened] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    button.setAttribute("aria-expanded", String(visible));
  }, [button, visible]);
  useEffect(() => {
    let live = true,
      refreshing = false;
    const checked = new Set<number>();
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const s = await request<PublicSettings>({ type: "settings-public" });
        if (!live) return;
        setSettings(s);
        setSettingsError("");
        if (s.configured && !checked.has(s.settingsRevision)) {
          checked.add(s.settingsRevision);
          // Availability only: never generate text, retry automatically, or block local work.
          void request({ type: "connection-check" }).catch(() => {});
        }
      } catch {
        if (live) setSettingsError("設定暫時讀取失敗，請重試。");
      } finally {
        refreshing = false;
      }
    };
    const toggle = () => {
      setOpened(true);
      setVisible((v) => !v);
    };
    const focus = () => {
      void refresh();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    button.addEventListener("click", toggle);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    // Trusted storage remains inaccessible to the content script; poll only public settings.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 2000);
    void refresh();
    return () => {
      live = false;
      clearInterval(timer);
      button.removeEventListener("click", toggle);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [button, retry]);
  return (
    <div style={{ display: visible ? "block" : "none" }}>
      {!settings
        ? opened && (
            <PanelSkeleton
              onClose={() => setVisible(false)}
              error={settingsError}
              onRetry={() => {
                setSettingsError("");
                setRetry((v) => v + 1);
              }}
            />
          )
        : opened && (
            <Panel
              binding={binding}
              overlay={overlay}
              publicSettings={settings}
              onClose={() => setVisible(false)}
            />
          )}
    </div>
  );
}
