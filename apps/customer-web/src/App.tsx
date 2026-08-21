import { useState } from "react";
import { CartProvider } from "./lib/cart";
import { auth } from "./lib/api";
import { LoginPage } from "./pages/LoginPage";
import { CustomerShell } from "./components/shell/CustomerShell";

export default function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(auth.token()));

  if (!signedIn) return <LoginPage onDone={() => setSignedIn(true)} />;

  return (
    <CartProvider>
      <CustomerShell onSignOut={() => setSignedIn(false)} />
    </CartProvider>
  );
}
