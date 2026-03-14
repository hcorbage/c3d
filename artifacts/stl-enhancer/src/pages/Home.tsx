import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Upload, Box, Zap, Settings2, Download, 
  Activity, Info, Layers, Maximize, AlertCircle, Eye, EyeOff, ShieldCheck,
  LogIn, LogOut, User, CreditCard
} from "lucide-react";
import { useEnhanceStl, useGetStlStats } from "@workspace/api-client-react";
import { StlViewer } from "@/components/StlViewer";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { StlStats } from "@workspace/api-client-react";
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
      onSuccess: (blob) => {
        // Salva URL para visualização comparativa
        const previewUrl = window.URL.createObjectURL(blob);
        setEnhancedFileUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return previewUrl;
        });

        // Download automático
        const a = document.createElement("a");
        a.href = previewUrl;
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

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setFileUrl(url);
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
    if (!user.isAdmin && user.credits < 1) {
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
              <h3 className="text-2xl font-display font-bold mb-2">{t.upload.title}</h3>
              <p className="text-muted-foreground max-w-md text-center">
                {t.upload.description}
              </p>
              
              <button className="mt-8 px-6 py-3 rounded-full bg-primary/10 text-primary font-semibold hover:bg-primary hover:text-white transition-colors">
                {t.upload.browse}
              </button>
            </motion.div>
          )}

          {file && !enhancedFileUrl && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex-1 relative glass-panel rounded-3xl overflow-hidden flex flex-col group"
            >
              <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button
                  onClick={() => setIsWireframe(!isWireframe)}
                  className="p-3 rounded-xl bg-background/80 backdrop-blur border border-white/10 hover:bg-secondary transition-colors text-foreground shadow-lg"
                  title={t.viewer.toggleWireframe}
                >
                  {isWireframe ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
                <button
                  {...getRootProps()}
                  className="p-3 rounded-xl bg-background/80 backdrop-blur border border-white/10 hover:bg-secondary transition-colors text-foreground shadow-lg"
                  title={t.viewer.uploadNew}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-5 h-5" />
                </button>
              </div>
              <StlViewer fileUrl={fileUrl} wireframe={isWireframe} />
            </motion.div>
          )}

          {file && enhancedFileUrl && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex-1 flex flex-col gap-3"
            >
              {/* Barra de controles */}
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground">{t.viewer.compareHint}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsWireframe(!isWireframe)}
                    className="p-2 rounded-xl bg-secondary/60 border border-white/8 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                    title={t.viewer.toggleWireframe}
                  >
                    {isWireframe ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    {...getRootProps()}
                    className="p-2 rounded-xl bg-secondary/60 border border-white/8 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                    title={t.viewer.uploadNew}
                  >
                    <input {...getInputProps()} />
                    <Upload className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Dois visualizadores lado a lado */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 min-h-[400px]">
                <div className="glass-panel rounded-2xl overflow-hidden">
                  <StlViewer
                    fileUrl={fileUrl}
                    wireframe={isWireframe}
                    label={t.viewer.original}
                    labelColor="blue"
                  />
                </div>
                <div className="glass-panel rounded-2xl overflow-hidden">
                  <StlViewer
                    fileUrl={enhancedFileUrl}
                    wireframe={isWireframe}
                    label={t.viewer.enhanced}
                    labelColor="green"
                  />
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
                    <Label className="text-base text-foreground font-medium">{t.options.smoothing}</Label>
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
                    <Label className="text-base font-medium cursor-pointer" htmlFor="remove-dupes">{t.options.removeDuplicates}</Label>
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
                    <Label className="text-base font-medium cursor-pointer" htmlFor="fix-normals">{t.options.fixNormals}</Label>
                    <p className="text-xs text-muted-foreground">{t.options.fixNormalsDesc}</p>
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
            {!user ? (
              <button
                onClick={() => { setAuthMode("login"); setShowAuthModal(true); }}
                disabled={!file}
                className="mt-8 w-full py-4 rounded-2xl font-display font-bold text-lg flex items-center justify-center gap-2 bg-secondary border border-white/10 text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <LogIn className="w-5 h-5" />
                {t.auth.signInToEnhance}
              </button>
            ) : !user.isAdmin && user.credits < 1 ? (
              <button
                onClick={() => setShowCreditsModal(true)}
                className="mt-8 w-full py-4 rounded-2xl font-display font-bold text-lg flex items-center justify-center gap-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 transition-all duration-300"
              >
                <CreditCard className="w-5 h-5" />
                {t.credits.buy}
              </button>
            ) : (
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
                    {t.actions.processing}
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    {t.actions.enhance}
                  </>
                )}
              </button>
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
