import { Notifications } from "./Notifications";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopWorkspace } from "./DesktopWorkspace";
import "../../prototype/src/styles.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopWorkspace />
    <Notifications />
  </StrictMode>,
);
