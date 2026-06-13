import { useEffect, useState } from "react";
import { AccountPicker } from "./AccountPicker";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { BannedForm } from "./BannedForm";
import {
  migrateLegacyRememberData,
  readSavedAccounts,
} from "../../hooks/useSavedAccounts";
import type { SessionUser } from "../../hooks/useSessionBootstrap";

export type AuthScreen =
  | "picker"
  | "login"
  | "register"
  | "forgot"
  | "banned";

export function AuthPage() {
  const [screen, setScreen] = useState<AuthScreen>("login");
  const [bannedMessage, setBannedMessage] = useState("");
  const [accounts] = useState(() => {
    migrateLegacyRememberData();
    return readSavedAccounts();
  });

  useEffect(() => {
    if (accounts.length > 0) {
      setScreen("picker");
    }
  }, [accounts.length]);

  const handleLoginSuccess = (_user: SessionUser) => {
    // navigation handled in useAuth
  };

  const handleBanned = (message: string) => {
    setBannedMessage(message);
    setScreen("banned");
  };

  return (
    <div className="auth-wrapper login-only">
      {screen === "picker" && (
        <AccountPicker
          accounts={accounts}
          onSelectAccount={() => setScreen("login")}
          onRegister={() => setScreen("register")}
          onAddAccount={() => setScreen("login")}
        />
      )}
      {screen === "login" && (
        <LoginForm
          hasSavedAccounts={accounts.length > 0}
          onBanned={handleBanned}
          onLoginSuccess={handleLoginSuccess}
          onForgot={() => setScreen("forgot")}
          onRegister={() => setScreen("register")}
          onBackPicker={() => setScreen("picker")}
        />
      )}
      {screen === "register" && (
        <RegisterForm onBackLogin={() => setScreen("login")} />
      )}
      {screen === "forgot" && (
        <ForgotPasswordForm onBackLogin={() => setScreen("login")} />
      )}
      {screen === "banned" && (
        <BannedForm
          message={bannedMessage}
          onBackLogin={() => (accounts.length ? setScreen("picker") : setScreen("login"))}
        />
      )}
    </div>
  );
}
