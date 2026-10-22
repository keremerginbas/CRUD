import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import {App} from './App';

// Theme is a per-viewer preference; storage may be unavailable in some contexts.
try {
  const saved = localStorage.getItem('ilan5.theme');
  // The command-center look is dark by default; a saved choice wins.
  const dark = saved ? saved === 'dark' : true;
  document.documentElement.classList.toggle('dark', dark);
} catch { /* light theme */ }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
