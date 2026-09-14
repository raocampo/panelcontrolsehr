import { useState } from 'react';
import api from '../services/api';

const vacio = {
  nombreComercial: '', razonSocial: '', contactoNombre: '', contactoEmail: '', contactoTelefono: '',
  tipoDespliegue: 'marca_blanca', tipoEmpresa: 'consorcio', ruc: '', slug: '',
  dominioFrontend: '', dominioBackend: '',
  railwayProjectId: '', vercelProjectId: '', estado: 'trial',
  trialInicioAt: '', trialExpiraAt: '', trialSoloLecturaHasta: '', notas: '',
};

const TIPO_EMPRESA_LABELS = {
  medico: 'Médico (V1)',
  consorcio: 'Consorcio (V2)',
  hospital_clinica: 'Hospital / Clínica (V3)',
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
        {cliente && (
          <div className="info-aprovisionamiento">
            Aprovisionamiento: <span className={`badge badge-${cliente.aprovisionamiento}`}>{cliente.aprovisionamiento}</span>
            {cliente.tipoDespliegue === 'marca_blanca' && <> · versión fijada: <strong>{cliente.versionRef}</strong></>}
            {cliente.dominioFrontend && (
              <> · <a href={`https://${cliente.dominioFrontend}`} target="_blank" rel="noreferrer">{cliente.dominioFrontend}</a></>
            )}
          </div>
        )}

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
          <label>Tipo de empresa (plan/módulos) *
            <select value={form.tipoEmpresa || 'consorcio'} onChange={handleChange('tipoEmpresa')} required>
              {Object.entries(TIPO_EMPRESA_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
          <label>RUC
            <input value={form.ruc || ''} onChange={handleChange('ruc')} maxLength={13} />
          </label>
          {form.tipoDespliegue === 'tenant_corpsimtelec' && (
            cliente ? (
              <label>Slug (subdominio)
                <input value={form.slug || '—'} readOnly title="El slug se fija al aprovisionar y no se puede editar desde acá" />
              </label>
            ) : (
              <label>Slug (subdominio)
                <input value={form.slug || ''} onChange={handleChange('slug')} placeholder="vacío = se genera del nombre comercial" />
              </label>
            )
          )}
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
          {!cliente && form.tipoDespliegue === 'tenant_corpsimtelec' && (
            <>
              <div className="campo-ancho form-section-title">
                Usuario administrador — con esto entra al sistema del cliente
              </div>
              <label>Admin — nombre
                <input value={form.adminNombre || ''} onChange={handleChange('adminNombre')} placeholder="vacío = usa el de Contacto" />
              </label>
              <label>Admin — email (usuario de acceso)
                <input type="email" value={form.adminEmail || ''} onChange={handleChange('adminEmail')} placeholder="vacío = usa el de Contacto" />
              </label>
              <label>Admin — contraseña
                <input
                  type="text"
                  value={form.adminPassword || ''}
                  onChange={handleChange('adminPassword')}
                  placeholder="vacío = clave por defecto (Sujam.2026!)"
                />
              </label>
            </>
          )}
          {form.tipoDespliegue === 'marca_blanca' && (
            <>
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
            </>
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
