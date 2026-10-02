// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

// Apply saved theme or default to ember before first render to avoid flash
const savedTheme = localStorage.getItem('dff-theme') ?? 'ember';
document.documentElement.setAttribute('data-theme', savedTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
