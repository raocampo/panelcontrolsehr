// ====================================
// Cliente de la API REST de Vercel — solo lo necesario para aprovisionar el
// frontend de un despliegue marca_blanca de SUJAM.
// ====================================
// Referencia: https://vercel.com/docs/rest-api (verificado 2026-09).
// No ejecutado en vivo desde este código todavía — ver nota en utils/railway.js.
// ====================================

const BASE = 'https://api.vercel.com';

function token() {
    const t = process.env.VERCEL_PERSONAL_ACCESS_TOKEN;
    if (!t) throw new Error('VERCEL_PERSONAL_ACCESS_TOKEN no configurado');
    return t;
}

function teamQuery() {
    return process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '';
}

async function llamar(metodo, path, body) {
    const resp = await fetch(`${BASE}${path}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`Vercel API: ${resp.status} ${JSON.stringify(json)}`);
    return json;
}

/**
 * Crea el proyecto conectado al repo de GitHub, con env vars iniciales.
 * envVars: [{ key, value, target: ['production'] }]
 */
async function crearProyecto({ nombre, repo, rootDirectory, framework, envVars }) {
    const data = await llamar('POST', `/v11/projects${teamQuery()}`, {
        name: nombre,
        framework: framework || 'vite',
        rootDirectory,
        gitRepository: { type: 'github', repo },
        environmentVariables: (envVars || []).map((v) => ({
            key: v.key, value: v.value, target: v.target || ['production'], type: 'encrypted',
        })),
    });
    return data.id;
}

/**
 * Dispara un deploy: crear el proyecto con gitRepository NO despliega solo
 * (solo conecta pushes futuros) — hay que pedirlo explícito, y también sirve
 * para redesplegar un proyecto YA existente a un ref distinto (actualizar un
 * cliente a una versión nueva).
 *
 * El `name` es obligatorio para la API y debe ser el nombre REAL y actual del
 * proyecto en Vercel — no un valor recalculado del lado del cliente (puede
 * no coincidir si Vercel le añadió un sufijo por colisión al crearlo), así
 * que se consulta siempre en vez de asumirlo.
 */
async function crearDeployment({ projectId, repo, ref = 'main' }) {
    const proyecto = await llamar('GET', `/v9/projects/${projectId}${teamQuery()}`);
    const [org, repoName] = repo.split('/');
    const data = await llamar('POST', `/v13/deployments${teamQuery()}`, {
        name: proyecto.name,
        project: projectId,
        target: 'production',
        gitSource: { type: 'github', ref, org, repo: repoName },
    });
    return data.id || data.uid;
}

async function agregarVariable(projectId, { key, value, target }) {
    return llamar('POST', `/v10/projects/${projectId}/env${teamQuery()}`, {
        key, value, type: 'encrypted', target: target || ['production'],
    });
}

/** Desactiva la protección SSO/Deployment Protection en *.vercel.app (decisión ya tomada en el proyecto). */
async function desactivarProteccionSSO(projectId) {
    return llamar('PATCH', `/v9/projects/${projectId}${teamQuery()}`, { ssoProtection: null });
}

async function dominioDefault(projectId) {
    const data = await llamar('GET', `/v9/projects/${projectId}${teamQuery()}`);
    return data.targets?.production?.alias?.[0] || data.alias?.[0]?.domain || `${data.name}.vercel.app`;
}

async function obtenerDeployment(deploymentId) {
    return llamar('GET', `/v13/deployments/${deploymentId}${teamQuery()}`);
}

/** Espera a que un deployment CONCRETO (por id, el que devolvió crearDeployment) quede READY. */
async function esperarDeployment(deploymentId, { timeoutMs = 5 * 60 * 1000, intervaloMs = 5000 } = {}) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        const d = await obtenerDeployment(deploymentId);
        if (d.readyState === 'READY') return d;
        if (['ERROR', 'CANCELED'].includes(d.readyState)) throw new Error(`Deployment ${deploymentId} de Vercel terminó en ${d.readyState}`);
        await new Promise((r) => setTimeout(r, intervaloMs));
    }
    throw new Error(`Timeout esperando el deployment ${deploymentId} de Vercel`);
}

module.exports = { crearProyecto, crearDeployment, agregarVariable, desactivarProteccionSSO, dominioDefault, obtenerDeployment, esperarDeployment };
