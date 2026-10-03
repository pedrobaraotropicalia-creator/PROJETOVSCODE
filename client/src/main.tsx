import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><Toaster position="bottom-right" richColors style={{ fontFamily: "'DM Sans', sans-serif" }} /></React.StrictMode>);
