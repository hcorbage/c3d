import { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Image, Palette, Download, Loader2, X, GripVertical } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

// ── K-means color extractor ───────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

function extractDominantColors(imageEl: HTMLImageElement, k = 8): string[] {
  // Draw to a small canvas for speed
  const SIZE = 120;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imageEl, 0, 0, SIZE, SIZE);

  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const pixels: [number, number, number][] = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a < 128) continue;
    // Skip near-black (background) and near-white
    const brightness = (r + g + b) / 3;
    if (brightness < 40 || brightness > 240) continue;
    pixels.push([r, g, b]);
  }

  if (pixels.length === 0) return ["#888888"];

  // Initialize centroids by sampling evenly
  const step = Math.floor(pixels.length / k);
  let centroids: [number, number, number][] = Array.from({ length: k }, (_, i) =>
    [...pixels[i * step]] as [number, number, number],
  );

  const assignments = new Int32Array(pixels.length);

  for (let iter = 0; iter < 25; iter++) {
    // Assign each pixel to nearest centroid
    let changed = false;
    for (let pi = 0; pi < pixels.length; pi++) {
      let best = 0;
      let bestDist = Infinity;
      for (let ci = 0; ci < k; ci++) {
        const d = colorDistance(pixels[pi], centroids[ci]);
        if (d < bestDist) { bestDist = d; best = ci; }
      }
      if (assignments[pi] !== best) { assignments[pi] = best; changed = true; }
    }
    if (!changed) break;

    // Update centroids
    const sums: [number, number, number][] = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Int32Array(k);
    for (let pi = 0; pi < pixels.length; pi++) {
      const c = assignments[pi];
      sums[c][0] += pixels[pi][0];
      sums[c][1] += pixels[pi][1];
      sums[c][2] += pixels[pi][2];
      counts[c]++;
    }
    for (let ci = 0; ci < k; ci++) {
      if (counts[ci] > 0) {
        centroids[ci] = [sums[ci][0]/counts[ci], sums[ci][1]/counts[ci], sums[ci][2]/counts[ci]];
      }
    }
  }

  // Count cluster sizes
  const clusterCounts = new Array(k).fill(0);
  for (let pi = 0; pi < pixels.length; pi++) clusterCounts[assignments[pi]]++;

  // Sort by count descending, filter out tiny clusters
  const total = pixels.length;
  return centroids
    .map((c, i) => ({ hex: rgbToHex(c[0], c[1], c[2]), count: clusterCounts[i] }))
    .filter(({ count }) => count / total > 0.02)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(({ hex }) => hex);
}

// ── Component ────────────────────────────────────────────────────────────────

interface ColorizePanelProps {
  user: { id: number; username: string } | null;
  onNeedLogin: () => void;
}

