import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import TenantAccessPanel from './TenantAccessPanel';

const vacio = {
  nombreComercial: '', razonSocial: '', contactoNombre: '', contactoEmail: '', contactoTelefono: '',
  tipoDespliegue: 'tenant_corpsimtelec', tipoEmpresa: 'consorcio', ruc: '', slug: '',
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
const nuevaClave = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (n) => n.toString(16).padStart(2, '0')).join('') + 'aA1!';

export default function ClienteFormModal({ cliente, onClose, onGuardado, canReset }) {
  const [form, setForm] = useState(() => (cliente
    ? {
      ...vacio,
      ...cliente,
      trialInicioAt: soloFecha(cliente.trialInicioAt),
      trialExpiraAt: soloFecha(cliente.trialExpiraAt),
      trialSoloLecturaHasta: soloFecha(cliente.trialSoloLecturaHasta),
    }
    : { ...vacio, adminPassword: nuevaClave() }));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [baseDomain, setBaseDomain] = useState('sujam.corpsimtelec.com');
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    api.get('/clientes/configuracion-alta').then(r => setBaseDomain(r.data.data.dominioBase)).catch(() => {});
  }, []);

  const handleChange = (campo) => (e) => setForm((p) => ({ ...p, [campo]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError('');
    try {
      let res;
      if (cliente) {
        const payload = { ...form };
        if (cliente.tipoDespliegue === 'tenant_corpsimtelec') {
          for (const key of ['trialInicioAt', 'trialExpiraAt', 'trialSoloLecturaHasta', 'tipoDespliegue', 'tipoEmpresa', 'slug', 'dominioFrontend', 'dominioBackend', 'vercelProjectId', 'railwayProjectId']) delete payload[key];
        }
        res = await api.put(`/clientes/${cliente.id}`, payload);
      } else {
        if (form.tipoDespliegue === 'tenant_corpsimtelec' && !form.slug) {
          const suggestion = await api.get('/clientes/sugerir-subdominio', { params: { nombre: form.nombreComercial } });
          setForm(p => ({ ...p, slug: suggestion.data.data.slug }));
          setError('Revise el subdominio propuesto y pulse Crear y preparar acceso para confirmar.');
          return;
        }
        res = await api.post('/clientes', form, { headers: { 'Idempotency-Key': requestId.current } });
      }
      onGuardado({ cliente: res.data.data, aviso: res.data.avisoAprov || res.data.avisoBridge,
        acceso: res.data.accesoInicial ? { email: res.data.accesoInicial.email, password: res.data.accesoInicial.passwordTemporal } : null });
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
              <> · <a href={cliente.dominioFrontend.startsWith('http') ? cliente.dominioFrontend : `https://${cliente.dominioFrontend}`} target="_blank" rel="noreferrer">{cliente.dominioFrontend}</a></>
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
            <select value={form.tipoDespliegue} onChange={handleChange('tipoDespliegue')} required disabled={!!cliente}>
              <option value="marca_blanca">Marca blanca</option>
              <option value="tenant_corpsimtelec">Tenant CorpSimtelec</option>
            </select>
          </label>
          <label>Tipo de empresa (plan/módulos) *
            <select value={form.tipoEmpresa || 'consorcio'} onChange={handleChange('tipoEmpresa')} required disabled={!!cliente && form.tipoDespliegue === 'tenant_corpsimtelec'}>
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
                {form.slug && <small>https://{form.slug}.{baseDomain}</small>}
              </label>
            )
          )}
          <label>Estado
            <select value={form.estado} onChange={handleChange('estado')}>
              <option value="trial">Trial</option>
              <option value="activo">Activo</option>
              {cliente && <option value="bloqueado">Bloqueado</option>}
              {cliente && <option value="cancelado">Cancelado</option>}
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
              <label>Admin — nombre *
                <input value={form.adminNombre || ''} onChange={handleChange('adminNombre')} required />
              </label>
              <label>Admin — email (usuario de acceso)
                <input type="email" value={form.adminEmail || ''} onChange={handleChange('adminEmail')} autoComplete="off" required />
              </label>
              <label>Admin — contraseña
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.adminPassword || ''}
                  onChange={handleChange('adminPassword')}
                  autoComplete="new-password"
                  minLength={10}
                  required
                />
                <button type="button" className="btn-link" onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Ocultar' : 'Mostrar'} clave</button>
                <button type="button" className="btn-link" onClick={() => setForm(p => ({ ...p, adminPassword: nuevaClave() }))}>Generar otra clave</button>
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
            </>
          )}
          {form.tipoDespliegue === 'tenant_corpsimtelec' ? <p className="campo-ancho">{cliente ? 'Las fechas se sincronizan con SUJAM.' : 'El trial dura 30 días desde que el acceso esté disponible, más 10 días de consulta. La espera de DNS no consume la prueba.'}</p> : <>
          <label>Trial — inicio
            <input type="date" value={form.trialInicioAt || ''} onChange={handleChange('trialInicioAt')} />
            {!cliente && <small>Vacío: empieza al crear el cliente.</small>}
          </label>
          <label>Trial — expira (30 días)
            <input type="date" value={form.trialExpiraAt || ''} onChange={handleChange('trialExpiraAt')} />
            {!cliente && <small>Vacío: 30 días desde el inicio.</small>}
          </label>
          <label>Trial — solo lectura hasta (+10 días)
            <input type="date" value={form.trialSoloLecturaHasta || ''} onChange={handleChange('trialSoloLecturaHasta')} />
            {!cliente && <small>Vacío: 10 días después de vencer.</small>}
          </label>
          </>}
        </div>
        <label className="campo-ancho">Notas
          <textarea rows={3} value={form.notas || ''} onChange={handleChange('notas')} />
        </label>

        {cliente?.tipoDespliegue === 'tenant_corpsimtelec' && <TenantAccessPanel cliente={cliente} canReset={canReset} />}

        <div className="modal-acciones">
          <button type="button" className="btn-secundario" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={guardando}>{guardando ? 'Guardando...' : cliente ? 'Guardar' : form.tipoDespliegue === 'tenant_corpsimtelec' ? 'Crear y preparar acceso' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}
