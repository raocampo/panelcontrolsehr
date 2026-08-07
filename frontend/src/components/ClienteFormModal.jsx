import { useState } from 'react';
import api from '../services/api';

const vacio = {
  nombreComercial: '', razonSocial: '', contactoNombre: '', contactoEmail: '', contactoTelefono: '',
  tipoDespliegue: 'marca_blanca', dominioFrontend: '', dominioBackend: '',
  railwayProjectId: '', vercelProjectId: '', estado: 'trial',
  trialInicioAt: '', trialExpiraAt: '', trialSoloLecturaHasta: '', notas: '',
};

const soloFecha = (valor) => (valor ? String(valor).slice(0, 10) : '');

export default function ClienteFormModal({ cliente, onClose, onGuardado }) {
  const [form, setForm] = useState(() => (cliente
    ? {
      ...vacio,
      ...cliente,
      trialInicioAt: soloFecha(cliente.trialInicioAt),
      trialExpiraAt: soloFecha(cliente.trialExpiraAt),
      trialSoloLecturaHasta: soloFecha(cliente.trialSoloLecturaHasta),
    }
    : vacio));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (campo) => (e) => setForm((p) => ({ ...p, [campo]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError('');
    try {
      let res;
      if (cliente) {
        res = await api.put(`/clientes/${cliente.id}`, form);
      } else {
        res = await api.post('/clientes', form);
      }
      if (res.data.avisoBridge) window.alert(res.data.avisoBridge);
      onGuardado();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-caja" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{cliente ? 'Editar cliente' : 'Nuevo cliente'}</h2>
        {error && <div className="mensaje-error">{error}</div>}

        <div className="form-grid">
          <label>Nombre comercial *
            <input value={form.nombreComercial} onChange={handleChange('nombreComercial')} required />
          </label>
          <label>Razón social
            <input value={form.razonSocial || ''} onChange={handleChange('razonSocial')} />
          </label>
          <label>Tipo de despliegue *
            <select value={form.tipoDespliegue} onChange={handleChange('tipoDespliegue')} required>
              <option value="marca_blanca">Marca blanca</option>
              <option value="tenant_corpsimtelec">Tenant CorpSimtelec</option>
            </select>
          </label>
          <label>Estado
            <select value={form.estado} onChange={handleChange('estado')}>
              <option value="trial">Trial</option>
              <option value="activo">Activo</option>
              <option value="bloqueado">Bloqueado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>
          <label>Contacto — nombre
            <input value={form.contactoNombre || ''} onChange={handleChange('contactoNombre')} />
          </label>
          <label>Contacto — email
            <input type="email" value={form.contactoEmail || ''} onChange={handleChange('contactoEmail')} />
          </label>
          <label>Contacto — teléfono
            <input value={form.contactoTelefono || ''} onChange={handleChange('contactoTelefono')} />
          </label>
          <label>Dominio frontend
            <input value={form.dominioFrontend || ''} onChange={handleChange('dominioFrontend')} placeholder="cliente.corpsimtelec.com" />
          </label>
          <label>Dominio backend
            <input value={form.dominioBackend || ''} onChange={handleChange('dominioBackend')} placeholder="api.cliente.corpsimtelec.com" />
          </label>
          <label>Railway project ID
            <input value={form.railwayProjectId || ''} onChange={handleChange('railwayProjectId')} />
          </label>
          <label>Vercel project ID
            <input value={form.vercelProjectId || ''} onChange={handleChange('vercelProjectId')} />
          </label>
          {cliente && (
            <label>Secreto control plane (CONTROL_PLANE_SECRET en Railway)
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={form.secretoControlPlane || ''} readOnly onClick={(e) => e.target.select()} />
                <button
                  type="button"
                  className="btn-secundario"
                  onClick={() => navigator.clipboard.writeText(form.secretoControlPlane || '')}
                >
                  Copiar
                </button>
              </div>
            </label>
          )}
          <label>Trial — inicio
            <input type="date" value={form.trialInicioAt || ''} onChange={handleChange('trialInicioAt')} />
          </label>
          <label>Trial — expira (30 días)
            <input type="date" value={form.trialExpiraAt || ''} onChange={handleChange('trialExpiraAt')} />
          </label>
          <label>Trial — solo lectura hasta (+10 días)
            <input type="date" value={form.trialSoloLecturaHasta || ''} onChange={handleChange('trialSoloLecturaHasta')} />
          </label>
        </div>
        <label className="campo-ancho">Notas
          <textarea rows={3} value={form.notas || ''} onChange={handleChange('notas')} />
        </label>

        <div className="modal-acciones">
          <button type="button" className="btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}
