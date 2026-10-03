import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面渲染失败", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="error-boundary">
        <h2>界面出现异常</h2>
        <pre>{this.state.error.message}</pre>
        {/* 走共享 Button：全站按钮只有一个来源，不再在 global.css 里手写第二套画法。 */}
        <Button type="button" variant="danger" onClick={() => this.setState({ error: null })}>
          重试
        </Button>
      </div>
    );
  }
}
