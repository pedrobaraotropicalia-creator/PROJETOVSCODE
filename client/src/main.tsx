import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './styles.css';

// no celular o aviso vai para o topo: embaixo ele cobria por alguns segundos o botão principal (Salvar e continuar, Finalizar caixa)
const telaEstreita = window.matchMedia('(max-width: 800px)');
const acompanhar = (avisar: () => void) => { telaEstreita.addEventListener('change', avisar); return () => telaEstreita.removeEventListener('change', avisar); };
function Avisos() {
  const estreita = useSyncExternalStore(acompanhar, () => telaEstreita.matches);
  return <Toaster position={estreita ? 'top-center' : 'bottom-right'} richColors style={{ fontFamily: "'DM Sans', sans-serif" }} />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><Avisos /></React.StrictMode>);
