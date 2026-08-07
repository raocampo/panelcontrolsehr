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

## Alcance actual (Fase 2 — mínimo)

- CRUD de `clientes` con estado (`trial` / `activo` / `bloqueado` /
  `cancelado`) y fechas de trial (informativas — el bloqueo real ocurre
  dentro del backend de cada cliente, no aquí).
- Acción "Dar de alta" — único paso manual: cuando el cliente paga, pasa a
  `activo`.
- Tabla `solicitudes`, lista para que la Fase 3 (formulario público) la
  alimente más adelante — hoy el staff la puede usar manualmente.

**Fuera de alcance a propósito** (decidido en la Ronda 6 de SUJAM):
formulario público de solicitud (Fase 3) y aprovisionamiento automático de
Railway/Vercel (Fase 4) — quedan para una sesión dedicada aparte.

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

## Pendiente

- Conectar dominio propio (`panel.corpsimtelec.com` o similar) en Railway y Vercel.
- Reconectar el botón "Solicitar acceso" de `sistemaSUJAM` a
  `https://panel-control-sujam-frontend-raocampos-projects.vercel.app/solicitar-acceso`
  (o al dominio propio una vez exista).
- Revisar el advisory de seguridad de `react-router-dom` antes de difundir
  `/solicitar-acceso` más ampliamente (ver `sistemaSUJAM/docs/qa/cierre_jornada_2026-08-06.md`).
- Fase 4 (aprovisionamiento automático Railway/Vercel) — sesión dedicada aparte.
- Cargar los clientes reales existentes de SUJAM en la tabla `clientes` de este panel.
