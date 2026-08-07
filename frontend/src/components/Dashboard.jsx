import { useEffect, useState } from 'react';
import api from '../services/api';
import ClienteFormModal from './ClienteFormModal';

const ESTADO_LABELS = {
  trial: 'Trial',
  activo: 'Activo',
  bloqueado: 'Bloqueado',
  cancelado: 'Cancelado',
};

// Mismo cálculo que backend/routes/auth.js de SUJAM (trialEstado por fecha)
// — aquí es solo informativo para mostrar cuánto le queda; el bloqueo real
// de esta fecha lo aplica cada instancia con su propia lógica de trial.
function diasRestantesTrial(cliente) {
  if (cliente.estado !== 'trial' || !cliente.trialExpiraAt) return null;
  const ahora = new Date();
  const expira = new Date(cliente.trialExpiraAt);
  const soloLecturaHasta = cliente.trialSoloLecturaHasta ? new Date(cliente.trialSoloLecturaHasta) : null;
  const diasParaExpirar = Math.ceil((expira - ahora) / (1000 * 60 * 60 * 24));
  if (diasParaExpirar > 0) return { texto: `${diasParaExpirar} día(s) de escritura`, vencido: false };
  if (soloLecturaHasta && ahora <= soloLecturaHasta) {
    const diasGracia = Math.ceil((soloLecturaHasta - ahora) / (1000 * 60 * 60 * 24));
    return { texto: `${diasGracia} día(s) solo lectura`, vencido: true };
  }
  return { texto: 'Vencido — debería estar bloqueado', vencido: true };
}

export default function Dashboard({ staff, onLogout }) {
  const [tab, setTab] = useState('clientes');
  const [clientes, setClientes] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [clienteEditando, setClienteEditando] = useState(null);

  const cargarClientes = async () => {
    const res = await api.get('/clientes');
    setClientes(res.data.data || []);
  };

  const cargarSolicitudes = async () => {
    const res = await api.get('/solicitudes');
    setSolicitudes(res.data.data || []);
  };

  useEffect(() => {
    setCargando(true);
    Promise.all([cargarClientes(), cargarSolicitudes()]).finally(() => setCargando(false));
  }, []);

  const handleDarDeAlta = async (cliente) => {
    if (!window.confirm(`¿Confirmar que "${cliente.nombreComercial}" ya pagó y pasa a estado Activo?`)) return;
    const res = await api.put(`/clientes/${cliente.id}/dar-de-alta`);
    if (res.data.avisoBridge) window.alert(res.data.avisoBridge);
    cargarClientes();
  };

  const handleNuevoCliente = () => {
    setClienteEditando(null);
    setModalAbierto(true);
  };

  const handleEditarCliente = (cliente) => {
    setClienteEditando(cliente);
    setModalAbierto(true);
  };

  const handleGuardadoCliente = () => {
    setModalAbierto(false);
    cargarClientes();
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <strong>Panel de Control</strong> — CorpSimtelec
        </div>
        <div>
          {staff.nombre} <button className="btn-link" onClick={onLogout}>Salir</button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'clientes' ? 'tab-activo' : ''} onClick={() => setTab('clientes')}>
          Clientes ({clientes.length})
        </button>
        <button className={tab === 'solicitudes' ? 'tab-activo' : ''} onClick={() => setTab('solicitudes')}>
          Solicitudes ({solicitudes.length})
        </button>
      </nav>

      {cargando ? (
        <p className="pad">Cargando...</p>
      ) : tab === 'clientes' ? (
        <div className="pad">
          <div className="toolbar">
            <button onClick={handleNuevoCliente}>+ Nuevo cliente</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Nombre comercial</th>
                <th>Tipo</th>
                <th>Dominio</th>
                <th>Estado</th>
                <th>Trial</th>
                <th>Contacto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => {
                const trial = diasRestantesTrial(c);
                return (
                  <tr key={c.id}>
                    <td>{c.nombreComercial}</td>
                    <td>{c.tipoDespliegue === 'marca_blanca' ? 'Marca blanca' : 'Tenant CorpSimtelec'}</td>
                    <td>{c.dominioFrontend || '—'}</td>
                    <td><span className={`badge badge-${c.estado}`}>{ESTADO_LABELS[c.estado] || c.estado}</span></td>
                    <td>{trial ? <span className={trial.vencido ? 'texto-alerta' : ''}>{trial.texto}</span> : '—'}</td>
                    <td>{c.contactoEmail || '—'}</td>
                    <td className="acciones">
                      <button className="btn-link" onClick={() => handleEditarCliente(c)}>Editar</button>
                      {c.estado === 'trial' && (
                        <button className="btn-link" onClick={() => handleDarDeAlta(c)}>Dar de alta</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {clientes.length === 0 && (
                <tr><td colSpan={7} className="vacio">Sin clientes registrados todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pad">
          <table>
            <thead>
              <tr>
                <th>Solicitante</th>
                <th>Empresa</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th>Estado</th>
                <th>Cliente vinculado</th>
              </tr>
            </thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.id}>
                  <td>{s.nombreSolicitante}</td>
                  <td>{s.empresa || '—'}</td>
                  <td>{s.email}</td>
                  <td>{s.telefono || '—'}</td>
                  <td><span className={`badge badge-${s.estado}`}>{s.estado}</span></td>
                  <td>{s.cliente?.nombreComercial || '—'}</td>
                </tr>
              ))}
              {solicitudes.length === 0 && (
                <tr><td colSpan={6} className="vacio">Sin solicitudes todavía — la Fase 3 (formulario público) las alimentará aquí.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <ClienteFormModal
          cliente={clienteEditando}
          onClose={() => setModalAbierto(false)}
          onGuardado={handleGuardadoCliente}
        />
      )}
    </div>
  );
}
