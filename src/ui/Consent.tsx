import React from "react";
export function Consent({
  title,
  endpoint,
  payload,
  onConfirm,
  onCancel,
}: {
  title: string;
  endpoint: string;
  payload: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="notice">
      <h3>確認傳送資料</h3>
      <p>目的地：{endpoint}</p>
      <p>
        這次會傳送下方資料，使用你的模型額度。取消不保證撤銷服務端已開始的費用。
      </p>
      <details>
        <summary>查看完整傳送內容</summary>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </details>
      <div className="row">
        <button className="primary" onClick={onConfirm}>
          {title}
        </button>
        <button onClick={onCancel}>返回</button>
      </div>
    </section>
  );
}
