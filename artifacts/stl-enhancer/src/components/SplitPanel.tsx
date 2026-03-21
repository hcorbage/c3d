import { useState, useCallback } from "react";
import { Scissors, Download, Loader2, Info, Grid3x3, Maximize2, SlidersHorizontal } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

// ── Printer presets ──────────────────────────────────────────────────────────

const BED_PRESETS = [
  { label: "Bambu A1 Mini", x: 180, y: 180, z: 180 },
  { label: "Bambu A1 / X1", x: 256, y: 256, z: 256 },
  { label: "Bambu P1S",     x: 256, y: 256, z: 256 },
  { label: "Ender 3",       x: 220, y: 220, z: 250 },
  { label: "Prusa MK4",     x: 250, y: 210, z: 220 },
  { label: "Creality K1",   x: 220, y: 220, z: 250 },
  { label: "Voron 300",     x: 300, y: 300, z: 280 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

interface DimInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  highlight?: boolean;
}

function DimInput({ label, value, onChange, placeholder = "auto", highlight }: DimInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-secondary/60 border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 transition-all ${
            highlight
              ? "border-primary/50 focus:border-primary focus:ring-primary/30"
              : "border-white/10 focus:border-white/20 focus:ring-white/10"
          }`}
        />
        <span className="text-xs text-muted-foreground shrink-0">mm</span>
      </div>
    </div>
  );
}

// ── Grid preview ─────────────────────────────────────────────────────────────

function GridPreview({
  gx, gy, gz, sx, sy, sz, t,
}: {
  gx: number; gy: number; gz: number;
  sx: number; sy: number; sz: number;
  t: { previewGrid: string; previewSize: string; preview: string };
}) {
  const pieces = gx * gy * gz;
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Grid3x3 className="w-4 h-4" />
        {t.preview}
      </div>
      <p className="text-sm text-foreground">
        {t.previewGrid
          .replace("{x}", String(gx))
          .replace("{y}", String(gy))
          .replace("{z}", String(gz))
          .replace("{n}", String(pieces))}
      </p>
      <p className="text-xs text-muted-foreground">
        {t.previewSize
          .replace("{x}", sx.toFixed(0))
          .replace("{y}", sy.toFixed(0))
          .replace("{z}", sz.toFixed(0))}
      </p>
      <div className="flex gap-1 flex-wrap mt-1">
        {Array.from({ length: Math.min(pieces, 32) }).map((_, i) => (
          <div
            key={i}
            className="w-5 h-5 rounded-sm bg-primary/30 border border-primary/40 flex items-center justify-center"
          >
            <span className="text-[8px] text-primary font-bold">{i + 1}</span>
          </div>
        ))}
        {pieces > 32 && (
          <div className="w-5 h-5 rounded-sm bg-muted/40 flex items-center justify-center">
            <span className="text-[8px] text-muted-foreground">+{pieces - 32}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

type ScaleMode = "proportional" | "custom";
type PropAxis  = "Z" | "X" | "Y";

interface SplitPanelProps {
  file: File | null;
}

export function SplitPanel({ file }: SplitPanelProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const ts = t.split;

  // Scale mode
  const [scaleMode, setScaleMode] = useState<ScaleMode>("proportional");
  const [propValue, setPropValue]  = useState("");          // proportional: single value
  const [propAxis, setPropAxis]    = useState<PropAxis>("Z"); // which axis is set
  // Custom X/Y/Z
  const [tX, setTX] = useState("");
  const [tY, setTY] = useState("");
  const [tZ, setTZ] = useState("");

  // Bed size
  const [bedX, setBedX] = useState("256");
  const [bedY, setBedY] = useState("256");
  const [bedZ, setBedZ] = useState("256");

  const [loading, setLoading] = useState(false);

  const numBedX = parseFloat(bedX) || 256;
  const numBedY = parseFloat(bedY) || 256;
  const numBedZ = parseFloat(bedZ) || 256;

  const numProp = parseFloat(propValue) || 0;
  const numTX   = parseFloat(tX) || 0;
  const numTY   = parseFloat(tY) || 0;
  const numTZ   = parseFloat(tZ) || 0;

  // Preview: only available when we have all 3 target dims (custom mode)
  const showPreview = scaleMode === "custom" && numTX > 0 && numTY > 0 && numTZ > 0;
  const previewGX   = showPreview ? Math.ceil(numTX / numBedX) : undefined;
  const previewGY   = showPreview ? Math.ceil(numTY / numBedY) : undefined;
  const previewGZ   = showPreview ? Math.ceil(numTZ / numBedZ) : undefined;

  const applyPreset = useCallback((p: typeof BED_PRESETS[0]) => {
    setBedX(String(p.x));
    setBedY(String(p.y));
    setBedZ(String(p.z));
  }, []);

  const handleSplit = useCallback(async () => {
    if (!file) {
      toast({ title: ts.noFile, variant: "destructive" });
      return;
    }
    if (numBedX <= 0 || numBedY <= 0 || numBedZ <= 0) {
      toast({ title: "Please enter valid bed dimensions", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bedX", String(numBedX));
      fd.append("bedY", String(numBedY));
      fd.append("bedZ", String(numBedZ));

      if (scaleMode === "proportional") {
        // Send only the chosen axis — backend scales uniformly from that
        if (numProp > 0) {
          if (propAxis === "X") fd.append("targetX", String(numProp));
          if (propAxis === "Y") fd.append("targetY", String(numProp));
          if (propAxis === "Z") fd.append("targetZ", String(numProp));
        }
      } else {
        if (numTX > 0) fd.append("targetX", String(numTX));
        if (numTY > 0) fd.append("targetY", String(numTY));
        if (numTZ > 0) fd.append("targetZ", String(numTZ));
      }

      const res = await customFetch("/api/stl/split", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: ts.error }));
        toast({ title: err.error ?? ts.error, variant: "destructive" });
        return;
      }

      const pieceCount = parseInt(res.headers.get("X-Piece-Count") ?? "0");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${file.name.replace(/\.stl$/i, "")}_split.zip`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: ts.success.replace("{n}", String(pieceCount)) });
    } catch (err) {
      console.error("[split]", err);
      toast({ title: ts.error, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [file, scaleMode, propValue, propAxis, numBedX, numBedY, numBedZ, numTX, numTY, numTZ, numProp, toast, ts]);

  const axisLabels: Record<PropAxis, string> = {
    X: ts.axisX,
    Y: ts.axisY,
    Z: ts.axisZ,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Scissors className="w-5 h-5 text-primary" />
          {ts.title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{ts.desc}</p>
      </div>

      {/* Scale mode toggle */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-secondary/40 border border-white/5">
        <button
          onClick={() => setScaleMode("proportional")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
            scaleMode === "proportional"
              ? "bg-primary text-white shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Maximize2 className="w-3.5 h-3.5" />
          {ts.scaleProportional}
        </button>
        <button
          onClick={() => setScaleMode("custom")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
            scaleMode === "custom"
              ? "bg-primary text-white shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {ts.scaleCustom}
        </button>
      </div>

      {/* Target size */}
      <div className="bg-secondary/40 border border-white/5 rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">{ts.targetSize}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {scaleMode === "proportional" ? ts.targetHintProp : ts.targetHint}
          </p>
        </div>

        {scaleMode === "proportional" ? (
          <div className="space-y-3">
            {/* Axis selector */}
            <div className="flex gap-2">
              {(["Z", "X", "Y"] as PropAxis[]).map((ax) => (
                <button
                  key={ax}
                  onClick={() => setPropAxis(ax)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    propAxis === ax
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "bg-secondary/60 border-white/10 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {axisLabels[ax]}
                </button>
              ))}
            </div>
            {/* Single value */}
            <DimInput
              label={`${ts.scaleBy} ${axisLabels[propAxis]}`}
              value={propValue}
              onChange={setPropValue}
              placeholder={propAxis === "Z" ? "ex: 300" : "ex: 500"}
              highlight
            />
            <p className="text-xs text-muted-foreground/70">{ts.scaleProportionalHint}</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <DimInput label={ts.axisX} value={tX} onChange={setTX} />
            <DimInput label={ts.axisY} value={tY} onChange={setTY} />
            <DimInput label={ts.axisZ} value={tZ} onChange={setTZ} />
          </div>
        )}
      </div>

      {/* Bed size */}
      <div className="bg-secondary/40 border border-white/5 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{ts.bedSize}</p>
          <span className="text-xs text-muted-foreground">{ts.bedPresets}:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {BED_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                String(p.x) === bedX && String(p.y) === bedY && String(p.z) === bedZ
                  ? "bg-primary text-white border-primary"
                  : "bg-secondary/60 border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <DimInput label={ts.axisX} value={bedX} onChange={setBedX} placeholder="256" />
          <DimInput label={ts.axisY} value={bedY} onChange={setBedY} placeholder="256" />
          <DimInput label={ts.axisZ} value={bedZ} onChange={setBedZ} placeholder="256" />
        </div>
      </div>

      {/* Grid preview (custom mode only, all 3 dims set) */}
      {showPreview && previewGX !== undefined && previewGY !== undefined && previewGZ !== undefined && (
        <GridPreview
          gx={previewGX} gy={previewGY} gz={previewGZ}
          sx={numTX} sy={numTY} sz={numTZ}
          t={ts}
        />
      )}

      {/* Action button */}
      <button
        onClick={handleSplit}
        disabled={loading || !file}
        className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-2xl font-semibold text-sm transition-all duration-300 bg-gradient-to-r from-orange-500 to-amber-400 hover:from-orange-400 hover:to-amber-300 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {ts.generating}
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            {ts.generate}
          </>
        )}
      </button>

      {!file && (
        <p className="text-center text-xs text-muted-foreground">{ts.noFile}</p>
      )}

      {/* Info */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-400">
          <Info className="w-3.5 h-3.5" />
          {ts.infoTitle}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{ts.infoDesc}</p>
      </div>
    </div>
  );
}
