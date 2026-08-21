import { LoginForm } from "./login/LoginForm";

export function LoginPage({ onDone }: { onDone: () => void }) {
  return <LoginForm onDone={onDone} />;
}
