// ====================================
// Cliente de la API pública de Railway (GraphQL) — solo lo necesario para
// aprovisionar un despliegue marca_blanca de SUJAM (Postgres + backend).
// ====================================
// Referencia: https://docs.railway.com/integrations/api
// Endpoint verificado 2026-09 (antes backboard.railway.app, ahora .com).
//
// NOTA: escrito contra la documentación pública de Railway + los hallazgos
// reales documentados en sistemaSUJAM/docs/qa/cierre_jornada_2026-08-07.md
// (esa sesión aprovisionó a mano el propio panel-control-sujam con esta
// misma API). No se ha ejecutado en vivo desde este código — antes de la
// primera corrida real, validar con `introspeccionSchema()` (query de solo
// lectura, sin costo) que los nombres de campo siguen vigentes.
// ====================================

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const IMAGEN_POSTGRES = process.env.RAILWAY_POSTGRES_IMAGE || 'ghcr.io/railwayapp-templates/postgres-ssl:18';

function token() {
    const t = process.env.RAILWAY_API_TOKEN;
    if (!t) throw new Error('RAILWAY_API_TOKEN no configurado');
    return t;
}

async function gql(query, variables) {
    const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30000),
    });
    const json = await resp.json();
    if (!resp.ok || json.errors) {
        throw new Error(`Railway API: ${resp.status} ${JSON.stringify(json.errors || json)}`);
    }
    return json.data;
}

/** Query de solo lectura para validar el schema antes de usarlo en vivo. */
async function introspeccionSchema() {
    return gql(`query { __schema { mutationType { fields { name } } } }`, {});
}

async function crearProyecto(nombre, workspaceId) {
    const input = { name: nombre, isPublic: false };
    if (workspaceId || process.env.RAILWAY_WORKSPACE_ID) {
        input.workspaceId = workspaceId || process.env.RAILWAY_WORKSPACE_ID;
    }
    const data = await gql(
        `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
        { input },
    );
    return data.projectCreate.id;
}

/** Identidad de la cuenta dueña del token + sus workspaces (para ubicar el workspaceId correcto). */
async function cuentaInfo() {
    return gql(`{ me { id email workspaces { id name } } }`, {});
}

async function obtenerEnvironmentProduccion(projectId) {
    const data = await gql(
        `query($id: String!) { project(id: $id) { environments { edges { node { id name } } } } }`,
        { id: projectId },
    );
    const edges = data.project.environments.edges;
    const prod = edges.find((e) => /production/i.test(e.node.name)) || edges[0];
    if (!prod) throw new Error(`Proyecto ${projectId} sin environments`);
    return prod.node.id;
}

/** Busca el id de un servicio del proyecto por nombre (ej. "backend"). */
async function buscarServicioPorNombre(projectId, nombre) {
    const data = await gql(
        `query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }`,
        { id: projectId },
    );
    const match = data.project.services.edges.find((e) => e.node.name === nombre);
    if (!match) throw new Error(`No se encontró el servicio "${nombre}" en el proyecto ${projectId}`);
    return match.node.id;
}

async function crearServicioImagen({ projectId, nombre, imagen }) {
    const data = await gql(
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        { input: { projectId, name: nombre, source: { image: imagen } } },
    );
    return data.serviceCreate.id;
}

async function crearServicioRepo({ projectId, nombre, repo, rootDirectory, preDeployCommand, branch }) {
    const input = { projectId, name: nombre, source: { repo } };
    // Fija la rama/tag que este servicio sigue. Si no se pasa, Railway usa la
    // rama default del repo (main) — para clientes marca_blanca conviene
    // fijar un release concreto (ver "actualizar versión de un cliente" más
    // abajo) en vez de seguir main en vivo.
    if (branch) input.branch = branch;
    const data = await gql(
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        { input },
    );
    const serviceId = data.serviceCreate.id;
    const instanceInput = {};
    if (rootDirectory) instanceInput.rootDirectory = rootDirectory;
    // Ojo: si el railway.json del repo define un campo, la API NO puede
    // sobreescribirlo (ver docs/.../ARQUITECTURA_MULTITENANT_MARCA_BLANCA.md).
    // preDeployCommand no está definido en backend/railway.json de SEHR, así
    // que sí se puede fijar por servicio sin tocar el repo.
    if (preDeployCommand) instanceInput.preDeployCommand = preDeployCommand;
    if (Object.keys(instanceInput).length) {
        const environmentId = await obtenerEnvironmentProduccion(projectId);
        await gql(
            `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
                serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
            }`,
            { serviceId, environmentId, input: instanceInput },
        );
    }
    return serviceId;
}

async function crearVolumen({ projectId, serviceId, mountPath }) {
    const data = await gql(
        `mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`,
        { input: { projectId, serviceId, mountPath } },
    );
    return data.volumeCreate.id;
}

async function setVariables({ projectId, environmentId, serviceId, variables }) {
    await gql(
        `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
        { input: { projectId, environmentId, serviceId, variables, replace: false } },
    );
}

async function crearDominio({ serviceId, environmentId, targetPort }) {
    const data = await gql(
        `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
        { input: { serviceId, environmentId, targetPort: targetPort || undefined } },
    );
    return data.serviceDomainCreate.domain;
}

/**
 * Dispara un deploy de una revisión EXACTA (rama, tag o SHA — Railway
 * resuelve el ref del lado del build) y devuelve el id del deployment
 * creado. A diferencia de `serviceInstanceDeploy` (booleano, "redeploy lo
 * que ya esté configurado"), esto es lo que permite:
 *   a) fijar/actualizar la versión de un cliente concreto sin tocar a los
 *      demás (pasar el tag/rama de ese cliente), y
 *   b) esperar el resultado del deployment exacto que se disparó, sin la
 *      ambigüedad de "cuál es el último" cuando hay más de un trigger casi
 *      simultáneo (variables + este llamado, por ejemplo).
 * Confirmado en vivo: commitSha acepta un nombre de rama (ej. "main") y
 * Railway lo resuelve al commit real (verificado con `deployment(id).meta`).
 */
async function desplegarVersion({ serviceId, environmentId, ref }) {
    const data = await gql(
        `mutation($serviceId: String!, $environmentId: String!, $commitSha: String) {
            serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
        }`,
        { serviceId, environmentId, commitSha: ref || undefined },
    );
    return data.serviceInstanceDeployV2; // deployment id
}

async function obtenerDeployment(deploymentId) {
    const data = await gql(
        `query($id: String!) { deployment(id: $id) { id status meta } }`,
        { id: deploymentId },
    );
    return data.deployment;
}

/** Espera a que un deployment CONCRETO (por id) termine en SUCCESS, o falle/timeout. */
async function esperarDeployment(deploymentId, { timeoutMs = 5 * 60 * 1000, intervaloMs = 4000 } = {}) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        const d = await obtenerDeployment(deploymentId);
        if (d.status === 'SUCCESS') return d;
        if (['FAILED', 'CRASHED', 'REMOVED'].includes(d.status)) {
            throw new Error(`Deployment ${deploymentId} terminó en estado ${d.status}`);
        }
        await new Promise((r) => setTimeout(r, intervaloMs));
    }
    throw new Error(`Timeout esperando el deployment ${deploymentId}`);
}

module.exports = {
    IMAGEN_POSTGRES,
    introspeccionSchema,
    cuentaInfo,
    crearProyecto,
    obtenerEnvironmentProduccion,
    buscarServicioPorNombre,
    crearServicioImagen,
    crearServicioRepo,
    crearVolumen,
    setVariables,
    crearDominio,
    desplegarVersion,
    obtenerDeployment,
    esperarDeployment,
};
