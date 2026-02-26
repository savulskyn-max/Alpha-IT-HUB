# Alpha IT Hub — Architecture

**Version:** 1.0 · **Fecha:** Febrero 2026
**Branch activo:** `claude/setup-new-project-6JCgS`

---

## Stack Tecnológico

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Mobile/Desktop | React Native + Expo ~52 | iOS, Android, Windows, macOS desde un código base |
| Web Admin | Next.js 16 (App Router) | Panel de administración (SSR, middleware auth) |
| Backend/API | FastAPI (Python 3.11) | API REST, orquestación de agentes |
| Motor de Agentes | LangChain + LangGraph | Agentes con memoria, tools, flujos complejos |
| Platform DB | PostgreSQL (Supabase) | Usuarios, tenants, planes, suscripciones |
| DB por tenant | Azure SQL | Base de datos operacional de cada tienda |
| Auth | Supabase Auth + JWT | Roles: admin / owner / manager / staff / viewer |
| Monorepo | pnpm workspaces + Turborepo | Una repo, múltiples apps |
| Python deps | uv | Rápido, determinístico, reemplaza pip/poetry |
| Secrets | Supabase Vault / Azure Key Vault | Credenciales Azure SQL encriptadas |

---

## Estructura del Monorepo

```
Alpha-IT-HUB/
├── apps/
│   ├── mobile/          # React Native + Expo (Expo Router v4)
│   ├── web/             # Next.js 16 — Panel Administrador
│   └── backend/         # FastAPI (Python 3.11)
├── packages/
│   ├── shared-types/    # Tipos TypeScript compartidos
│   └── eslint-config/   # Reglas ESLint compartidas
├── supabase/
│   ├── migrations/      # SQL migrations (aplicar en orden)
│   └── seed.sql         # Datos iniciales (planes)
├── ARCHITECTURE.md      # Este archivo
├── .gitignore
├── .npmrc               # pnpm hoisting para React Native
├── package.json         # Root workspace
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Arquitectura Multi-tenant

Cada tienda es un **tenant** completamente aislado:

1. El usuario se autentica con Supabase Auth
2. El JWT incluye `tenant_id` y `user_role` (inyectados por `auth.custom_access_token_hook`)
3. Las políticas RLS en Supabase filtran todos los datos por `tenant_id` automáticamente
4. El backend FastAPI extrae `tenant_id` del JWT para cargar la conexión Azure SQL correcta
5. Las credenciales Azure SQL se almacenan encriptadas en Supabase Vault / Azure Key Vault
6. `TenantConnectionRegistry` cachea los engines SQLAlchemy por tenant (evita re-descifrado)

```
Usuario → Supabase Auth → JWT con tenant_id
    ↓
Mobile App / Web → API Backend (FastAPI)
    ↓
[JWT verification] → tenant_id extraído
    ↓
[Vault] → Azure SQL connection string (encriptado)
    ↓
[TenantConnectionRegistry] → AsyncEngine (cacheado por tenant)
    ↓
Azure SQL del cliente
```

---

## Base de Datos (Supabase/PostgreSQL)

### Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `plans` | Planes disponibles (starter, professional, enterprise) |
| `tenants` | Una tienda = un tenant |
| `users` | Extiende `auth.users`, agrega `tenant_id` y `role` |
| `subscriptions` | Suscripción activa por tenant (Stripe o MercadoPago) |
| `agents` | Agentes definidos (con LangGraph config) |
| `agent_runs` | Historial de ejecuciones de agentes |
| `notifications` | Notificaciones push por usuario/tenant |
| `tenant_db_configs` | Referencia al secret de la DB Azure SQL por tenant |

### Migraciones

Aplicar en orden desde `supabase/migrations/`:
1. `00001_platform_schema.sql` — Tablas, índices, triggers
2. `00002_rls_policies.sql` — RLS policies de tenant isolation
3. `00003_auth_hook.sql` — Hook JWT + función vault_get_secret

### Auth Hook (crítico)

La función `auth.custom_access_token_hook` inyecta `tenant_id` y `user_role` en cada JWT.
**Debe estar habilitada en:** Supabase Dashboard → Authentication → Hooks → Custom Access Token Hook.

---

## Backend FastAPI

### Endpoints (Fase 1)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check del servicio |
| POST | `/api/v1/auth/verify` | Verifica JWT, retorna claims |
| GET | `/api/v1/tenants/me` | Info del tenant del usuario autenticado |

### Módulos

```
src/alpha_hub/
├── main.py              # App factory con lifespan
├── config.py            # Settings via pydantic-settings
├── auth/
│   ├── router.py        # Endpoints de auth
│   ├── schemas.py       # Modelos Pydantic
│   └── service.py       # JWT decode con python-jose
├── tenants/
│   ├── router.py        # Endpoints de tenant
│   ├── middleware.py    # Logging contextual por request
│   └── schemas.py
├── database/
│   ├── platform.py      # AsyncEngine para Supabase/Postgres
│   ├── tenant.py        # TenantConnectionRegistry (Azure SQL)
│   └── vault.py         # VaultClient (Supabase Vault / AKV)
└── api/v1/router.py     # Agrega todos los routers v1
```

### Correr el backend

```bash
cd apps/backend
cp .env.example .env   # Completar con credenciales reales
uv run uvicorn src.alpha_hub.main:app --reload --port 8000
```

---

## App Móvil (React Native + Expo)

### Navegación (Expo Router v4)

```
src/app/
├── _layout.tsx          # Root: carga fonts, inicializa auth
├── index.tsx            # Redirect: session? → (app) : (auth)
├── (auth)/              # Stack sin tab bar
│   ├── login.tsx        # Login con Supabase Auth
│   └── forgot-password.tsx
└── (app)/               # Requiere sesión activa (auth guard)
    └── (tabs)/
        ├── index.tsx    # Dashboard / Inicio
        ├── agents.tsx   # Agentes (Fase 2)
        ├── analysis.tsx # Análisis (Fase 3)
        └── profile.tsx  # Perfil + logout
