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

async function crearProyecto(nombre) {
    const data = await gql(
        `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
        { input: { name: nombre, isPublic: false } },
    );
    return data.projectCreate.id;
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

async function crearServicioImagen({ projectId, nombre, imagen }) {
    const data = await gql(
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        { input: { projectId, name: nombre, source: { image: imagen } } },
    );
    return data.serviceCreate.id;
}

async function crearServicioRepo({ projectId, nombre, repo, rootDirectory }) {
    const data = await gql(
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        { input: { projectId, name: nombre, source: { repo } } },
    );
    const serviceId = data.serviceCreate.id;
    if (rootDirectory) {
        const environmentId = await obtenerEnvironmentProduccion(projectId);
        await gql(
            `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
                serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
            }`,
            { serviceId, environmentId, input: { rootDirectory } },
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

async function redeploy({ serviceId, environmentId }) {
    await gql(
        `mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
        { serviceId, environmentId },
    );
}

async function ultimoDeployment({ projectId, serviceId }) {
    const data = await gql(
        `query($input: DeploymentListInput!) { deployments(input: $input, first: 1) { edges { node { id status createdAt } } } }`,
        { input: { projectId, serviceId } },
    );
    return data.deployments.edges[0]?.node || null;
}

/** Espera hasta que el último deployment del servicio quede SUCCESS (o falle/timeout). */
async function esperarDeploySuccess({ projectId, serviceId }, { timeoutMs = 5 * 60 * 1000, intervaloMs = 5000 } = {}) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        const d = await ultimoDeployment({ projectId, serviceId });
        if (d && d.status === 'SUCCESS') return d;
        if (d && ['FAILED', 'CRASHED', 'REMOVED'].includes(d.status)) {
            throw new Error(`Deployment terminó en estado ${d.status}`);
        }
        await new Promise((r) => setTimeout(r, intervaloMs));
    }
    throw new Error('Timeout esperando el deploy de Railway');
}

module.exports = {
    IMAGEN_POSTGRES,
    introspeccionSchema,
    crearProyecto,
    obtenerEnvironmentProduccion,
    crearServicioImagen,
    crearServicioRepo,
    crearVolumen,
    setVariables,
    crearDominio,
    redeploy,
    ultimoDeployment,
    esperarDeploySuccess,
};
