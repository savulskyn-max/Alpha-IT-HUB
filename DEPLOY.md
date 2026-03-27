# Deploy — apps/client/ en Vercel

## Prerrequisitos

- Cuenta en [Vercel](https://vercel.com)
- Repo `savulskyn-max/Alpha-IT-HUB` conectado a Vercel (import desde GitHub)
- Backend corriendo en Railway (branch `claude/setup-new-project-6JCgS`)
- Proyecto de Supabase configurado

---

## 1. Crear proyecto en Vercel

1. Ir a [vercel.com/new](https://vercel.com/new)
2. Seleccionar **Import Git Repository** y elegir `savulskyn-max/Alpha-IT-HUB`
3. En la configuración del proyecto:
   - **Root Directory:** `apps/client`
   - **Framework Preset:** Next.js (se autodetecta)
   - **Build Command:** se toma del `vercel.json` automáticamente
   - **Install Command:** se toma del `vercel.json` automáticamente

---

## 2. Variables de entorno

Configurar en **Vercel Dashboard > Project > Settings > Environment Variables**:

| Variable | Valor | De dónde sacarlo |
|----------|-------|-------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://chntqspphswfuzxwvsom.supabase.co` | Supabase Dashboard > Settings > API > Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbG...` | Supabase Dashboard > Settings > API > anon/public key |
| `NEXT_PUBLIC_API_URL` | `https://tu-backend.railway.app` | Railway Dashboard > tu servicio > Settings > Public URL |

### De dónde sacar la URL del backend en Railway:

1. Ir a [railway.app](https://railway.app) > tu proyecto
2. Click en el servicio del backend
3. **Settings** > **Networking** > **Public Networking**
4. Copiar la URL pública (ej: `https://alpha-it-hub-production.up.railway.app`)

---

## 3. Deploy

El deploy es automático:
- Cada push al branch configurado en Vercel triggerea un nuevo deploy
- El branch por defecto es `main`, pero se puede cambiar a `claude/setup-new-project-6JCgS` en **Settings > Git > Production Branch**

Para deploy manual:
```bash
npm i -g vercel
cd apps/client
vercel --prod
```

---

## 4. Configurar dominio alphaitgroup.com

### Paso 1: Agregar dominio en Vercel

1. Ir a **Vercel Dashboard > Project > Settings > Domains**
2. Agregar `alphaitgroup.com`
3. Agregar `www.alphaitgroup.com`
4. Vercel te mostrará los DNS records necesarios

### Paso 2: Cambiar DNS (en tu registrador de dominio)

Actualmente el dominio apunta a GitHub Pages. Hay que reemplazar los records:

**Eliminar** los records actuales de GitHub Pages:
- Los A records que apuntan a `185.199.108.153`, `185.199.109.153`, etc.
- El CNAME de `www` que apunta a `savulskyn-max.github.io`

**Agregar** los records de Vercel:

| Tipo | Nombre | Valor |
|------|--------|-------|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

### Paso 3: Verificar

1. Los DNS pueden tardar hasta 48 horas en propagarse (usualmente 5-30 minutos)
2. Vercel generará automáticamente el certificado SSL
3. Verificar en **Vercel Dashboard > Domains** que aparezca "Valid Configuration"

---

## 5. Nota sobre GitHub Pages

Una vez que el dominio esté apuntando a Vercel:

1. Ir al repo `savulskyn-max/landing` en GitHub
2. **Settings > Pages** > quitar el custom domain `alphaitgroup.com`
3. Esto evita conflictos de DNS

---

## Troubleshooting

### Error ERR_PNPM_OUTDATED_LOCKFILE
Si el build falla con este error, el `pnpm-lock.yaml` no incluye las dependencias nuevas.
Solución: correr `pnpm install --no-frozen-lockfile` localmente y commitear el lockfile actualizado.

### Build falla por variables de entorno
Verificar que las 3 variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`) estén configuradas en Vercel y que estén habilitadas para el environment "Production".

### API calls devuelven 500 / CORS
Verificar que `NEXT_PUBLIC_API_URL` apunte a la URL correcta de Railway y que el backend tenga CORS configurado para permitir `https://alphaitgroup.com`.
