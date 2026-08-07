import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PanelInterno from './components/PanelInterno';
import SolicitudPublica from './components/SolicitudPublica';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/solicitar-acceso" element={<SolicitudPublica />} />
        <Route path="/*" element={<PanelInterno />} />
      </Routes>
    </BrowserRouter>
  );
}
