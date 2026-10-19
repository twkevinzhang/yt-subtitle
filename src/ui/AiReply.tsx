import React, { useId, useState } from "react";

export function AiReply({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const replyId = useId();
  return (
    <div className="ai-reply" role="region" aria-label="AI 實際回覆">
      <div className="row">
        <small>AI 回覆</small>
        <button
          aria-expanded={expanded}
          aria-controls={replyId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收合" : "展開"}
        </button>
      </div>
      <pre id={replyId} className={expanded ? "expanded" : ""} tabIndex={0}>
        {text}
      </pre>
    </div>
  );
}
