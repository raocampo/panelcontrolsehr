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

- Desplegar a Railway (backend) + Vercel (frontend) — a confirmar con el
  usuario antes de crear infraestructura nueva.
- Fase 3 y Fase 4 (ver arriba).
