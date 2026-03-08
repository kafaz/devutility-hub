import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import AppLayout from './components/Layout/AppLayout';

const LogAnalyzer    = lazy(() => import('./modules/LogAnalyzer'));
const CommandBuilder = lazy(() => import('./modules/CommandBuilder'));
const SOPBuilder        = lazy(() => import('./modules/SOPBuilder'));
const SSHManager        = lazy(() => import('./modules/SSHManager'));
const NumberConverter   = lazy(() => import('./modules/NumberConverter'));

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
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
