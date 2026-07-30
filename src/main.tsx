import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/theme.css';

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');

// NOTE: no StrictMode. StrictMode double-invokes effects in development, which
// would build (and dispose) the entire WebGL scene twice on mount - ~2s of
// wasted procedural generation and a real risk of context loss. The engine
// lifecycle is guarded, but there is nothing to gain here.
createRoot(host).render(<App />);
