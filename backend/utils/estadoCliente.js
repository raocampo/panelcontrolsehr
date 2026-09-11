// ====================================
// Propaga un cambio de estado del cliente a su despliegue real, según el tipo:
//   - tenant_corpsimtelec : PATCH /api/superadmin/tenants/:slug/estado en SUJAM
//   - marca_blanca        : PUT /api/admin/licencia en la instancia del cliente
// Nunca lanza: el estado en el panel es la fuente de verdad.
// ====================================

const { notificarLicencia } = require('./licenciaBridge');
const sujamTenants = require('./sujamTenants');

// panel estado -> estado que entiende SUJAM superadmin
function mapEstadoTenant(estado) {
    if (estado === 'bloqueado' || estado === 'cancelado') return 'bloqueado';
    if (estado === 'trial' || estado === 'activo') return 'activo';
    return 'activo';
}

async function notificarEstado(cliente) {
    if (cliente.tipoDespliegue === 'tenant_corpsimtelec') {
        if (!cliente.slug) return { ok: true, omitido: true, motivo: 'sin slug (aún no aprovisionado)' };
        const r = await sujamTenants.setEstadoTenant(cliente.slug, mapEstadoTenant(cliente.estado));
        return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    // marca_blanca
    return notificarLicencia(cliente);
}

module.exports = { notificarEstado, mapEstadoTenant };
