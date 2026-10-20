// Entry point: connects to the HMI server and renders the screens
import { createRoot } from 'react-dom/client';
import { HmiProvider } from './connection';
import App from './App';
import './hmi.css';

createRoot(document.getElementById('root')!).render(
  <HmiProvider>
    <App />
  </HmiProvider>
);
