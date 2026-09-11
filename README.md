# Panel de Control — CorpSimtelec

Control plane mínimo ("super-admin") para gestionar los clientes/despliegues
de SUJAM (Fase 2 del plan de marca blanca — ver
`sistemaSUJAM/docs/qa/cierre_jornada_2026-08-05.md`, Rondas 5-6, y
`sistemaSUJAM/docs/qa/cierre_jornada_2026-08-06.md`).

Cada cliente de SUJAM tiene su propio despliegue aislado (BD + backend +
frontend en Railway/Vercel). Esta app **no** contiene datos clínicos ni se
conecta a la BD de ningún cliente — es solo un registro administrativo
(quién es el cliente, su tipo de despliegue, su estado de trial/pago) para
el equipo interno de CorpSimtelec.

## Estado (desplegado 2026-08-07)

| Recurso | Valor |
|---|---|
| Repo GitHub | `raocampo/panelcontrolsehr` (privado) |
| Backend (Railway) | proyecto `panel-control-sujam` — `https://backend-production-ab8a.up.railway.app` |
| BD (Railway) | Postgres propia del proyecto, volumen persistente en `/var/lib/postgresql/data` |
| Frontend (Vercel) | proyecto `panel-control-sujam-frontend` — `https://panel-control-sujam-frontend-raocampos-projects.vercel.app` |
| Login inicial | `admin@corpsimtelec.com` (contraseña entregada una sola vez al desplegar — cambiarla desde el panel si existe esa opción, o regenerar el staff) |

Sin dominio propio todavía (pendiente: `panel.corpsimtelec.com` o similar — requiere
agregar el registro DNS en `corpsimtelec.com` y configurarlo en ambas plataformas, mismo
proceso que `sujam.corpsimtelec.com`). Protección SSO de Vercel **desactivada**
deliberadamente en el dominio `*.vercel.app` para que el staff entre con su login del
panel sin necesitar cuenta de Vercel — reevaluar si conviene reactivarla al conectar
dominio propio.

`backend/railway.json`: `preDeployCommand` corre `npx prisma migrate deploy` en cada
deploy (patrón permanente, corre en runtime — **no** en el build, Railway no inyecta
variables de otros servicios durante el build).

## Alcance actual

- CRUD de `clientes` con estado (`trial` / `activo` / `bloqueado` /
  `cancelado`) y fechas de trial (informativas — el bloqueo real ocurre
  dentro del backend/tenant de cada cliente, no aquí).
- Acción "Dar de alta" — único paso manual: cuando el cliente paga, pasa a
  `activo`.
- Tabla `solicitudes`, lista para que un formulario público la alimente.
- **Aprovisionamiento automático de tenants** (2026-09-10, arquitectura
  multi-tenant de SUJAM — ver `sistemaSUJAM/docs/Documentación/05-propuestas-tecnicas/
  ARQUITECTURA_MULTITENANT_MARCA_BLANCA.md`, FASE 6): al crear un cliente
  `tipoDespliegue = tenant_corpsimtelec`, el panel genera un `slug` y llama a
  `POST /api/superadmin/tenants` en el backend multi-tenant de SUJAM, que crea
  la BD del tenant, aplica el schema y lo siembra según `tipoEmpresa`
  (medico/consorcio/hospital_clinica → plan V1/V2/V3). El campo
  `aprovisionamiento` (`pendiente|aprovisionando|listo|error`) se sincroniza
  vía `GET /:id/aprovisionamiento` (también corrido por el reaper cada hora).
  `POST /:id/aprovisionar` reintenta si falló. Cambios de `estado` (bloquear/
  activar) se propagan con `PATCH /api/superadmin/tenants/:slug/estado`.
  Probado extremo a extremo en local: alta → aprovisionamiento real (BD +
  seed) → bloqueo → reactivación → bloqueo enforced (403) en el tenant.
- `tipoDespliegue = marca_blanca` sigue con el puente 1:1 existente
  (`PUT /api/admin/licencia` en la instancia dedicada del cliente,
  `utils/licenciaBridge.js`) — sin cambios en esta fase.

- **Aprovisionamiento automático de `marca_blanca`** (2026-09-10, FASE 6 slice 2):
  `POST /api/clientes/:id/aprovisionar` con `{ "confirmar": true }` crea un
  proyecto Railway real (Postgres + backend SUJAM desde `raocampo/SEHR`,
  `MODO_DESPLIEGUE=single`) y un proyecto Vercel real (frontend), y siembra la
  instancia vía `POST /api/admin/bootstrap` (nuevo en SUJAM). Requiere
  `RAILWAY_API_TOKEN` y `VERCEL_PERSONAL_ACCESS_TOKEN` configurados — sin
  confirmación explícita o sin esos tokens, responde 400 y no crea nada.
  **Código escrito y verificado contra la documentación pública de Railway/
  Vercel; sin ejecutar aún en vivo** (crea recursos reales y facturables —
  la primera corrida debe hacerse con el usuario presente).

## Stack

Mismo patrón que `sistemaSUJAM`: Express + Prisma + PostgreSQL (backend),
React + Vite (frontend). BD propia, separada de la de cualquier cliente.

## Desarrollo local

```bash
# Backend
cd backend
npm install
npx prisma migrate dev
npm run crear-staff-inicial -- --nombre="Tu Nombre" --email=tu@email.com --password=Clave1234
npm run dev   # http://localhost:5620

# Frontend
cd frontend
npm install
npm run dev   # http://localhost:5621
```

No hay registro público — el primer usuario del panel se crea con el
script `crear-staff-inicial.js`.

Para que el alta de clientes `tenant_corpsimtelec` aprovisione de verdad,
configurar en `.env` (ver `.env.example`): `SUJAM_SUPERADMIN_URL`,
`SUJAM_SUPERADMIN_SECRET` (= `CONTROL_PLANE_SECRET` del backend multi-tenant
de SUJAM) y `SUJAM_TENANT_BASE_DOMAIN`. Sin esas variables, `POST /api/clientes`
sigue creando el registro pero devuelve `avisoAprov` en vez de aprovisionar.

## Pendiente

- Conectar dominio propio (`panel.corpsimtelec.com` o similar) en Railway y Vercel.
- Reconectar el botón "Solicitar acceso" de `sistemaSUJAM` a
  `https://panel-control-sujam-frontend-raocampos-projects.vercel.app/solicitar-acceso`
  (o al dominio propio una vez exista).
- Revisar el advisory de seguridad de `react-router-dom` antes de difundir
  `/solicitar-acceso` más ampliamente (ver `sistemaSUJAM/docs/qa/cierre_jornada_2026-08-06.md`).
- Configurar `SUJAM_SUPERADMIN_URL`/`SUJAM_SUPERADMIN_SECRET` en el Railway de
  este panel apuntando al backend multi-tenant real de SUJAM (hoy solo probado
  en local).
- Frontend del panel: UI para elegir `tipoEmpresa` al crear un cliente, mostrar
  `aprovisionamiento` y el dominio, botones "Reintentar aprovisionar"
  (con el aviso de costo para `marca_blanca`).
- **Primera corrida real de aprovisionamiento `marca_blanca`**: configurar
  `RAILWAY_API_TOKEN`/`VERCEL_PERSONAL_ACCESS_TOKEN` y probar contra un cliente
  de prueba real, con el usuario presente (crea infraestructura facturable).
- Cargar los clientes reales existentes de SUJAM en la tabla `clientes` de este panel.
