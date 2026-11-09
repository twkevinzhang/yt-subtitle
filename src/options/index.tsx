import React from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";
import "../ui/styles.css";
document.body.style.cssText = 'margin:0;font:15px/1.6 "Segoe UI",sans-serif';
createRoot(document.getElementById("root")!).render(<Options />);
import "./options.css";
