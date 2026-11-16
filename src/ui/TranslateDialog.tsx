import React, { useEffect, useRef, useState } from "react";
import {
  languageLabel,
  orderedLanguages,
  type TranslationLanguage,
  type TranslationPreferences,
} from "../shared/translation";

export interface TranslateChoice {
  translate?: TranslationLanguage;
  save?: Partial<TranslationPreferences>;
}
export function TranslateDialog({
  own,
  initial,
  busy,
  onCancel,
  onChoose,
}: {
  own: TranslationLanguage;
  initial: TranslationLanguage;
  busy: boolean;
  onCancel: () => void;
  onChoose: (choice: TranslateChoice) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [language, setLanguage] = useState(initial),
    [never, setNever] = useState(false),
    [always, setAlways] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="translate-dialog"
      aria-labelledby="translate-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id="translate-title">要翻譯歌詞嗎？</h3>
      <label className="translate-field">
        <span>翻譯成</span>
        <select
          value={language}
          disabled={busy}
          onChange={(e) => setLanguage(e.target.value as TranslationLanguage)}
        >
          {orderedLanguages(own).map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
              {l.code === own ? "（你的語言）" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="translate-check">
        <input
          type="checkbox"
          checked={never}
          disabled={busy}
          onChange={(e) => {
            setNever(e.target.checked);
            if (e.target.checked) setAlways(false);
          }}
        />
        永遠不翻譯任何語言
      </label>
      <label className="translate-check">
        <input
          type="checkbox"
          checked={always}
          disabled={busy}
          onChange={(e) => {
            setAlways(e.target.checked);
            if (e.target.checked) setNever(false);
          }}
        />
        永遠翻譯為 {languageLabel(language)}
      </label>
      <div className="translate-actions">
        <button
          disabled={busy}
          onClick={() =>
            onChoose({ save: never ? { ask: "never" } : undefined })
          }
        >
          這次不用
        </button>
        <button
          className="primary"
          disabled={busy || never}
          onClick={() =>
            onChoose({
              translate: language,
              save: always ? { ask: "always", language } : undefined,
            })
          }
        >
          請翻譯
        </button>
      </div>
    </dialog>
  );
}
