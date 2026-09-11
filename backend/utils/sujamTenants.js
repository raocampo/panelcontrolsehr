// ====================================
// Cliente HTTP hacia la API superadmin de SUJAM (despliegue compartido multi-tenant).
// ====================================
// Para clientes tipoDespliegue = 'tenant_corpsimtelec'. El panel NO toca la BD
// de SUJAM: le pide a SUJAM que cree/actualice/bloquee el tenant.
//
//   SUJAM_SUPERADMIN_URL     ej. https://api.sujam.corpsimtelec.com
//   SUJAM_SUPERADMIN_SECRET  == CONTROL_PLANE_SECRET del backend de SUJAM
//   SUJAM_TENANT_BASE_DOMAIN ej. sujam.corpsimtelec.com
// ====================================

const BASE = () => (process.env.SUJAM_SUPERADMIN_URL || '').replace(/\/$/, '');
const SECRET = () => process.env.SUJAM_SUPERADMIN_SECRET || '';
const TENANT_DOMAIN = () => process.env.SUJAM_TENANT_BASE_DOMAIN || 'sujam.corpsimtelec.com';

function configurado() {
    return !!BASE() && !!SECRET();
}

async function llamar(metodo, path, body) {
    if (!configurado()) {
        return { ok: false, error: 'SUJAM_SUPERADMIN_URL/SECRET no configurados en el panel' };
    }
    try {
        const resp = await fetch(`${BASE()}/api/superadmin${path}`, {
            method: metodo,
            headers: { 'Content-Type': 'application/json', 'x-control-plane-secret': SECRET() },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return { ok: false, status: resp.status, error: data.mensaje || `HTTP ${resp.status}`, data };
        return { ok: true, status: resp.status, data: data.data ?? data };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

/** Dispara el aprovisionamiento del tenant en SUJAM (respuesta 202, luego hay que hacer polling). */
function crearTenant(payload) {
    return llamar('POST', '/tenants', payload);
}

function obtenerTenant(slug) {
    return llamar('GET', `/tenants/${encodeURIComponent(slug)}`);
}

function setEstadoTenant(slug, estado) {
    return llamar('PATCH', `/tenants/${encodeURIComponent(slug)}/estado`, { estado });
}

function actualizarTenant(slug, campos) {
    return llamar('PATCH', `/tenants/${encodeURIComponent(slug)}`, campos);
}

function dominioFrontend(slug) {
    return `https://${slug}.${TENANT_DOMAIN()}`;
}

module.exports = { configurado, crearTenant, obtenerTenant, setEstadoTenant, actualizarTenant, dominioFrontend };
