import { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Upload, Box, Zap, Settings2, Download, Trash2,
  Activity, Info, Layers, Maximize, AlertCircle, CheckCircle2, Eye, EyeOff, ShieldCheck,
  LogIn, LogOut, User, CreditCard, GitMerge, Scissors
} from "lucide-react";
import { useEnhanceStl, useGetStlStats } from "@workspace/api-client-react";
import type { StlStats, QualityReport } from "@workspace/api-client-react";
import { StlViewer } from "@/components/StlViewer";
import { QualityReportPanel } from "@/components/QualityReportPanel";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { AuthModal } from "@/components/AuthModal";
import { CreditsModal } from "@/components/CreditsModal";

function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="flex items-center gap-1 bg-secondary/60 border border-white/8 rounded-full p-1">
      <button
        onClick={() => setLanguage("en")}
        className={`px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 ${
          language === "en"
            ? "bg-primary text-white shadow"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLanguage("pt-BR")}
        className={`px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 ${
          language === "pt-BR"
            ? "bg-primary text-white shadow"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        PT
      </button>
    </div>
  );
}

export default function Home() {
  const { t } = useLanguage();
  const { user, logout, refreshUser } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [enhancedFileUrl, setEnhancedFileUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<StlStats | null>(null);
  const [isWireframe, setIsWireframe] = useState(false);
  
  const [smoothingIterations, setSmoothingIterations] = useState(3);
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [fixNormals, setFixNormals] = useState(true);
  const [fillHoles, setFillHoles] = useState(true);
  const [mergeShells, setMergeShells] = useState(false);
  const [decimate, setDecimate] = useState(false);
  const [decimateRatio, setDecimateRatio] = useState(50);
  const [resolveIntersections, setResolveIntersections] = useState(false);
  const [splitShells, setSplitShells] = useState(false);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);

  const totalCredits = 1 + (mergeShells ? 1 : 0) + (decimate ? 1 : 0) + (resolveIntersections ? 1 : 0) + (splitShells ? 1 : 0);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  const { toast } = useToast();
  
  // Handle payment redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      toast({ title: t.toast.paymentSuccess });
      refreshUser();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("payment") === "cancelled") {
      toast({ title: t.toast.paymentCancelled, variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const statsMutation = useGetStlStats({
    mutation: {
      onSuccess: (data) => {
        setStats(data);
      },
      onError: (error) => {
        toast({
          title: t.toast.analyzeError,
          description: error.message || t.toast.analyzeErrorDesc,
          variant: "destructive"
        });
      }
    }
  });

  const enhanceMutation = useEnhanceStl({
    mutation: {
      onSuccess: ({ stl, qualityReport: report, isZip, partsCount }) => {
        if (report) setQualityReport(report);

        // ZIP download (splitShells mode) — skip 3D preview
        if (isZip) {
          const dlUrl = window.URL.createObjectURL(stl);
          const a = document.createElement("a");
          a.href = dlUrl;
          a.download = "parts.zip";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => window.URL.revokeObjectURL(dlUrl), 5000);
          toast({
            title: t.toast.downloadReady,
            description: partsCount != null
              ? `${partsCount} ${partsCount === 1 ? "part" : "parts"} exported`
              : undefined,
          });
          return;
        }

        // Salva URL para visualização comparativa
        const previewUrl = window.URL.createObjectURL(stl);
        setEnhancedFileUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return previewUrl;
        });

        // Download automático
        const dlUrl = window.URL.createObjectURL(stl);
        const a = document.createElement("a");
        a.href = dlUrl;
        a.download = `enhanced_${file?.name || 'model.stl'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        toast({
          title: t.toast.enhanceDone,
          description: t.toast.enhanceDoneDesc,
        });

        // Atualiza saldo de créditos
        refreshUser();
      },
      onError: (error: Error & { status?: number }) => {
        if (error.status === 401 || (error as any)?.data?.code === "NO_CREDITS") {
          setShowAuthModal(true);
          return;
        }
        if (error.status === 402 || (error as any)?.data?.code === "NO_CREDITS") {
          toast({
            title: t.credits.insufficient,
            description: t.credits.insufficientDesc,
            variant: "destructive",
          });
          setShowCreditsModal(true);
          return;
        }
        toast({
          title: t.toast.enhanceFail,
          description: error.message || t.toast.enhanceFailDesc,
          variant: "destructive"
        });
      }
    }
  });

  // Simulated progress bar — lives after enhanceMutation so the ref is valid
  const [progress, setProgress] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (enhanceMutation.isPending) {
      setProgress(0);
      progressTimer.current = setInterval(() => {
        setProgress((p) => {
          const step = p < 30 ? 3 : p < 60 ? 1.8 : p < 80 ? 0.7 : 0.15;
          return Math.min(89, p + step);
        });
      }, 120);
    } else {
      if (progressTimer.current) {
        clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      if (progress > 0) {
        setProgress(100);
        setTimeout(() => setProgress(0), 700);
      }
    }
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, [enhanceMutation.isPending]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setFileUrl(url);
      setQualityReport(null);
      // Limpa comparação ao enviar novo arquivo
      setEnhancedFileUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
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

  const clearFile = useCallback(() => {
    setFile(null);
    setFileUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setEnhancedFileUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setStats(null);
    setQualityReport(null);
  }, []);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      if (enhancedFileUrl) URL.revokeObjectURL(enhancedFileUrl);
    };
  }, [fileUrl, enhancedFileUrl]);

  const handleEnhance = () => {
    if (!file) return;
    if (!user) {
      setAuthMode("login");
      setShowAuthModal(true);
      return;
    }
    if (!user.isAdmin && user.credits < totalCredits) {
      toast({
        title: t.credits.insufficient,
        description: t.credits.insufficientDesc,
        variant: "destructive",
      });
      setShowCreditsModal(true);
      return;
    }
    enhanceMutation.mutate({
      data: {
        file,
        smoothingIterations,
        removeDuplicates,
        fixNormals,
        fillHoles,
        mergeShells,
        decimate,
        decimateRatio: decimate ? decimateRatio / 100 : undefined,
        resolveIntersections,
        splitShells,
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
            <img
              src="/corb3d-robot.svg"
              alt="Corb3D Robot"
              className="w-11 h-11 drop-shadow-[0_0_8px_rgba(0,229,204,0.5)]"
            />
            <h1 className="font-display text-2xl tracking-tight font-bold glow-text">
              {t.appName}<span className="text-primary">.</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            
            {file && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="hidden sm:flex items-center gap-3 text-sm font-medium bg-secondary/50 px-4 py-2 rounded-full border border-white/5"
              >
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                {file.name}
              </motion.div>
            )}

            {user ? (
              <div className="flex items-center gap-2">
                {/* Credit balance */}
                <button
                  onClick={() => !user.isAdmin && setShowCreditsModal(true)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                    user.isAdmin
                      ? "bg-yellow-400/10 border-yellow-400/20 text-yellow-400 cursor-default"
                      : user.credits < 1
                      ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 cursor-pointer"
                      : "bg-secondary/60 border-white/8 text-foreground hover:bg-secondary cursor-pointer"
                  }`}
                >
                  <Zap size={13} className={user.isAdmin ? "text-yellow-400" : user.credits < 2 ? "text-red-400" : "text-primary"} />
                  {user.isAdmin ? t.credits.adminUnlimited : `${user.credits} ${t.credits.balance}`}
                </button>
                {/* Username */}
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <User size={14} />
                  <span className="hidden sm:inline">{user.username}</span>
                </div>
                {/* Logout */}
                <button
                  onClick={logout}
                  title={t.auth.logout}
                  className="p-2 rounded-full hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                >
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setAuthMode("login"); setShowAuthModal(true); }}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/60 border border-white/8 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                >
                  <LogIn size={14} />
                  {t.auth.login}
                </button>
                <button
                  onClick={() => { setAuthMode("register"); setShowAuthModal(true); }}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-colors"
                >
                  {t.auth.register}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 flex flex-col lg:flex-row gap-8">
        
        {/* Left Column: Viewer & Upload */}
        <div className="flex-1 flex flex-col gap-4 lg:self-start">
          
          {!file && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              {...getRootProps()} 
              className={`
                h-[460px] flex flex-col items-center justify-center border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-300
                ${isDragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50'}
              `}
            >
              <input {...getInputProps()} />
              <div className="w-24 h-24 mb-6 rounded-2xl bg-secondary flex items-center justify-center shadow-inner">
                <Upload className={`w-10 h-10 transition-colors ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <h3 className="text-2xl font-display font-bold mb-2">{t.upload.title}</h3>
              <p className="text-muted-foreground max-w-md text-center">
                {t.upload.description}
              </p>
              
              <button className="mt-8 px-6 py-3 rounded-full bg-primary/10 text-primary font-semibold hover:bg-primary hover:text-white transition-colors">
                {t.upload.browse}
              </button>
            </motion.div>
          )}

          {file && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col gap-2"
            >
              {/* Single viewer — shows original while waiting, enhanced after processing */}
              <div className="h-[460px] relative glass-panel rounded-2xl overflow-hidden">
                {/* Processing overlay */}
                <AnimatePresence>
                  {enhanceMutation.isPending && (
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm gap-4"
                    >
                      <div className="w-12 h-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                      <div className="text-center">
                        <p className="text-sm font-semibold text-foreground">{t.actions.processing}</p>
                        <p className="text-2xl font-mono font-bold text-primary mt-1">{Math.round(progress)}%</p>
                      </div>
                      <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-[width] duration-150" style={{ width: `${progress}%` }} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  {enhancedFileUrl ? (
                    <motion.div
                      key="enhanced"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.35 }}
                      className="absolute inset-0"
                    >
                      <StlViewer fileUrl={enhancedFileUrl} wireframe={isWireframe} labelColor="green" />
                    </motion.div>
                  ) : (
                    <motion.div key="original" className="absolute inset-0">
                      <StlViewer fileUrl={fileUrl} wireframe={isWireframe} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Status badge top-left */}
                {enhancedFileUrl && (
                  <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/15 border border-green-500/30 backdrop-blur">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs font-medium text-green-400">{t.viewer.enhanced}</span>
                  </div>
                )}
              </div>

              {/* Controls bar below the viewer */}
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground">{t.viewer.compareHint}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsWireframe(!isWireframe)}
                    className="p-2 rounded-xl bg-secondary/60 border border-white/8 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                    title={t.viewer.toggleWireframe}
                    disabled={enhanceMutation.isPending}
                  >
                    {isWireframe ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    {...getRootProps()}
                    className="p-2 rounded-xl bg-secondary/60 border border-white/8 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                    title={t.viewer.uploadNew}
                    disabled={enhanceMutation.isPending}
                  >
                    <input {...getInputProps()} />
                    <Upload className="w-4 h-4" />
                  </button>
                  <button
                    onClick={clearFile}
                    className="p-2 rounded-xl bg-secondary/60 border border-white/8 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400 transition-colors text-muted-foreground"
                    title={t.viewer.clearFile}
                    disabled={enhanceMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
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
                  <h3 className="font-display font-semibold text-xl">{t.stats.title}</h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <StatCard 
                    icon={<Layers className="w-4 h-4 text-blue-400" />} 
                    label={t.stats.triangles}
                    value={formatNumber(stats.triangleCount)} 
                  />
                  <StatCard 
                    icon={<Box className="w-4 h-4 text-purple-400" />} 
                    label={t.stats.vertices}
                    value={formatNumber(stats.vertexCount)} 
                  />
                  <StatCard 
                    icon={<Maximize className="w-4 h-4 text-green-400" />} 
                    label={t.stats.volume}
                    value={`${formatNumber(Math.round(stats.volume))} mm³`} 
                  />
                  <StatCard 
                    icon={<Zap className="w-4 h-4 text-yellow-400" />} 
                    label={t.stats.surfaceArea}
                    value={`${formatNumber(Math.round(stats.surfaceArea))} mm²`} 
                  />
                </div>

                <div className="mt-4 p-4 rounded-2xl bg-secondary/50 border border-white/5 space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Info className="w-4 h-4" /> {t.stats.watertight}
                    </span>
                    <span className={stats.isManifold ? "text-green-400 font-semibold" : "text-destructive font-semibold flex items-center gap-1"}>
                      {!stats.isManifold && <AlertCircle className="w-3 h-3" />}
                      {stats.isManifold ? t.stats.yes : t.stats.no}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{t.stats.shells}</span>
                    <span className={stats.shellCount > 1 ? "text-yellow-400 font-semibold" : "text-foreground font-semibold"}>
                      {formatNumber(stats.shellCount)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{t.stats.openEdges}</span>
                    <span className={stats.openEdges > 0 ? "text-yellow-400 font-semibold" : "text-foreground font-semibold"}>
                      {formatNumber(stats.openEdges)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{t.stats.duplicate}</span>
                    <span className={stats.duplicateTriangles > 0 ? "text-yellow-400 font-semibold" : "text-foreground font-semibold"}>
                      {formatNumber(stats.duplicateTriangles)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{t.stats.degenerate}</span>
                    <span className={stats.degenerateTriangles > 0 ? "text-yellow-400 font-semibold" : "text-foreground font-semibold"}>
                      {formatNumber(stats.degenerateTriangles)}
                    </span>
                  </div>
                </div>
                {stats.unitWarning && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/8 border border-yellow-400/20 rounded-xl px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {stats.unitWarning === "inches" ? t.stats.unitWarningInches : t.stats.unitWarningMeters}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`glass-panel rounded-3xl p-6 flex-1 flex flex-col transition-opacity duration-300 ${!file ? 'opacity-50 pointer-events-none' : 'opacity-100 glow-box'}`}>
            <div className="flex items-center gap-3 mb-8">
              <Settings2 className="w-5 h-5 text-primary" />
              <h3 className="font-display font-semibold text-xl">{t.options.title}</h3>
            </div>

            <div className="space-y-8 flex-1">

              {/* Fill Holes */}
              <div className={`p-4 rounded-2xl border transition-all duration-300 ${fillHoles ? 'bg-blue-500/10 border-blue-500/30' : 'bg-secondary/40 border-white/5'}`}>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold cursor-pointer flex items-center gap-2" htmlFor="fill-holes">
                      <ShieldCheck className="w-4 h-4 text-blue-400" />
                      {t.options.fillHoles}
                      <CreditBadge label={t.credits.included} color="gray" />
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t.options.fillHolesDesc}
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
                    {t.options.fillHolesWarning}
                  </div>
                )}
              </div>

              <div className="h-px w-full bg-border" />

              {/* Smoothing */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Label className="text-base text-foreground font-medium flex items-center gap-2">
                      {t.options.smoothing}
                      <CreditBadge label={t.credits.included} color="gray" />
                    </Label>
                    {/* Botão de ajuda com tooltip */}
                    <div className="relative group">
                      <button className="w-5 h-5 rounded-full bg-secondary border border-white/15 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center text-xs font-bold leading-none">
                        ?
                      </button>
                      <div className="absolute left-0 bottom-full mb-2 w-72 p-3 rounded-xl bg-gray-900 border border-white/10 shadow-2xl text-xs text-muted-foreground leading-relaxed
                                      invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-200 z-50 pointer-events-none">
                        <p className="text-foreground font-semibold mb-1">{t.options.smoothing}</p>
                        {t.options.smoothingTooltip}
                      </div>
                    </div>
                  </div>
                  <span className="text-primary font-mono font-semibold bg-primary/10 px-2 py-0.5 rounded-md">
                    {smoothingIterations} {t.options.smoothingPasses}
                  </span>
                </div>
                <Slider 
                  value={[smoothingIterations]} 
                  onValueChange={(v) => setSmoothingIterations(v[0])} 
                  max={20} 
                  step={1} 
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t.options.smoothingDesc}
                </p>
              </div>

              <div className="h-px w-full bg-border" />

              {/* Toggles */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-medium cursor-pointer flex items-center gap-2" htmlFor="remove-dupes">
                      {t.options.removeDuplicates}
                      <CreditBadge label={t.credits.included} color="gray" />
                    </Label>
                    <p className="text-xs text-muted-foreground">{t.options.removeDuplicatesDesc}</p>
                  </div>
                  <Switch 
                    id="remove-dupes" 
                    checked={removeDuplicates} 
                    onCheckedChange={setRemoveDuplicates} 
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-medium cursor-pointer flex items-center gap-2" htmlFor="fix-normals">
                      {t.options.fixNormals}
                      <CreditBadge label={t.credits.included} color="gray" />
                    </Label>
                    <p className="text-xs text-muted-foreground">{t.options.fixNormalsDesc}</p>
                  </div>
                  <Switch 
                    id="fix-normals" 
                    checked={fixNormals} 
                    onCheckedChange={setFixNormals} 
                  />
                </div>

                {/* Merge Shells */}
                <div className={`p-4 rounded-2xl border transition-all duration-300 ${mergeShells ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-secondary/40 border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="text-base font-semibold cursor-pointer flex items-center gap-2" htmlFor="merge-shells">
                        <GitMerge className="w-4 h-4 text-cyan-400" />
                        {t.options.mergeShells}
                        <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="cyan" />
                      </Label>
                      <p className="text-xs text-muted-foreground">{t.options.mergeShellsDesc}</p>
                    </div>
                    <Switch
                      id="merge-shells"
                      checked={mergeShells}
                      disabled={resolveIntersections}
                      onCheckedChange={(v) => {
                        setMergeShells(v);
                        if (v) setResolveIntersections(false);
                      }}
                    />
                  </div>
                  {resolveIntersections ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-400 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {t.options.mergeShellsConflict}
                    </div>
                  ) : stats && stats.shellCount > 1 && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-xl px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {t.options.mergeShellsWarning}
                    </div>
                  )}
                </div>
              </div>

              <div className="h-px w-full bg-border" />

              {/* Decimate */}
              <div className={`p-4 rounded-2xl border transition-all duration-300 ${decimate ? 'bg-purple-500/10 border-purple-500/30' : 'bg-secondary/40 border-white/5'}`}>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-base font-semibold cursor-pointer flex items-center gap-2" htmlFor="decimate">
                    <Scissors className="w-4 h-4 text-purple-400" />
                    {t.options.decimate}
                    <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="purple" />
                  </Label>
                  <Switch id="decimate" checked={decimate} onCheckedChange={setDecimate} />
                </div>
                <p className="text-xs text-muted-foreground mb-3">{t.options.decimateDesc}</p>
                {decimate && (
                  <div className="space-y-2 mt-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {t.options.decimateRatio}
                        <div className="relative group">
                          <button className="w-5 h-5 rounded-full bg-secondary border border-white/15 text-muted-foreground hover:text-foreground flex items-center justify-center text-xs font-bold">?</button>
                          <div className="absolute left-0 bottom-full mb-2 w-72 p-3 rounded-xl bg-gray-900 border border-white/10 shadow-2xl text-xs text-muted-foreground leading-relaxed invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-200 z-50 pointer-events-none">
                            <p className="text-foreground font-semibold mb-1">{t.options.decimate}</p>
                            {t.options.decimateTooltip}
                          </div>
                        </div>
                      </div>
                      <span className="text-purple-400 font-mono font-semibold bg-purple-500/10 px-2 py-0.5 rounded-md">
                        {decimateRatio}%
                      </span>
                    </div>
                    <Slider value={[decimateRatio]} onValueChange={(v) => setDecimateRatio(v[0])} min={10} max={90} step={5} />
                  </div>
                )}
              </div>

              {/* Resolve Intersections */}
              <div className={`p-4 rounded-2xl border transition-all duration-300 ${resolveIntersections ? 'bg-orange-500/10 border-orange-500/30' : 'bg-secondary/40 border-white/5'}`}>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-base font-semibold cursor-pointer flex items-center gap-2" htmlFor="resolve-intersections">
                    <Layers className="w-4 h-4 text-orange-400" />
                    {t.options.resolveIntersections}
                    <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="orange" />
                  </Label>
                  <Switch
                    id="resolve-intersections"
                    checked={resolveIntersections}
                    onCheckedChange={(v) => {
                      setResolveIntersections(v);
                      if (v) setMergeShells(false);
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t.options.resolveIntersectionsDesc}</p>
                {stats && stats.shellCount > 1 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-green-400 bg-green-400/10 border border-green-400/20 rounded-xl px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    {t.options.resolveIntersectionsHint}
                  </div>
                )}
              </div>

              {/* Split Shells */}
              <div className={`p-4 rounded-2xl border transition-all duration-300 ${splitShells ? 'bg-teal-500/10 border-teal-500/30' : 'bg-secondary/40 border-white/5'}`}>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-base font-semibold cursor-pointer flex items-center gap-2" htmlFor="split-shells">
                    <svg className="w-4 h-4 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 14h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M10 4H4v6h6z" strokeOpacity="0.4"/><path d="M14 14h6v6h-6z" strokeOpacity="0.4"/>
                    </svg>
                    {t.options.splitShells}
                    <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="teal" />
                  </Label>
                  <Switch
                    id="split-shells"
                    checked={splitShells}
                    onCheckedChange={(v) => {
                      setSplitShells(v);
                      if (v) setMergeShells(false);
                    }}
                    disabled={mergeShells}
                  />
                </div>
                {mergeShells ? (
                  <p className="text-xs text-yellow-400/80">{t.options.splitShellsConflict}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t.options.splitShellsDesc}</p>
                )}
                {stats && stats.shellCount > 1 && !mergeShells && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-teal-400 bg-teal-400/10 border border-teal-400/20 rounded-xl px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    {t.options.splitShellsHint}
                  </div>
                )}
              </div>

            </div>

            {/* Action Button */}
            {!user ? (
              <button
                onClick={() => { setAuthMode("login"); setShowAuthModal(true); }}
                disabled={!file}
                className="mt-8 w-full py-4 rounded-2xl font-display font-bold text-lg flex items-center justify-center gap-2 bg-secondary border border-white/10 text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <LogIn className="w-5 h-5" />
                {t.auth.signInToEnhance}
              </button>
            ) : !user.isAdmin && user.credits < totalCredits ? (
              <div className="mt-8 space-y-3">
                <CreditCostSummary totalCredits={totalCredits} mergeShells={mergeShells} decimate={decimate} resolveIntersections={resolveIntersections} splitShells={splitShells} />
                <button
                  onClick={() => setShowCreditsModal(true)}
                  className="w-full py-4 rounded-2xl font-display font-bold text-lg flex items-center justify-center gap-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 transition-all duration-300"
                >
                  <CreditCard className="w-5 h-5" />
                  {t.credits.buy}
                </button>
              </div>
            ) : (
              <div className="mt-8 space-y-3">
                {user && !user.isAdmin && (
                  <CreditCostSummary totalCredits={totalCredits} mergeShells={mergeShells} decimate={decimate} resolveIntersections={resolveIntersections} splitShells={splitShells} />
                )}
                <button
                  onClick={handleEnhance}
                  disabled={!file || enhanceMutation.isPending || statsMutation.isPending}
                  className={`
                    w-full py-4 rounded-2xl font-display font-bold text-lg
                    transition-all duration-300 relative overflow-hidden
                    ${(!file || enhanceMutation.isPending)
                      ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                      : 'bg-primary text-primary-foreground hover:shadow-[0_0_40px_-10px_rgba(59,130,246,0.6)] hover:-translate-y-1 active:translate-y-0'}
                  `}
                >
                  {/* Progress fill layer */}
                  {progress > 0 && (
                    <span
                      className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-150 ease-linear"
                      style={{ width: `${progress}%` }}
                    />
                  )}
                  {/* Button label */}
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {enhanceMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        {t.actions.processing} {Math.round(progress)}%
                      </>
                    ) : progress === 100 ? (
                      <>
                        <Download className="w-5 h-5" />
                        {t.actions.enhance}
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5" />
                        {t.actions.enhance}
                      </>
                    )}
                  </span>
                </button>
              </div>
            )}

          {/* Quality Report Panel */}
          {qualityReport && (
            <QualityReportPanel report={qualityReport} />
          )}

          </div>
        </div>

      </main>

      {/* Modals */}
      {showAuthModal && (
        <AuthModal
          initialMode={authMode}
          onClose={() => setShowAuthModal(false)}
        />
      )}
      {showCreditsModal && (
        <CreditsModal onClose={() => setShowCreditsModal(false)} />
      )}
    </div>
  );
}

