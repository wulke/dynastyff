// @spec DFF-STATIC-001
// @spec DFF-STATIC-002
// @spec DFF-STATIC-003
// @spec DFF-STATIC-004
import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import '../ui/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
