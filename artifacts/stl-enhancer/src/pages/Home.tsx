import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Upload, Box, Zap, Settings2, Download, 
  Activity, Info, Layers, Maximize, AlertCircle, Eye, EyeOff, ShieldCheck
} from "lucide-react";
import { useEnhanceStl, useGetStlStats } from "@workspace/api-client-react";
import { StlViewer } from "@/components/StlViewer";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { StlStats } from "@workspace/api-client-react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<StlStats | null>(null);
  const [isWireframe, setIsWireframe] = useState(false);
  
  // Enhancement Options
  const [smoothingIterations, setSmoothingIterations] = useState(3);
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [fixNormals, setFixNormals] = useState(true);
  const [fillHoles, setFillHoles] = useState(true);

  const { toast } = useToast();
  
  const statsMutation = useGetStlStats({
    mutation: {
      onSuccess: (data) => {
        setStats(data);
      },
      onError: (error) => {
        toast({
          title: "Error analyzing file",
          description: error.message || "Failed to get STL statistics",
          variant: "destructive"
        });
      }
    }
  });

  const enhanceMutation = useEnhanceStl({
    mutation: {
      onSuccess: (blob) => {
        // Trigger download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `enhanced_${file?.name || 'model.stl'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        toast({
          title: "Enhancement Complete",
          description: "Your optimized STL file has been downloaded.",
        });

        // Optionally update viewer with new file
        setFileUrl(url);
      },
      onError: (error) => {
        toast({
          title: "Enhancement Failed",
          description: error.message || "Something went wrong during processing.",
          variant: "destructive"
        });
      }
    }
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setFileUrl(url);
      
      // Fetch stats immediately
      statsMutation.mutate({ data: { file: selectedFile } });
    }
  }, [statsMutation]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'model/stl': ['.stl'],
      'application/octet-stream': ['.stl']
    },
    maxFiles: 1
  });

  // Cleanup object URLs to avoid memory leaks
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  const handleEnhance = () => {
    if (!file) return;
    enhanceMutation.mutate({
      data: {
        file,
        smoothingIterations,
        removeDuplicates,
        fixNormals,
        fillHoles,
      }
    });
  };

  const formatNumber = (num: number) => new Intl.NumberFormat().format(num);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full border-b border-white/5 bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary to-blue-400 flex items-center justify-center shadow-lg shadow-primary/20">
              <Box className="w-6 h-6 text-white" />
            </div>
            <h1 className="font-display text-2xl tracking-tight font-bold glow-text">
              STL Enhancer<span className="text-primary">.</span>
            </h1>
          </div>
          
          {file && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 text-sm font-medium bg-secondary/50 px-4 py-2 rounded-full border border-white/5"
            >
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {file.name}
            </motion.div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 flex flex-col lg:flex-row gap-8">
        
        {/* Left Column: Viewer & Upload */}
        <div className="flex-1 flex flex-col gap-6 min-h-[600px] lg:min-h-0">
          
          {!file && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              {...getRootProps()} 
              className={`
                flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-300
                ${isDragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50'}
              `}
            >
              <input {...getInputProps()} />
              <div className="w-24 h-24 mb-6 rounded-2xl bg-secondary flex items-center justify-center shadow-inner">
                <Upload className={`w-10 h-10 transition-colors ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <h3 className="text-2xl font-display font-bold mb-2">Drag & Drop your STL</h3>
              <p className="text-muted-foreground max-w-md text-center">
                Upload a raw or corrupted 3D model from Meshy or any CAD software to analyze and enhance its geometry.
              </p>
              
              <button className="mt-8 px-6 py-3 rounded-full bg-primary/10 text-primary font-semibold hover:bg-primary hover:text-white transition-colors">
                Browse Files
              </button>
            </motion.div>
          )}

          {file && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex-1 relative glass-panel rounded-3xl overflow-hidden flex flex-col group"
            >
              {/* Viewer Tools Overlay */}
              <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button 
                  onClick={() => setIsWireframe(!isWireframe)}
                  className="p-3 rounded-xl bg-background/80 backdrop-blur border border-white/10 hover:bg-secondary transition-colors text-foreground shadow-lg"
                  title="Toggle Wireframe"
                >
                  {isWireframe ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
                <button 
                  {...getRootProps()}
                  className="p-3 rounded-xl bg-background/80 backdrop-blur border border-white/10 hover:bg-secondary transition-colors text-foreground shadow-lg"
                  title="Upload New File"
                >
                  <input {...getInputProps()} />
                  <Upload className="w-5 h-5" />
                </button>
              </div>

              <StlViewer fileUrl={fileUrl} wireframe={isWireframe} />
            </motion.div>
          )}
        </div>

        {/* Right Column: Controls & Stats */}
        <div className="w-full lg:w-[420px] flex flex-col gap-6 shrink-0">
          
          <AnimatePresence mode="popLayout">
            {stats && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="glass-panel rounded-3xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <Activity className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-semibold text-xl">Mesh Analytics</h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <StatCard 
                    icon={<Layers className="w-4 h-4 text-blue-400" />} 
                    label="Triangles" 
                    value={formatNumber(stats.triangleCount)} 
                  />
                  <StatCard 
                    icon={<Box className="w-4 h-4 text-purple-400" />} 
                    label="Vertices" 
                    value={formatNumber(stats.vertexCount)} 
                  />
                  <StatCard 
                    icon={<Maximize className="w-4 h-4 text-green-400" />} 
                    label="Volume" 
                    value={`${formatNumber(Math.round(stats.volume))} mm³`} 
                  />
                  <StatCard 
                    icon={<Zap className="w-4 h-4 text-yellow-400" />} 
                    label="Surface Area" 
                    value={`${formatNumber(Math.round(stats.surfaceArea))} mm²`} 
                  />
                </div>

                <div className="mt-4 p-4 rounded-2xl bg-secondary/50 border border-white/5 space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Info className="w-4 h-4" /> Watertight (Manifold)
                    </span>
                    <span className={stats.isManifold ? "text-green-400 font-semibold" : "text-destructive font-semibold flex items-center gap-1"}>
                      {!stats.isManifold && <AlertCircle className="w-3 h-3" />}
                      {stats.isManifold ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Duplicate Triangles</span>
                    <span className={stats.duplicateTriangles > 0 ? "text-yellow-400 font-semibold" : "text-foreground font-semibold"}>
                      {formatNumber(stats.duplicateTriangles)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Degenerate Triangles</span>
                    <span className={stats.degenerateTriangles > 0 ? "text-yellow-400 font-semibold" : "text-foreground font-semibold"}>
                      {formatNumber(stats.degenerateTriangles)}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`glass-panel rounded-3xl p-6 flex-1 flex flex-col transition-opacity duration-300 ${!file ? 'opacity-50 pointer-events-none' : 'opacity-100 glow-box'}`}>
            <div className="flex items-center gap-3 mb-8">
              <Settings2 className="w-5 h-5 text-primary" />
              <h3 className="font-display font-semibold text-xl">Enhancement Options</h3>
            </div>

            <div className="space-y-8 flex-1">

              {/* Fill Holes — featured prominently */}
              <div className={`p-4 rounded-2xl border transition-all duration-300 ${fillHoles ? 'bg-blue-500/10 border-blue-500/30' : 'bg-secondary/40 border-white/5'}`}>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold cursor-pointer flex items-center gap-2" htmlFor="fill-holes">
                      <ShieldCheck className="w-4 h-4 text-blue-400" />
                      Fechar Buracos (Fill Holes)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Detecta e fecha bordas abertas onde geometrias se encontram (ex: penas vs colete). Resolve erros de "bordas não múltiplas".
                    </p>
                  </div>
                  <Switch 
                    id="fill-holes" 
                    checked={fillHoles} 
                    onCheckedChange={setFillHoles} 
                  />
                </div>
                {stats && !stats.isManifold && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-xl px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    Malha aberta detectada — ative esta opção para fechar os {stats.duplicateTriangles + stats.degenerateTriangles > 0 ? "buracos e " : ""}buracos da malha.
                  </div>
                )}
              </div>

              <div className="h-px w-full bg-border" />

              {/* Smoothing Slider */}
              <div className="space-y-4">
                <div className="flex justify-between">
                  <Label className="text-base text-foreground font-medium">Laplacian Smoothing</Label>
                  <span className="text-primary font-mono font-semibold bg-primary/10 px-2 py-0.5 rounded-md">
                    {smoothingIterations} passes
                  </span>
                </div>
                <Slider 
                  value={[smoothingIterations]} 
                  onValueChange={(v) => setSmoothingIterations(v[0])} 
                  max={20} 
                  step={1} 
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Smooths rough edges and sharp artifacts commonly found in AI-generated or scanned models. Higher values may lose fine detail.
                </p>
              </div>

              <div className="h-px w-full bg-border" />

              {/* Toggles */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-medium cursor-pointer" htmlFor="remove-dupes">Remove Duplicates</Label>
                    <p className="text-xs text-muted-foreground">Cleans up zero-area triangles and overlapping vertices.</p>
                  </div>
                  <Switch 
                    id="remove-dupes" 
                    checked={removeDuplicates} 
                    onCheckedChange={setRemoveDuplicates} 
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-medium cursor-pointer" htmlFor="fix-normals">Fix Normals</Label>
                    <p className="text-xs text-muted-foreground">Recalculates inverted faces for proper 3D printing.</p>
                  </div>
                  <Switch 
                    id="fix-normals" 
                    checked={fixNormals} 
                    onCheckedChange={setFixNormals} 
                  />
                </div>
              </div>

            </div>

            {/* Action Button */}
            <button
              onClick={handleEnhance}
              disabled={!file || enhanceMutation.isPending || statsMutation.isPending}
              className={`
                mt-8 w-full py-4 rounded-2xl font-display font-bold text-lg flex items-center justify-center gap-2
                transition-all duration-300 relative overflow-hidden
                ${(!file || enhanceMutation.isPending) 
                  ? 'bg-secondary text-muted-foreground cursor-not-allowed' 
                  : 'bg-primary text-primary-foreground hover:shadow-[0_0_40px_-10px_rgba(59,130,246,0.6)] hover:-translate-y-1 active:translate-y-0'}
              `}
            >
              {enhanceMutation.isPending ? (
                <>
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Processing Model...
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  Enhance & Download
                </>
              )}
            </button>

          </div>
        </div>

      </main>
    </div>
  );
}

// Small helper component for stats
function StatCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number }) {
  return (
    <div className="bg-secondary/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-2 hover:bg-secondary/60 transition-colors">
      <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
        {icon}
        {label}
      </div>
      <div className="text-lg font-mono font-semibold text-foreground truncate" title={String(value)}>
        {value}
      </div>
    </div>
  );
}
