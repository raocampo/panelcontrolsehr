const dns = require('node:dns').promises;
const { llamar } = require('./vercel');
const { validarSlug } = require('./tenantSlug');
const { fault } = require('./durableJobs');

function hostname(slug) {
    validarSlug(slug);
    const base = process.env.SUJAM_TENANT_BASE_DOMAIN || 'sujam.corpsimtelec.com';
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(base)) throw fault('Configure un dominio base válido', 'REQUIERE_CONFIGURACION');
    return `${slug}.${base.toLowerCase()}`;
}
function scope(extra = {}) {
    return '?' + new URLSearchParams({ ...extra, ...(process.env.VERCEL_TEAM_ID ? { teamId: process.env.VERCEL_TEAM_ID } : {}) });
}
async function api(method, path, body) {
    try { return await llamar(method, path, body); }
    catch (error) {
        if ([401, 403].includes(error.status)) throw fault('Vercel no autoriza el equipo/proyecto configurado. Revise sus credenciales y permisos.', 'REQUIERE_CONFIGURACION');
        if (error.status === 429 || error.status >= 500 || !error.status) {
            const delay = /^\d+$/.test(error.retryAfter || '') ? Number(error.retryAfter) * 1000 : Date.parse(error.retryAfter) - Date.now();
            throw fault('Vercel está temporalmente ocupado. Se reintentará automáticamente.', 'PROVEEDOR_TEMPORAL', Math.min(900000, Math.max(30000, delay || 0)));
        }
        throw error;
    }
}
function projectId() {
    const id = process.env.SUJAM_VERCEL_PROJECT_ID;
    if (!id || !process.env.VERCEL_PERSONAL_ACCESS_TOKEN) throw fault('Configure el token Vercel y el proyecto frontend compartido para habilitar dominios.', 'REQUIERE_CONFIGURACION');
    return id;
}
async function ensureDomain(host) {
    const id = projectId();
    const project = await api('GET', `/v9/projects/${encodeURIComponent(id)}${scope()}`);
    if (process.env.VERCEL_TEAM_ID && project.accountId !== process.env.VERCEL_TEAM_ID) throw fault('El proyecto Vercel no pertenece al equipo configurado.', 'REQUIERE_CONFIGURACION');
    const route = `/v9/projects/${encodeURIComponent(id)}/domains/${encodeURIComponent(host)}${scope()}`;
    let domain;
    try { domain = await api('GET', route); }
    catch (error) { if (error.status !== 404) throw error; }
    if (!domain) {
        try { domain = await api('POST', `/v10/projects/${encodeURIComponent(id)}/domains${scope()}`, { name: host }); }
        catch (error) {
            if ([400, 409].includes(error.status)) {
                try { domain = await api('GET', route); } catch { /* conflict in another project */ }
                if (!domain) throw fault('El dominio está ocupado o requiere revisión en Vercel. No se transferirá automáticamente.', 'DOMINIO_CONFLICTO');
            } else throw error;
        }
    }
    if (domain.redirect || domain.gitBranch || domain.customEnvironmentId) throw fault('El dominio tiene una redirección o apunta a un entorno distinto de producción.', 'DOMINIO_CONFLICTO');
    if (domain.verified === false) throw fault('Vercel requiere verificar la propiedad del dominio antes de continuar.', 'DOMINIO_VERIFICACION');
    const config = await api('GET', `/v6/domains/${encodeURIComponent(host)}/config${scope({ projectId: id })}`);
    return { projectId: project.id, config, cname: config.recommendedCNAME?.[0]?.value || process.env.SUJAM_TENANT_CNAME || 'cname.vercel-dns.com' };
}
async function verifyDns(host, domain) {
    let cnames = [];
    try { cnames = await dns.resolveCname(host); } catch (error) {
        if (!['ENODATA', 'ENOTFOUND', 'ENODOMAIN', 'ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error.code)) throw error;
    }
    const normalize = value => value.toLowerCase().replace(/\.$/, '');
    const match = cnames.some(c => normalize(c) === normalize(domain.cname));
    let addresses = (await Promise.all([dns.resolve4(host).catch(() => []), dns.resolve6(host).catch(() => [])])).flat();
    // Some hosts cannot use c-ares/UDP directly but their system resolver works.
    // Still require positive resolution, Vercel routing and the HTTPS checks.
    if (!addresses.length) addresses = await dns.lookup(host, { all: true }).then(rows => rows.map(r => r.address)).catch(() => []);
    // Vercel validates routing as well as the records; accept a supported A/ALIAS
    // configuration only when its API confirms the domain is correctly configured.
    if (!addresses.length || (!match && domain.config.misconfigured !== false) || domain.config.misconfigured === true) {
        throw fault(`DNS pendiente. Configure CNAME ${host} → ${domain.cname}. Se comprobará de nuevo automáticamente.`, 'ESPERANDO_DNS', 60000);
    }
    return { tipo: cnames.length ? 'CNAME' : 'A/ALIAS', destino: cnames[0] || 'Confirmado por Vercel' };
}
async function publicCheck(host, slug) {
    const origin = `https://${host}`;
    let page;
    try { page = await fetch(`${origin}/login`, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch { throw fault('Esperando un certificado HTTPS válido para este dominio.', 'ESPERANDO_SSL', 60000); }
    if (page.status !== 200 || !(page.headers.get('content-type') || '').includes('text/html')) throw fault('La página de ingreso aún no está disponible en este dominio.', 'APLICACION_PENDIENTE', 60000);
    const html = await page.text();
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m => m[1]);
    if (!scripts.length) throw fault('La página no contiene los recursos iniciales de la aplicación.', 'APLICACION_PENDIENTE', 60000);
    for (const script of scripts.slice(0, 5)) {
        const url = new URL(script, origin);
        if (url.origin !== origin) throw fault('La aplicación carga recursos desde un origen inesperado.', 'APLICACION_CONFLICTO');
        const resource = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        if (!resource.ok || !(resource.headers.get('content-type') || '').match(/javascript/)) throw fault('Los recursos de la aplicación aún no están disponibles.', 'APLICACION_PENDIENTE', 60000);
        await resource.body?.cancel();
    }
    const manifestResponse = await fetch(`${origin}/.well-known/sujam.json`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const manifest = await manifestResponse.json().catch(() => ({}));
    const expectedApi = (process.env.SUJAM_PUBLIC_TENANT_API_URL || process.env.SUJAM_SUPERADMIN_URL || '').replace(/\/$/, '');
    if (!manifestResponse.ok || manifest.schema !== 1 || manifest.tenantApiUrl?.replace(/\/$/, '') !== expectedApi
        || manifest.tenantBaseDomain !== host.slice(slug.length + 1)) throw fault('El frontend publicado no tiene la configuración multiempresa esperada. Actualice el despliegue o sus variables.', 'FRONTEND_CONFIGURACION');
    // The application calls Railway directly with X-Tenant-Slug; Vercel does
    // not proxy /api. Only call the configured trusted API, never a manifest URL.
    const response = await fetch(`${expectedApi}/api/branding`, { headers: { 'x-tenant-slug': slug }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const branding = await response.json().catch(() => ({}));
    if (!response.ok || branding.data?.modo !== 'multi' || branding.data?.slug !== slug) throw fault('La dirección no resuelve al tenant esperado. Revise la conexión del frontend con el backend multiempresa.', 'TENANT_INCORRECTO');
    return { hostname: host, https: true, aplicacion: true, slug, comprobadoAt: new Date().toISOString() };
}
async function requestCertificate(host) {
    try { return await api('POST', `/v8/certs${scope()}`, { cns: [host] }); }
    catch (error) {
        if (error.providerCode === 'validation_running') return { pending: true };
        if (error.status === 400) throw fault('El certificado requiere revisar la configuración del dominio en Vercel.', 'CERTIFICADO_CONFIGURACION');
        throw error;
    }
}
module.exports = { hostname, ensureDomain, verifyDns, publicCheck, requestCertificate };
