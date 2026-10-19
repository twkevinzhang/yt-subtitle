import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { Consent } from "../../src/ui/Consent";
import { Editor } from "../../src/ui/Editor";
afterEach(cleanup);
it("does not send until explicit confirmation", () => {
  const go = vi.fn();
  render(
    <Consent
      title="開始搜尋"
      endpoint="https://ai.test/v1"
      payload={{ title: "song" }}
      onConfirm={go}
      onCancel={() => {}}
    />,
  );
  expect(go).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "開始搜尋" }));
  expect(go).toHaveBeenCalledTimes(1);
});
it("manual timing uses current video position", () => {
  const change = vi.fn();
  render(
    <Editor
      lines={[
        {
          id: "l0",
          original: "歌",
          cueIds: [],
          status: "unaligned",
          excluded: false,
        },
      ]}
      onChange={change}
      currentMs={() => 1234}
      seek={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "以目前位置設開始" }));
  expect(change.mock.calls[0][0][0]).toMatchObject({
    startMs: 1234,
    status: "manual",
  });
});
