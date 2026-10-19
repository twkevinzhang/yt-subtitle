import React, { useEffect, useState } from "react";
import { request } from "../shared/messages";
import type { PublicSettings, PlayerBinding } from "../shared/types";
import type { createOverlay } from "../content/overlay";
import { Panel } from "./Panel";

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
  useEffect(() => {
    let live = true,
      first = true,
      refreshing = false;
    const checked = new Set<number>();
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const s = await request<PublicSettings>({ type: "settings-public" });
        if (!live) return;
        setSettings(s);
        if (first) {
          first = false;
          if (!s.configured) {
            setVisible(true);
            setOpened(true);
          }
        }
        if (s.configured && !checked.has(s.settingsRevision)) {
          checked.add(s.settingsRevision);
          // Availability only: never generate text, retry automatically, or block local work.
          void request({ type: "connection-check" }).catch(() => {});
        }
      } catch {
        /* Preserve current UI on transient extension errors. */
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
  }, [button]);
  return (
    <div style={{ display: visible ? "block" : "none" }}>
      {!settings
        ? opened && (
            <section className="panel">
              <div className="panel-body">
                <p role="status">正在讀取設定…</p>
                <button onClick={() => setVisible(false)}>關閉</button>
              </div>
            </section>
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
