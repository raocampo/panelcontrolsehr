import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

const STEPS = [
  ['preparando_bd', 'Base de datos'], ['creando_administrador', 'Administrador'],
  ['asociando_dominio', 'Dominio'], ['esperando_dns', 'DNS'],
  ['esperando_ssl', 'HTTPS'], ['verificando', 'Aplicación y acceso'],
];
export default function TenantAccessPanel({ cliente, canReset = false }) {
  const [progress, setProgress] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [access, setAccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const resetKey = useRef(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await api.get(`/clientes/${cliente.id}/aprovisionamiento`);
        if (active) { setProgress(r.data.data); setError(''); }
      } catch (e) { if (active) setError(e.response?.data?.mensaje || 'No se pudo consultar el progreso.'); }
    };
    load();
    const timer = setInterval(load, 6000);
    return () => { active = false; clearInterval(timer); };
  }, [cliente.id]);
  const loadAdmin = async () => {
    try { const r = await api.get(`/clientes/${cliente.id}/administrador`); setAdmin(r.data.data); }
    catch (e) { setError(e.response?.data?.mensaje || 'Todavía no se puede consultar el administrador.'); }
  };
  const verify = async () => {
    setBusy(true); setError('');
    try { await api.post(`/clientes/${cliente.id}/verificar-acceso`); setMessage('Verificación guardada. El progreso se actualizará automáticamente.'); }
    catch (e) { setError(e.response?.data?.mensaje || 'No se pudo programar la verificación.'); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    const email = admin?.email || progress?.administrador?.email;
    if (!window.confirm(`Se reemplazará la contraseña de ${email} y se cerrarán sus sesiones. ¿Generar una nueva clave temporal?`)) return;
    resetKey.current ||= crypto.randomUUID();
    setBusy(true); setError(''); setAccess(null);
    try {
      const r = await api.post(`/clientes/${cliente.id}/administrador/restablecer`, {}, { headers: { 'Idempotency-Key': resetKey.current } });
      setAdmin(r.data.data); setAccess(r.data.accesoInicial || null); setMessage(r.data.mensaje);
      resetKey.current = null;
    } catch (e) { setError(e.response?.data?.mensaje || 'No se pudo confirmar la recuperación. Puede repetir esta misma solicitud.'); }
    finally { setBusy(false); }
  };
  const identity = admin || progress?.administrador;
  const copyAccess = async () => {
    try { await navigator.clipboard.writeText(`Sistema: ${progress?.dominioFrontend || cliente.dominioFrontend}\nUsuario: ${access.email}\nContraseña temporal: ${access.passwordTemporal}`); setMessage('Acceso copiado. Entréguelo al responsable por un canal privado.'); }
    catch { setError('No se pudo copiar. Puede seleccionar los datos visibles.'); }
  };
  return <section className="tenant-access" aria-label="Preparación y acceso del cliente">
    <h3>Preparación y acceso</h3>
    {error && <p role="alert" className="mensaje-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {progress && <>
      {!progress.automatizacionHabilitada && <p className="texto-alerta">La automatización está deshabilitada. La solicitud queda guardada hasta que soporte la habilite.</p>}
      {progress.requiereVerificacion && <p>Este cliente necesita una verificación completa para confirmar su disponibilidad.</p>}
      <ol className="tenant-steps">{STEPS.map(([key, label]) => {
        const step = progress.trabajo?.steps?.[key];
        return <li key={key}><strong>{label}</strong>: {step?.estado === 'done' ? 'Comprobado' : step?.estado === 'running' ? 'En proceso' : 'Pendiente'}</li>;
      })}</ol>
      {progress.trabajo?.mensaje && <p role="status">{progress.trabajo.mensaje}</p>}
      {progress.trabajo?.proximoIntento && progress.trabajo.state === 'waiting' && <p>Próxima comprobación: {new Date(progress.trabajo.proximoIntento).toLocaleString()}.</p>}
      {progress.accesoEstado === 'listo' && <p><strong>Listo para ingresar.</strong> Comprobado: {new Date(progress.ultimaVerificacionAt).toLocaleString()}.</p>}
      <button type="button" className="btn-secundario" disabled={busy} onClick={verify}>Verificar o reanudar preparación</button>
    </>}
    <h4>Administrador del sistema</h4>
    {identity ? <p>{identity.nombre} · <strong>{identity.email}</strong></p> : <p>La identidad se mostrará al preparar o consultar el tenant.</p>}
    <p className="texto-chico">El contacto comercial es independiente del usuario de acceso.</p>
    <button type="button" className="btn-secundario" disabled={busy} onClick={loadAdmin}>Consultar administrador real</button>
    {admin && <p>{admin.ultimoLogin ? `Último ingreso: ${new Date(admin.ultimoLogin).toLocaleString()}.` : 'Sin primer ingreso registrado.'} {admin.debeCambiarPassword ? 'Debe cambiar su clave temporal.' : 'Contraseña personal establecida.'}</p>}
    {canReset && identity?.id && <button type="button" disabled={busy} onClick={reset}>Generar nueva clave temporal</button>}
    {access && <div className="access-delivery">
      <p>Guarde este acceso antes de cerrar. Se muestra una sola vez.</p>
      <p>Usuario: <strong>{access.email}</strong></p>
      <label>Contraseña temporal<input type="text" readOnly value={access.passwordTemporal} autoComplete="off" /></label>
      <button type="button" onClick={copyAccess}>Copiar acceso</button>
      <button type="button" className="btn-secundario" onClick={() => setAccess(null)}>Ocultar y descartar clave</button>
    </div>}
  </section>;
}
