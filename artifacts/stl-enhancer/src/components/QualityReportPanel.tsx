import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, TrendingDown, GitMerge, Shield, Minus, Layers } from "lucide-react";
import type { QualityReport } from "@workspace/api-client-react";
import { useLanguage } from "@/i18n/LanguageContext";

interface Props {
  report: QualityReport;
}

function Delta({ before, after, lowerIsBetter = true }: { before: number; after: number; lowerIsBetter?: boolean }) {
  const diff = after - before;
  if (diff === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`text-xs font-medium ${improved ? "text-green-400" : "text-red-400"}`}>
      {diff > 0 ? "+" : ""}{diff.toLocaleString()}
    </span>
  );
}

export function QualityReportPanel({ report }: Props) {
  const { t } = useLanguage();
  const { before, after, fixes } = report;

  const fixEntries = [
    { count: fixes.holesFilled, label: t.report.holesFilled, icon: <Shield size={13} className="text-blue-400" /> },
    { count: fixes.duplicatesRemoved, label: t.report.duplicatesRemoved, icon: <Minus size={13} className="text-yellow-400" /> },
    { count: fixes.degeneratesRemoved, label: t.report.degeneratesRemoved, icon: <Minus size={13} className="text-yellow-400" /> },
    { count: fixes.trianglesReduced, label: t.report.trianglesReduced, icon: <TrendingDown size={13} className="text-purple-400" /> },
    { count: fixes.shellsMerged, label: t.report.shellsMerged, icon: <GitMerge size={13} className="text-cyan-400" /> },
    { count: fixes.intersectionsResolved ?? 0, label: t.report.intersectionsResolved, icon: <Layers size={13} className="text-orange-400" /> },
  ].filter(e => e.count > 0);

  const totalIssues = fixEntries.reduce((s, e) => s + e.count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-white/8 bg-secondary/30 backdrop-blur-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
        <CheckCircle2 size={16} className="text-green-400" />
        <span className="text-sm font-semibold text-foreground">{t.report.title}</span>
      </div>

      {/* Before / After grid */}
      <div className="p-4 grid grid-cols-2 gap-3 border-b border-white/8">
        {/* Before column */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            {t.report.before}
          </div>
          <div className="space-y-1.5 text-xs">
            <StatRow label={t.report.triangles} value={before.triangles.toLocaleString()} />
            <StatRow label={t.report.vertices} value={before.vertices.toLocaleString()} />
            <StatRow label={t.report.shells} value={before.shells.toLocaleString()} warn={before.shells > 1} />
            <StatRow label={t.report.openEdges} value={before.openEdges.toLocaleString()} warn={before.openEdges > 0} />
            <StatRow label={t.report.manifold} value={before.isManifold ? t.report.yes : t.report.no} warn={!before.isManifold} />
          </div>
        </div>

        {/* After column */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            {t.report.after}
          </div>
          <div className="space-y-1.5 text-xs">
            <StatRowWithDelta label={t.report.triangles} before={before.triangles} after={after.triangles} />
            <StatRowWithDelta label={t.report.vertices} before={before.vertices} after={after.vertices} />
            <StatRowWithDelta label={t.report.shells} before={before.shells} after={after.shells} />
            <StatRowWithDelta label={t.report.openEdges} before={before.openEdges} after={after.openEdges} />
            <StatRow
              label={t.report.manifold}
              value={after.isManifold ? t.report.yes : t.report.no}
              highlight={after.isManifold && !before.isManifold}
            />
          </div>
        </div>
      </div>

      {/* Fixes applied */}
      <div className="p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t.report.fixes}
        </div>
        {fixEntries.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-green-400">
            <CheckCircle2 size={13} />
            {t.report.noIssues}
          </div>
        ) : (
          <div className="space-y-1.5">
            {fixEntries.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-foreground/80">
                {e.icon}
                <span className="font-semibold text-foreground">{e.count.toLocaleString()}</span>
                <span>{e.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Unit warning if present */}
      {before.unitWarning && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/8 border border-yellow-400/20 rounded-lg px-3 py-2">
            <AlertTriangle size={13} />
            {before.unitWarning === "inches"
              ? t.stats.unitWarningInches
              : t.stats.unitWarningMeters}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function StatRow({ label, value, warn = false, highlight = false }: { label: string; value: string; warn?: boolean; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className={warn ? "text-red-400 font-medium" : highlight ? "text-green-400 font-medium" : "text-foreground"}>{value}</span>
    </div>
  );
}

function StatRowWithDelta({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div className="flex justify-between items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-foreground">{after.toLocaleString()}</span>
        <Delta before={before} after={after} />
      </div>
    </div>
  );
}
