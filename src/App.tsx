import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import AppLayout from './components/Layout/AppLayout';

const LogAnalyzer = lazy(() => import('./modules/LogAnalyzer'));
const CommandBuilder = lazy(() => import('./modules/CommandBuilder'));

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
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
