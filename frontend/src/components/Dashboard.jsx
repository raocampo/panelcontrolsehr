import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import ClienteFormModal from './ClienteFormModal';

const ESTADO_LABELS = {
  trial: 'Trial',
  activo: 'Activo',
  bloqueado: 'Bloqueado',
  cancelado: 'Cancelado',
};

const TIPO_EMPRESA_LABELS = {
  medico: 'Médico',
  consorcio: 'Consorcio',
  hospital_clinica: 'Hospital/Clínica',
};

const APROVISIONAMIENTO_LABELS = {
  pendiente: 'Pendiente',
  aprovisionando: 'Aprovisionando…',
  listo: 'Listo',
  error: 'Error',
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

  // Mientras haya algún cliente "aprovisionando", refresca su estado real cada
  // pocos segundos — el tenant se sincroniza consultando SUJAM (GET
  // /:id/aprovisionamiento); marca_blanca lo actualiza sola su propio worker
  // async, así que para esos alcanza con releer la lista.
  const clientesRef = useRef(clientes);
  useEffect(() => { clientesRef.current = clientes; }, [clientes]);
  useEffect(() => {
    const id = setInterval(async () => {
      const enCurso = clientesRef.current.filter((c) => c.aprovisionamiento === 'aprovisionando');
      if (enCurso.length === 0) return;
      await Promise.all(
        enCurso
          .filter((c) => c.tipoDespliegue === 'tenant_corpsimtelec')
          .map((c) => api.get(`/clientes/${c.id}/aprovisionamiento`).catch(() => {})),
      );
      cargarClientes();
    }, 6000);
    return () => clearInterval(id);
  }, []);

  const handleDarDeAlta = async (cliente) => {
    if (!window.confirm(`¿Confirmar que "${cliente.nombreComercial}" ya pagó y pasa a estado Activo?`)) return;
    const res = await api.put(`/clientes/${cliente.id}/dar-de-alta`);
    if (res.data.avisoBridge) window.alert(res.data.avisoBridge);
    cargarClientes();
  };

  const handleAprovisionar = async (cliente) => {
    try {
      if (cliente.tipoDespliegue === 'marca_blanca') {
        if (!window.confirm(
          `Esto crea infraestructura REAL y facturable (Railway + Vercel) para "${cliente.nombreComercial}". ¿Confirmar?`,
        )) return;
        const res = await api.post(`/clientes/${cliente.id}/aprovisionar`, { confirmar: true });
        window.alert(res.data.mensaje || 'Aprovisionamiento iniciado.');
      } else {
        await api.post(`/clientes/${cliente.id}/aprovisionar`);
      }
      cargarClientes();
    } catch (err) {
      window.alert(err.response?.data?.mensaje || 'Error al aprovisionar');
    }
  };

  const handleActualizarVersion = async (cliente) => {
    const versionRef = window.prompt(
      `Rama, tag o commit al que fijar "${cliente.nombreComercial}" (no afecta a otros clientes):`,
      cliente.versionRef || 'main',
    );
    if (!versionRef) return;
    if (!window.confirm(`Esto redespliega la infraestructura real de "${cliente.nombreComercial}" a "${versionRef}". ¿Confirmar?`)) return;
    try {
      const res = await api.post(`/clientes/${cliente.id}/actualizar-version`, { versionRef, confirmar: true });
      window.alert(res.data.mensaje || 'Actualización iniciada.');
      cargarClientes();
    } catch (err) {
      window.alert(err.response?.data?.mensaje || 'Error al actualizar versión');
    }
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
                <th>Empresa</th>
                <th>Dominio</th>
                <th>Aprovisionamiento</th>
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
                    <td>{TIPO_EMPRESA_LABELS[c.tipoEmpresa] || c.tipoEmpresa}</td>
                    <td>
                      {c.dominioFrontend
                        ? <a href={`https://${c.dominioFrontend}`} target="_blank" rel="noreferrer">{c.dominioFrontend}</a>
                        : '—'}
                    </td>
                    <td>
                      <span className={`badge badge-${c.aprovisionamiento}`}>
                        {APROVISIONAMIENTO_LABELS[c.aprovisionamiento] || c.aprovisionamiento}
                      </span>
                      {c.tipoDespliegue === 'marca_blanca' && c.aprovisionamiento === 'listo' && (
                        <div className="texto-chico">v: {c.versionRef}</div>
                      )}
                    </td>
                    <td><span className={`badge badge-${c.estado}`}>{ESTADO_LABELS[c.estado] || c.estado}</span></td>
                    <td>{trial ? <span className={trial.vencido ? 'texto-alerta' : ''}>{trial.texto}</span> : '—'}</td>
                    <td>{c.contactoEmail || '—'}</td>
                    <td className="acciones">
                      <button className="btn-link" onClick={() => handleEditarCliente(c)}>Editar</button>
                      {c.estado === 'trial' && (
                        <button className="btn-link" onClick={() => handleDarDeAlta(c)}>Dar de alta</button>
                      )}
                      {(c.aprovisionamiento === 'pendiente' || c.aprovisionamiento === 'error') && (
                        <button className="btn-link" onClick={() => handleAprovisionar(c)}>
                          {c.aprovisionamiento === 'error' ? 'Reintentar' : 'Aprovisionar'}
                        </button>
                      )}
                      {c.tipoDespliegue === 'marca_blanca' && c.aprovisionamiento === 'listo' && (
                        <button className="btn-link" onClick={() => handleActualizarVersion(c)}>Actualizar versión</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {clientes.length === 0 && (
                <tr><td colSpan={9} className="vacio">Sin clientes registrados todavía.</td></tr>
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
