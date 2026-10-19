import React from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";
import "../ui/styles.css";
document.body.style.cssText =
  'margin:0;background:#19263a;color:#e8edf5;font:15px/1.6 "Segoe UI",sans-serif;color-scheme:dark';
createRoot(document.getElementById("root")!).render(<Options />);