```

### Paleta de colores

```typescript
// src/theme/colors.ts
primary: '#32576F'   // Azul principal
dark:    '#132229'   // Fondo oscuro (background)
muted:   '#CDD4DA'   // Texto secundario
white:   '#FFFFFF'   // Texto primario
accent:  '#ED7C00'   // Naranja (CTA, acentos, logo)
```

### Tipografía: Space Grotesk

Fuentes TTF requeridas en `assets/fonts/`:
- `SpaceGrotesk-Light.ttf`
- `SpaceGrotesk-Regular.ttf`
- `SpaceGrotesk-Medium.ttf`
- `SpaceGrotesk-SemiBold.ttf`
- `SpaceGrotesk-Bold.ttf`

**Descarga:** https://fonts.google.com/specimen/Space+Grotesk

### Correr la app móvil

```bash
cd apps/mobile
cp .env.example .env
pnpm install
pnpm start   # Abre Expo DevTools en :8081
```

---

## Panel Admin Web (Next.js)

### Estructura

```
src/
├── app/
│   ├── layout.tsx       # Root layout (Space Grotesk, dark theme)
│   ├── page.tsx         # Redirect a /dashboard
│   ├── login/page.tsx   # Login page
│   └── dashboard/page.tsx  # Dashboard (placeholder Fase 1)
├── middleware.ts         # Auth guard (Supabase SSR)
└── lib/supabase/
    ├── client.ts        # Browser client
    └── server.ts        # Server-side client (SSR)
```

### Correr el web admin

```bash
cd apps/web
cp .env.example .env.local   # Completar con credenciales
pnpm dev   # http://localhost:3000
```

---

## Variables de Entorno

### Backend (`apps/backend/.env`)

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
DATABASE_URL=postgresql+asyncpg://...
```

### Mobile (`apps/mobile/.env`)

```
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_API_URL=http://localhost:8000
```

### Web (`apps/web/.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Configuración Supabase (pasos iniciales)

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a SQL Editor y ejecutar las migraciones en orden
3. Habilitar el Auth Hook: Authentication → Hooks → Custom Access Token → `auth.custom_access_token_hook`
4. Habilitar Vault: Extensions → buscar "vault" → activar
5. Obtener credenciales: Settings → API → copiar `URL`, `anon key`, `service_role key`, `JWT Secret`
6. Ejecutar seed: `supabase/seed.sql` (crea los planes)

---

## Fases de Desarrollo

| Fase | Estado | Descripción |
|------|--------|-------------|
| **1 — Fundación** | ✅ Completa | Monorepo, Backend, Auth, App base, Migraciones |
| 2 — Agentes Core | ⏳ Pendiente | LangGraph, Chat, Analista BI, Push notifications |
| 3 — Análisis | ⏳ Pendiente | Gráficos, métricas, PDF, modo offline |
| 4 — Config Avanzada | ⏳ Pendiente | Memoria, permisos, tareas programadas, canales |
| 5 — Panel Admin | ⏳ Pendiente | Dashboard admin, CRUD clientes, React Flow |
| 6 — Pagos | ⏳ Pendiente | Stripe + MercadoPago, webhooks, facturación |
| 7 — Deploy | ⏳ Pendiente | App Store, Play Store, Windows, macOS |

---

## Para Claude Code (contexto entre sesiones)

- **Siempre** leer este archivo al inicio de una sesión para entender el contexto
- El branch de trabajo es `claude/setup-new-project-6JCgS`
- El backend corre en `:8000`, web admin en `:3000`, Expo en `:8081`
- `TenantConnectionRegistry` es el componente crítico de multi-tenancy — no modificar sin entender completamente
- Las migraciones SQL son la fuente de verdad del schema
- Los colores de marca NO deben modificarse sin consultar al cliente
