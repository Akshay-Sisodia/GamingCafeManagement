import React from "react";

interface State {
  error: Error | null;
}

/**
 * Global crash screen: renders the error instead of a blank page so
 * production issues are readable without devtools.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("App crashed:", error, info.componentStack);
  }

  componentDidMount(): void {
    window.addEventListener("unhandledrejection", this.onRejection);
  }

  componentWillUnmount(): void {
    window.removeEventListener("unhandledrejection", this.onRejection);
  }

  private onRejection = (event: PromiseRejectionEvent): void => {
    console.error("Unhandled rejection:", event.reason);
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ background: "#09090b", color: "#fafafa", minHeight: "100vh", padding: 32, fontFamily: "monospace" }}>
          <h1 style={{ color: "#ef4444", fontSize: 20, marginBottom: 12 }}>
            Something went wrong
          </h1>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.6 }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.href = "/";
            }}
            style={{ marginTop: 20, padding: "10px 18px", background: "#10b981", color: "#06281f", border: 0, borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
