// @spec DFF-STATIC-001
// @spec DFF-STATIC-002
// @spec DFF-STATIC-003
// @spec DFF-STATIC-004
import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import '../ui/styles.css';

const savedTheme = localStorage.getItem('dff-theme') ?? 'ember';
document.documentElement.setAttribute('data-theme', savedTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
