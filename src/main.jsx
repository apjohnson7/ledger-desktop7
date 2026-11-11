import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

/* Renderer crashes used to disappear into the console. Send them to the main
   process so they land in crash.log beside the database, with enough detail
   to see what the user was doing when the screen went blank. */
function reportError(kind, error, extra = {}) {
  try {
    const details =
      error && typeof error === "object"
        ? { message: error.message || String(error), stack: error.stack || "" }
        : { message: String(error || "") };
    window.ledger?.logError?.({ kind, ...details, ...extra });
  } catch (e) {
    /* logging must never cause another error */
  }
}

window.addEventListener("error", (event) => {
  reportError("window-error", event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  reportError("unhandled-rejection", event.reason);
});

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError("react-error", error, {
      componentStack: info && info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message =
      (this.state.error && this.state.error.message) || "Unknown error";
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#F6F1E7",
          fontFamily: "'Times New Roman', Times, serif",
          color: "#20291F",
        }}
      >
        <div
          style={{
            maxWidth: 560,
            background: "#FFFFFF",
            border: "1px solid #E4DCC7",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 10px 30px rgba(31,42,36,0.12)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
            The ledger screen stopped unexpectedly
          </div>
          <div
            style={{
              fontSize: 15,
              lineHeight: 1.6,
              color: "#3D4A3B",
              marginBottom: 14,
            }}
          >
            Your saved data is safe. Reload the screen to continue. If this
            keeps happening, open the backups folder and keep a copy of your
            latest backup; the technical details were written to crash.log.
          </div>
          <div
            style={{
              background: "#F6F1E7",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 13,
              color: "#6B7566",
              marginBottom: 16,
              wordBreak: "break-word",
            }}
          >
            {message}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#2E4A32",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "9px 15px",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <button
              onClick={() => {
                try {
                  window.ledger?.backup?.openFolder("backups");
                } catch (e) {
                  /* the folder button is best-effort */
                }
              }}
              style={{
                background: "#FFFFFF",
                color: "#3D4A3B",
                border: "1px solid #E4DCC7",
                borderRadius: 8,
                padding: "9px 15px",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Open backups folder
            </button>
          </div>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
