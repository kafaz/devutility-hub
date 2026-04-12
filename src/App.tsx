import { Spin } from 'antd';
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from './components/Layout/AppLayout';

const LogAnalyzer    = lazy(() => import('./modules/LogAnalyzer'));
const CommandBuilder = lazy(() => import('./modules/CommandBuilder'));
const SOPBuilder        = lazy(() => import('./modules/SOPBuilder'));
const SSHManager        = lazy(() => import('./modules/SSHManager'));
const NumberConverter   = lazy(() => import('./modules/NumberConverter'));
const FileHasher        = lazy(() => import('./modules/FileHasher'));
const FIOVisualizer     = lazy(() => import('./modules/FIOVisualizer'));
const HexLBAExplorer    = lazy(() => import('./modules/HexLBAExplorer'));
const CrashAnalyzer     = lazy(() => import('./modules/CrashAnalyzer'));
const ProtocolDecoder   = lazy(() => import('./modules/ProtocolDecoder'));
const TimelineCorrelator = lazy(() => import('./modules/TimelineCorrelator'));
const FaultBuilder      = lazy(() => import('./modules/FaultBuilder'));
const IOAnalyzer        = lazy(() => import('./modules/IOAnalyzer'));
const CodeProfiler      = lazy(() => import('./modules/CodeProfiler'));
const DiagnosticWorkbench = lazy(() => import('./modules/DiagnosticWorkbench'));
const CodeContextExplorer = lazy(() => import('./modules/CodeContextExplorer'));
const BlockBenchmark    = lazy(() => import('./modules/BlockBenchmark'));

interface ToolRouteDefinition {
  path: string;
  Component: React.LazyExoticComponent<React.ComponentType>;
}

const TOOL_ROUTES: ToolRouteDefinition[] = [
  { path: '/log-analyzer', Component: LogAnalyzer },
  { path: '/command-builder', Component: CommandBuilder },
  { path: '/sop-builder', Component: SOPBuilder },
  { path: '/ssh-manager', Component: SSHManager },
  { path: '/number-converter', Component: NumberConverter },
  { path: '/file-hasher', Component: FileHasher },
  { path: '/fio-visualizer', Component: FIOVisualizer },
  { path: '/hex-lba-explorer', Component: HexLBAExplorer },
  { path: '/crash-analyzer', Component: CrashAnalyzer },
  { path: '/protocol-decoder', Component: ProtocolDecoder },
  { path: '/timeline-correlator', Component: TimelineCorrelator },
  { path: '/fault-builder', Component: FaultBuilder },
  { path: '/io-analyzer', Component: IOAnalyzer },
  { path: '/code-profiler', Component: CodeProfiler },
  { path: '/diagnostic-workbench', Component: DiagnosticWorkbench },
  { path: '/code-context-explorer', Component: CodeContextExplorer },
  { path: '/block-benchmark', Component: BlockBenchmark },
];

const TOOL_ROUTE_MAP = new Map(TOOL_ROUTES.map((route) => [route.path, route]));

const Loading: React.FC = () => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '60vh',
    }}
  >
    <Spin size="large" />
  </div>
);

const PersistentToolPages: React.FC = () => {
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const activePath = normalizedPath === '/' ? '/log-analyzer' : normalizedPath;
  const activeRoute = TOOL_ROUTE_MAP.get(activePath);
  const [visitedPaths, setVisitedPaths] = useState<string[]>(activeRoute ? [activePath] : ['/log-analyzer']);

  useEffect(() => {
    if (!activeRoute) return;
    setVisitedPaths((current) =>
      current.includes(activePath) ? current : [...current, activePath]
    );
  }, [activePath, activeRoute]);

  if (!activeRoute) {
    return <Navigate to="/log-analyzer" replace />;
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      {visitedPaths.map((path) => {
        const route = TOOL_ROUTE_MAP.get(path);
        if (!route) return null;
        const RouteComponent = route.Component;
        const isActive = path === activePath;

        return (
          <div
            key={path}
            aria-hidden={!isActive}
            style={{
              display: isActive ? 'block' : 'none',
              minHeight: isActive ? '100vh' : undefined,
            }}
          >
            <Suspense fallback={<Loading />}>
              <RouteComponent />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
};

const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/log-analyzer" replace />} />
        <Route path="*" element={<PersistentToolPages />} />
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
