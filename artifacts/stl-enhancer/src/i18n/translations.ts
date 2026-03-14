export type Language = "en" | "pt-BR";

export const translations = {
  en: {
    appName: "STL Enhancer",
    header: {
      file: "file loaded",
    },
    upload: {
      title: "Drag & Drop your STL",
      description: "Upload a raw or corrupted 3D model from Meshy or any CAD software to analyze and enhance its geometry.",
      browse: "Browse Files",
    },
    viewer: {
      toggleWireframe: "Toggle Wireframe",
      uploadNew: "Upload New File",
      noModel: "No Model Loaded",
    },
    stats: {
      title: "Mesh Analytics",
      triangles: "Triangles",
      vertices: "Vertices",
      volume: "Volume",
      surfaceArea: "Surface Area",
      watertight: "Watertight (Manifold)",
      yes: "Yes",
      no: "No",
      duplicate: "Duplicate Triangles",
      degenerate: "Degenerate Triangles",
    },
    options: {
      title: "Enhancement Options",
      fillHoles: "Fill Holes",
      fillHolesDesc: "Detects and closes open boundary edges where geometries meet (e.g. feathers vs vest). Fixes non-manifold edge errors.",
      fillHolesWarning: "Open mesh detected — enable this option to close the mesh holes.",
      smoothing: "Laplacian Smoothing",
      smoothingDesc: "Smooths rough edges and sharp artifacts commonly found in AI-generated or scanned models. Higher values may lose fine detail.",
      smoothingPasses: "passes",
      removeDuplicates: "Remove Duplicates",
      removeDuplicatesDesc: "Cleans up zero-area triangles and overlapping vertices.",
      fixNormals: "Fix Normals",
      fixNormalsDesc: "Recalculates inverted faces for proper 3D printing.",
    },
    actions: {
      enhance: "Enhance & Download",
      processing: "Processing Model...",
    },
    toast: {
      analyzeError: "Error analyzing file",
      analyzeErrorDesc: "Failed to get STL statistics",
      enhanceDone: "Enhancement Complete",
      enhanceDoneDesc: "Your optimized STL file has been downloaded.",
      enhanceFail: "Enhancement Failed",
      enhanceFailDesc: "Something went wrong during processing.",
    },
  },
  "pt-BR": {
    appName: "STL Enhancer",
    header: {
      file: "arquivo carregado",
    },
    upload: {
      title: "Arraste e Solte seu STL",
      description: "Envie um modelo 3D bruto ou corrompido do Meshy ou qualquer software CAD para analisar e melhorar sua geometria.",
      browse: "Selecionar Arquivo",
    },
    viewer: {
      toggleWireframe: "Alternar Wireframe",
      uploadNew: "Enviar Novo Arquivo",
      noModel: "Nenhum Modelo Carregado",
    },
    stats: {
      title: "Análise da Malha",
      triangles: "Triângulos",
      vertices: "Vértices",
      volume: "Volume",
      surfaceArea: "Área de Superfície",
      watertight: "Fechado (Manifold)",
      yes: "Sim",
      no: "Não",
      duplicate: "Triângulos Duplicados",
      degenerate: "Triângulos Degenerados",
    },
    options: {
      title: "Opções de Melhoria",
      fillHoles: "Fechar Buracos",
      fillHolesDesc: "Detecta e fecha bordas abertas onde geometrias se encontram (ex: penas vs colete). Resolve erros de \"bordas não múltiplas\".",
      fillHolesWarning: "Malha aberta detectada — ative esta opção para fechar os buracos da malha.",
      smoothing: "Suavização Laplaciana",
      smoothingDesc: "Suaviza bordas ásperas e artefatos comuns em modelos gerados por IA ou escaneados. Valores altos podem perder detalhes.",
      smoothingPasses: "passagens",
      removeDuplicates: "Remover Duplicados",
      removeDuplicatesDesc: "Remove triângulos de área zero e vértices sobrepostos.",
      fixNormals: "Corrigir Normais",
      fixNormalsDesc: "Recalcula faces invertidas para impressão 3D correta.",
    },
    actions: {
      enhance: "Melhorar & Baixar",
      processing: "Processando Modelo...",
    },
    toast: {
      analyzeError: "Erro ao analisar arquivo",
      analyzeErrorDesc: "Falha ao obter estatísticas do STL",
      enhanceDone: "Melhoria Concluída",
      enhanceDoneDesc: "Seu arquivo STL otimizado foi baixado.",
      enhanceFail: "Falha na Melhoria",
      enhanceFailDesc: "Algo deu errado durante o processamento.",
    },
  },
} as const;

export type Translations = (typeof translations)["en"];
