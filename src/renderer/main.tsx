import { Notifications } from "./Notifications";
import { UpdateNotice } from "./AppUpdates";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopWorkspace } from "./DesktopWorkspace";
import "./ui/styles.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopWorkspace />
    <Notifications />
    <UpdateNotice />
  </StrictMode>,
);
