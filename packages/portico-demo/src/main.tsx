import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";

import "@mantine/notifications/styles.css";
import "./index.css";

const root = document.querySelector("#root");

if (root != null) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
