import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { X } from "lucide-react";

interface AuthModalProps {
  onClose: () => void;
  initialMode?: "login" | "register";
}

export function AuthModal({ onClose, initialMode = "login" }: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const { t } = useLanguage();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password, email || undefined);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-foreground">
            {mode === "login" ? t.auth.login : t.auth.register}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.auth.username}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-2.5 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary transition-colors"
              placeholder={t.auth.usernamePlaceholder}
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">{t.auth.emailOptional}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-2.5 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary transition-colors"
                placeholder="email@example.com"
              />
            </div>
          )}

          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.auth.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-2.5 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-destructive/20 border border-destructive/50 rounded-lg px-4 py-2.5 text-destructive text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? t.auth.loading : mode === "login" ? t.auth.login : t.auth.register}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              {t.auth.noAccount}{" "}
              <button onClick={() => setMode("register")} className="text-primary hover:text-primary/80 transition-colors">
                {t.auth.register}
              </button>
            </>
          ) : (
            <>
              {t.auth.hasAccount}{" "}
              <button onClick={() => setMode("login")} className="text-primary hover:text-primary/80 transition-colors">
                {t.auth.login}
              </button>
            </>
          )}
        </div>

        {mode === "register" && (
          <div className="mt-3 text-center text-xs text-green-400/90 bg-green-400/10 rounded-lg py-2 px-3">
            🎁 {t.auth.bonusCredits}
          </div>
        )}
      </div>
    </div>
  );
}
