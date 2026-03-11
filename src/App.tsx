import { Spin } from 'antd';
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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

const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/log-analyzer" replace />} />
        <Route
          path="log-analyzer"
          element={
            <Suspense fallback={<Loading />}>
              <LogAnalyzer />
            </Suspense>
          }
        />
        <Route
          path="command-builder"
          element={
            <Suspense fallback={<Loading />}>
              <CommandBuilder />
            </Suspense>
          }
        />
        <Route
          path="sop-builder"
          element={
            <Suspense fallback={<Loading />}>
              <SOPBuilder />
            </Suspense>
          }
        />
        <Route
          path="ssh-manager"
          element={
            <Suspense fallback={<Loading />}>
              <SSHManager />
            </Suspense>
          }
        />
        <Route
          path="number-converter"
          element={
            <Suspense fallback={<Loading />}>
              <NumberConverter />
            </Suspense>
          }
        />
        <Route
          path="file-hasher"
          element={
            <Suspense fallback={<Loading />}>
              <FileHasher />
            </Suspense>
          }
        />
        <Route
          path="fio-visualizer"
          element={
            <Suspense fallback={<Loading />}>
              <FIOVisualizer />
            </Suspense>
          }
        />
        <Route
          path="hex-lba-explorer"
          element={
            <Suspense fallback={<Loading />}>
              <HexLBAExplorer />
            </Suspense>
          }
        />
        <Route
          path="crash-analyzer"
          element={
            <Suspense fallback={<Loading />}>
              <CrashAnalyzer />
            </Suspense>
          }
        />
        <Route
          path="protocol-decoder"
          element={
            <Suspense fallback={<Loading />}>
              <ProtocolDecoder />
            </Suspense>
          }
        />
        <Route
          path="timeline-correlator"
          element={
            <Suspense fallback={<Loading />}>
              <TimelineCorrelator />
            </Suspense>
          }
        />
        <Route
          path="fault-builder"
          element={
            <Suspense fallback={<Loading />}>
              <FaultBuilder />
            </Suspense>
          }
        />
        <Route
          path="io-analyzer"
          element={
            <Suspense fallback={<Loading />}>
              <IOAnalyzer />
            </Suspense>
          }
        />
        <Route
          path="code-profiler"
          element={
            <Suspense fallback={<Loading />}>
              <CodeProfiler />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
