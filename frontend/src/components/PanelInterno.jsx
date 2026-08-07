import { useEffect, useState } from 'react';
import api from '../services/api';
import Login from './Login';
import Dashboard from './Dashboard';

export default function PanelInterno() {
  const [staff, setStaff] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('panel_token');
    if (!token) {
      setCargando(false);
      return;
    }
    api.get('/auth/me')
      .then((res) => setStaff(res.data.staff))
      .catch(() => {
        localStorage.removeItem('panel_token');
        localStorage.removeItem('panel_staff');
      })
      .finally(() => setCargando(false));
  }, []);

  const handleLogin = (staffData, token) => {
    localStorage.setItem('panel_token', token);
    localStorage.setItem('panel_staff', JSON.stringify(staffData));
    setStaff(staffData);
  };

  const handleLogout = () => {
    localStorage.removeItem('panel_token');
    localStorage.removeItem('panel_staff');
    setStaff(null);
  };

  if (cargando) return <div className="pantalla-centrada">Cargando...</div>;

  return staff
    ? <Dashboard staff={staff} onLogout={handleLogout} />
    : <Login onLogin={handleLogin} />;
}
