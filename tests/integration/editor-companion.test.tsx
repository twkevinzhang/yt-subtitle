import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "../../src/ui/Editor";
afterEach(cleanup);
it("updates spoken alignment text when editing a line that includes an unsung companion", () => {
  const change = vi.fn();
  render(
    <Editor
      lines={[
        {
          id: "l",
          original: "old sung text\n(伴隨譯文)",
          alignmentText: "old sung text",
          cueIds: [],
          status: "unaligned",
          excluded: false,
        },
      ]}
      onChange={change}
      currentMs={() => 0}
      seek={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("原文"), {
    target: { value: "new sung text\n(伴隨譯文)" },
  });
  expect(change.mock.calls[0][0][0].alignmentText).toBe("new sung text");
});
