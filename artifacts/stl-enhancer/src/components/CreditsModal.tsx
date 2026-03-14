import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { X, Zap, CreditCard } from "lucide-react";

interface CreditsModalProps {
  onClose: () => void;
}

const API_BASE = `${import.meta.env.BASE_URL}api`;

const PACKAGES = [
  { id: "pkg_15", credits: 15, price: 990 },
  { id: "pkg_60", credits: 60, price: 3490 },
];

export function CreditsModal({ onClose }: CreditsModalProps) {
  const { token } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  function formatPrice(cents: number): string {
    return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
  }

  function getPkgLabel(id: string): string {
    return id === "pkg_15" ? t.credits.pkg15Label : t.credits.pkg60Label;
  }

  async function handlePurchase(pkgId: string, price: number) {
    setError("");
    setLoading(pkgId);
    try {
      const res = await fetch(`${API_BASE}/credits/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          packageId: pkgId,
          successUrl: `${window.location.origin}${window.location.pathname}?payment=success`,
          cancelUrl: `${window.location.origin}${window.location.pathname}?payment=cancelled`,
        }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-yellow-400" />
            <h2 className="text-xl font-bold text-foreground">{t.credits.buy}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>

        <p className="text-muted-foreground text-sm mb-6">{t.credits.description}</p>

        <div className="space-y-3">
          {PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              onClick={() => handlePurchase(pkg.id, pkg.price)}
              disabled={loading !== null}
              className="w-full bg-secondary hover:bg-secondary/80 border border-white/8 hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl p-4 flex items-center justify-between transition-all group"
            >
              <div className="text-left">
                <div className="text-foreground font-semibold group-hover:text-primary transition-colors">
                  {getPkgLabel(pkg.id)}
                </div>
                <div className="text-muted-foreground text-sm flex items-center gap-1">
                  <CreditCard size={12} />
                  {formatPrice(Math.round(pkg.price / pkg.credits))} {t.credits.perCredit}
                </div>
              </div>
              <div className="text-right">
                <div className="text-primary font-bold text-lg">{formatPrice(pkg.price)}</div>
                {loading === pkg.id && (
                  <div className="text-muted-foreground text-xs">{t.auth.loading}</div>
                )}
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 bg-destructive/20 border border-destructive/50 rounded-lg px-4 py-2.5 text-destructive text-sm">
            {error}
          </div>
        )}

        <p className="mt-4 text-muted-foreground text-xs text-center">{t.credits.securePayment}</p>
      </div>
    </div>
  );
}
