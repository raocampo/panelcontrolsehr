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
 * Dispara el primer deploy: crear el proyecto con gitRepository NO despliega
 * solo — solo conecta pushes futuros. Hay que pedir el deploy explícito.
 */
async function crearDeployment({ nombre, projectId, repo, ref = 'main' }) {
    const [org, repoName] = repo.split('/');
    const data = await llamar('POST', `/v13/deployments${teamQuery()}`, {
        name: nombre,
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

async function ultimoDeployment(projectId) {
    const data = await llamar('GET', `/v6/deployments?projectId=${projectId}&limit=1${teamQuery() ? '&' + teamQuery().slice(1) : ''}`);
    return data.deployments?.[0] || null;
}

async function esperarDeployReady(projectId, { timeoutMs = 5 * 60 * 1000, intervaloMs = 5000 } = {}) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        const d = await ultimoDeployment(projectId);
        if (d && d.readyState === 'READY') return d;
        if (d && ['ERROR', 'CANCELED'].includes(d.readyState)) throw new Error(`Deployment de Vercel terminó en ${d.readyState}`);
        await new Promise((r) => setTimeout(r, intervaloMs));
    }
    throw new Error('Timeout esperando el deploy de Vercel');
}

module.exports = { crearProyecto, crearDeployment, agregarVariable, desactivarProteccionSSO, dominioDefault, ultimoDeployment, esperarDeployReady };