export function ColorizePanel({ user, onNeedLogin }: ColorizePanelProps) {
  const { t } = useLanguage();
  const { toast } = useToast();

  const [stlFile, setStlFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // ── STL dropzone ──────────────────────────────────────────────────────────
  const onDropStl = useCallback((accepted: File[]) => {
    if (accepted[0]) setStlFile(accepted[0]);
  }, []);
  const stlDrop = useDropzone({
    onDrop: onDropStl,
    accept: { "model/stl": [".stl"] },
    maxFiles: 1,
    multiple: false,
  });

  // ── Photo dropzone ────────────────────────────────────────────────────────
  const onDropPhoto = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setPhotoFile(f);
    const url = URL.createObjectURL(f);
    setPhotoUrl(url);
    setColors([]);
  }, []);
  const photoDrop = useDropzone({
    onDrop: onDropPhoto,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    maxFiles: 1,
    multiple: false,
  });

  // ── Extract colors once image loads ──────────────────────────────────────
  const handleImgLoad = () => {
    if (!imgRef.current) return;
    setIsExtracting(true);
    setTimeout(() => {
      try {
        const extracted = extractDominantColors(imgRef.current!, 8);
        setColors(extracted);
      } catch (e) {
        console.error("Color extraction failed:", e);
      }
      setIsExtracting(false);
    }, 50);
  };

  // ── Color drag-to-reorder ─────────────────────────────────────────────────
  const handleDragStart = (i: number) => setDragIdx(i);
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    setDragOverIdx(i);
  };
  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const next = [...colors];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    setColors(next);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const removeColor = (i: number) => {
    setColors(colors.filter((_, idx) => idx !== i));
  };

  // ── Generate 3MF ─────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!user) { onNeedLogin(); return; }
    if (!stlFile) { toast({ title: t.colorize.noStl, variant: "destructive" }); return; }
    if (colors.length === 0) { toast({ title: t.colorize.noColors, variant: "destructive" }); return; }

    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append("file", stlFile);
      formData.append("colors", JSON.stringify(colors));

      const blob = await customFetch<Blob>("/api/stl/colorize", {
        method: "POST",
        body: formData,
        responseType: "blob",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = stlFile.name.replace(/\.stl$/i, "") + "_colored.3mf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      toast({ title: t.colorize.success });
    } catch (err: unknown) {
      toast({
        title: t.colorize.error,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = !!stlFile && colors.length > 0 && !isGenerating;

  return (
    <div className="space-y-6">
      {/* Upload row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* STL upload */}
        <div
          {...stlDrop.getRootProps()}
          className={`relative flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer
            ${stlDrop.isDragActive ? "border-primary bg-primary/10" : stlFile ? "border-green-500/40 bg-green-500/5" : "border-white/10 bg-secondary/30 hover:border-white/20"}`}
        >
          <input {...stlDrop.getInputProps()} />
          <Upload className={`w-8 h-8 ${stlFile ? "text-green-400" : "text-muted-foreground"}`} />
          {stlFile ? (
            <div className="text-center">
              <p className="text-sm font-medium text-green-400">{stlFile.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{(stlFile.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium">{t.colorize.uploadStl}</p>
              <p className="text-xs text-muted-foreground">{t.colorize.uploadStlHint}</p>
            </div>
          )}
        </div>

        {/* Photo upload */}
        <div
          {...photoDrop.getRootProps()}
          className={`relative flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden
            ${photoDrop.isDragActive ? "border-primary bg-primary/10" : photoUrl ? "border-purple-500/40 bg-purple-500/5" : "border-white/10 bg-secondary/30 hover:border-white/20"}`}
        >
          <input {...photoDrop.getInputProps()} />
          {photoUrl ? (
            <>
              <img
                ref={imgRef}
                src={photoUrl}
                alt="reference"
                onLoad={handleImgLoad}
                className="h-24 w-full object-contain rounded-xl"
                crossOrigin="anonymous"
              />
              <p className="text-xs text-muted-foreground">{t.colorize.changePhoto}</p>
            </>
          ) : (
            <>
              <Image className="w-8 h-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">{t.colorize.uploadPhoto}</p>
                <p className="text-xs text-muted-foreground">{t.colorize.uploadPhotoHint}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Color palette */}
      {(colors.length > 0 || isExtracting) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold">{t.colorize.extractedColors}</span>
            </div>
            {isExtracting && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>

          <p className="text-xs text-muted-foreground">{t.colorize.colorsHint}</p>

          <div className="flex flex-wrap gap-2">
            {colors.map((hex, i) => (
              <div
                key={`${hex}-${i}`}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={(e) => handleDrop(e, i)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                className={`group relative flex items-center gap-1.5 px-2 py-1.5 rounded-xl border transition-all cursor-grab active:cursor-grabbing select-none
                  ${dragOverIdx === i ? "border-primary scale-105" : "border-white/10"}
                  bg-secondary/60 hover:border-white/20`}
              >
                <GripVertical className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                <div
                  className="w-6 h-6 rounded-lg border border-white/20 shrink-0"
                  style={{ backgroundColor: hex }}
                />
                <span className="text-xs font-mono text-muted-foreground">{hex}</span>
                <button
                  onClick={() => removeColor(i)}
                  className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Color count / shell mapping info */}
          <p className="text-xs text-muted-foreground/70">
            {t.colorize.colorCount.replace("{n}", String(colors.length))} — {t.colorize.colorMapping}
          </p>
        </div>
      )}

      {/* Custom color input */}
      {colors.length > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
            onChange={(e) => {
              if (!colors.includes(e.target.value)) {
                setColors([...colors, e.target.value]);
              }
            }}
            title={t.colorize.addColor}
          />
          <span className="text-xs text-muted-foreground">{t.colorize.addColor}</span>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className={`w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200
          ${canGenerate
            ? "bg-gradient-to-r from-purple-600 to-fuchsia-500 hover:from-purple-500 hover:to-fuchsia-400 text-white shadow-lg shadow-purple-500/20"
            : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
          }`}
      >
        {isGenerating ? (
          <><Loader2 className="w-4 h-4 animate-spin" />{t.colorize.generating}</>
        ) : (
          <><Download className="w-4 h-4" />{t.colorize.generate}</>
        )}
      </button>

      {/* Info box */}
      <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-purple-300">{t.colorize.infoTitle}</p>
        <p>{t.colorize.infoDesc}</p>
      </div>
    </div>
  );
}
