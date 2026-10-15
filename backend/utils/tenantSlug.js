const RESERVED = new Set(['www', 'api', 'app', 'admin', 'panel', 'static', 'assets', 'cdn', 'sujam', 'control', 'superadmin', 'tenants', 'mail', 'smtp', 'ftp']);
function validarSlug(slug) {
    if (typeof slug !== 'string' || !/^[a-z][a-z0-9-]{0,39}[a-z0-9]$/.test(slug)) {
        throw new Error('Subdominio inválido: use 2 a 41 caracteres, empiece con letra y termine con letra o número.');
    }
    if (RESERVED.has(slug)) throw new Error('Ese subdominio está reservado.');
    return slug;
}
function sugerirSlug(value) {
    let slug = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!/^[a-z]/.test(slug)) slug = `cli-${slug}`;
    slug = slug.slice(0, 41).replace(/-+$/g, '');
    if (slug.length < 2 || RESERVED.has(slug)) slug = `cli-${slug}`.slice(0, 41);
    return validarSlug(slug);
}
module.exports = { validarSlug, sugerirSlug, RESERVED };