function CreditBadge({ label, color = "blue" }: { label: string; color?: "blue" | "cyan" | "purple" | "orange" | "gray" | "teal" }) {
  const colors = {
    blue:   "bg-blue-500/15 text-blue-300 border-blue-500/20",
    cyan:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
    teal:   "bg-teal-500/15 text-teal-300 border-teal-500/20",
    purple: "bg-purple-500/15 text-purple-300 border-purple-500/20",
    orange: "bg-orange-500/15 text-orange-300 border-orange-500/20",
    gray:   "bg-white/5 text-muted-foreground border-white/10",
  };
  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${colors[color]} shrink-0`}>
      {label}
    </span>
  );
}

function CreditCostSummary({ totalCredits, mergeShells, decimate, resolveIntersections, splitShells }: { totalCredits: number; mergeShells: boolean; decimate: boolean; resolveIntersections: boolean; splitShells: boolean }) {
  const { t } = useLanguage();
  const label = totalCredits === 1 ? t.credits.creditSingular : t.credits.creditPlural;
  return (
    <div className="rounded-2xl bg-secondary/50 border border-white/8 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t.credits.costBreakdown}</span>
        <span className="text-sm font-bold text-primary">{totalCredits} {label}</span>
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t.credits.costBase}</span>
          <CreditBadge label={`1 ${t.credits.creditSingular}`} color="blue" />
        </div>
        {mergeShells && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-cyan-300">{t.credits.costMerge}</span>
            <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="cyan" />
          </div>
        )}
        {decimate && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-purple-300">{t.credits.costDecimate}</span>
            <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="purple" />
          </div>
        )}
        {resolveIntersections && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-orange-300">{t.credits.costResolve}</span>
            <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="orange" />
          </div>
        )}
        {splitShells && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-teal-300">{t.credits.costSplit}</span>
            <CreditBadge label={`+1 ${t.credits.creditSingular}`} color="teal" />
          </div>
        )}
      </div>
      <div className="h-px bg-border" />
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{t.credits.totalCost}</span>
        <span className={`text-base font-black font-mono ${
          totalCredits >= 4 ? 'text-orange-400' :
          totalCredits === 3 ? 'text-purple-400' :
          totalCredits === 2 ? 'text-cyan-400' : 'text-blue-400'
        }`}>
          {totalCredits} {label}
        </span>
      </div>
    </div>
  );
}

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
