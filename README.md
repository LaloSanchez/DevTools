# DevTools

Herramientas gratuitas para desarrolladores, en español. Sitio estático con Astro: cada herramienta tiene su propia URL y todo se procesa en el navegador del usuario, sin backend, base de datos ni cuentas.

**Herramientas disponibles:**

| Herramienta | Ruta |
| --- | --- |
| JSON Formatter y Validador | `/tools/json-formatter/` |
| Comparador de texto y JSON | `/tools/text-diff/` |
| SQL Formatter (MySQL y Transact-SQL) | `/tools/sql-formatter/` |
| Convertidor de Unix Timestamp | `/tools/timestamp-converter/` |

**Índice:** [Instalación](#instalación) · [Comandos](#comandos) · [Variables de entorno](#variables-de-entorno) · [Despliegue en Cloudflare Pages](#despliegue-en-cloudflare-pages) · [Dominio y HTTPS](#dominio-propio-y-https) · [Limitaciones](#limitaciones-conocidas)

## Tecnologías

| Pieza | Uso |
| --- | --- |
| Astro 7 | HTML estático e islas interactivas |
| React 19 | Solo en los componentes interactivos |
| TypeScript 6 (estricto) | Se usa 6.x porque `typescript-eslint` y `@astrojs/check` aún no admiten la 7 |
| Tailwind CSS 4 | Estilos, con tema claro y oscuro |
| Vitest 5 | Pruebas unitarias de la lógica |
| ESLint 10 | Linter |

### Dependencias de las herramientas

| Paquete | Para qué | Notas |
| --- | --- | --- |
| [`diff`](https://www.npmjs.com/package/diff) 9 | Comparador de texto | jsdiff: sin dependencias, con tipos propios, licencia BSD-3. Se eligió frente a otras por estar mantenida. |
| [`sql-formatter`](https://www.npmjs.com/package/sql-formatter) 15 | SQL Formatter | Licencia MIT. Se comprobó que soporta los dialectos `mysql` y `transactsql`. Se descarga solo al pulsar «Formatear» (unos 74 KB comprimidos). |

JSON Formatter y el convertidor de timestamp no usan bibliotecas externas: emplean `JSON` e `Intl` del navegador.

## Requisitos

- **Node >= 22.22.0** (Astro 7 lo exige). El archivo `.nvmrc` indica la serie 22: con nvm, `nvm install` y luego `nvm use`.
- npm (incluido con Node).

## Instalación

```bash
git clone <URL-del-repositorio> devtools
cd devtools
nvm install        # instala la versión de .nvmrc si no la tienes
nvm use
node -v            # debe ser v22.22.0 o superior
npm ci             # instala exactamente lo que fija package-lock.json
npm run dev        # http://localhost:4321
```

Si ya trabajas en el proyecto y solo añades dependencias, usa `npm install`. Comprueba la instalación con `npm test` y `npm run build`: ambos deben terminar sin errores.

**Si el servidor de desarrollo falla o los botones desaparecen:** detenlo (Ctrl+C), ejecuta `rm -rf node_modules/.vite .astro` y vuelve a lanzar `npm run dev`. Astro solo permite un servidor de desarrollo por proyecto.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor local con recarga |
| `npm run build` | Compila el sitio estático a `dist/` |
| `npm run preview` | Sirve `dist/` para revisar la compilación |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run test:watch` | Pruebas en modo observación |
| `npm run lint` | ESLint |
| `npm run check` | Comprobación de tipos (`astro check`) |

Antes de publicar cambios: `npm run lint && npm run check && npm test && npm run build`. El flujo de GitHub Actions (`.github/workflows/ci.yml`) ejecuta esos mismos cuatro pasos en cada push a `main` y en cada pull request.

## Estructura

```text
src/
├── components/   Piezas visuales (Header, Footer, ToolCard, Breadcrumbs, AdSlot, SearchTools, CopyRow) y ui.ts (clases compartidas)
├── layouts/      BaseLayout (metadatos SEO, tema) y ToolLayout (página de herramienta)
├── pages/        Una página por URL; las herramientas viven en pages/tools/
├── tools/        Una carpeta por herramienta: lógica (.ts), pruebas (.test.ts) e interfaz (.tsx)
├── lib/          Utilidades compartidas: portapapeles, descarga, validación
├── content/      tools.ts: registro central de herramientas
├── config/       site.ts: configuración por variables de entorno
└── styles/       global.css
```

La lógica de cada herramienta está separada de React para poder probarla sin navegador.

## Añadir una herramienta

1. Crea `src/tools/<slug>/` con `<slug>.ts` (lógica pura), `<slug>.test.ts` y el componente `.tsx`.
2. Crea `src/pages/tools/<slug>.astro` usando `ToolLayout`, con un título y una descripción propios, y texto útil: instrucciones, ejemplos y funcionamiento.
3. En `src/content/tools.ts`, añade la entrada (o cambia `available` a `true`) e indica en `related` las herramientas que se enlazarán desde su página. La home, el buscador y el sitemap la recogen solos.
4. Reutiliza `src/lib/` en lugar de duplicar código.

## Variables de entorno

Ninguna es obligatoria. Están descritas en `.env.example`. Son valores de compilación y no secretos: no pongas claves privadas en el repositorio.

| Variable | Efecto |
| --- | --- |
| `SITE_URL` | Dominio definitivo, sin barra final. Activa canonical, `og:url`, datos estructurados de migas de pan, sitemap y la línea `Sitemap:` de `robots.txt`. Sin ella, nada de eso se genera. |
| `PUBLIC_ADS_ENABLED` | `true` muestra los espacios publicitarios reservados. Por defecto, desactivado. |
| `PUBLIC_CONTACT_EMAIL` | Correo que se muestra en `/contact/`. Sin él, la página indica que el canal no está configurado. |

## Privacidad

- El contenido que se escribe en las herramientas no se envía ni se guarda. No hay `fetch`, `eval` ni `innerHTML` en el código de `src/`.
- Lo único que se guarda en el navegador es la preferencia de tema.
- Se comprobó en Chrome, con registro de peticiones, que usar la herramienta no genera peticiones externas.

## Despliegue en Cloudflare Pages

Revisado el 20 de octubre de 2026. Las condiciones de Cloudflare cambian: compruébalas en su documentación antes de publicar.

**Lista de comprobación rápida**

- [ ] `npm run lint && npm run check && npm test && npm run build` terminan sin errores.
- [ ] El repositorio está en GitHub, con la rama `main`.
- [ ] En Cloudflare: build command `npm run build` y output `dist`.
- [ ] `NODE_VERSION` fijada en 22.22.0 o superior.
- [ ] `SITE_URL` definida con el dominio final (cuando lo tengas).
- [ ] Leídas las condiciones comerciales de Cloudflare antes de activar anuncios.
- [ ] Revisada la política de privacidad (`/privacy/`).

### 1. Subir el repositorio a GitHub

```bash
git add .
git commit -m "Versión inicial"
git remote add origin <URL-del-repositorio>
git push -u origin main
```

### 2. Conectarlo a Cloudflare

En el panel de Cloudflare: **Workers & Pages → Create application → Pages → Import an existing Git repository**, y elige el repositorio. Configura:

| Campo | Valor |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |

### 3. Fijar la versión de Node (importante)

La imagen de compilación de Pages usa **Node 22.16.0 por defecto**, y Astro 7 necesita **22.22.0 o superior**. Si no la fijas, el primer despliegue puede fallar. En **Settings → Environment variables** añade `NODE_VERSION` con un valor concreto, por ejemplo `22.23.2`, o usa un archivo `.nvmrc` con la versión exacta. Comprueba en el registro del primer build qué versión se usó.

### 4. Variables

Añade `SITE_URL` (y las demás si las necesitas) en **Settings → Environment variables**, y vuelve a desplegar. Las variables de Astro se aplican al compilar, no al servir.

### Pages o Workers

La documentación oficial de Cloudflare presenta Workers con recursos estáticos como una plataforma con más funciones que Pages, y ofrece una guía de migración. No encontré en esa documentación un aviso de que Pages esté obsoleto. Este proyecto es un sitio estático sin funciones, así que cualquiera de las dos sirve; si empiezas desde cero, revisa antes la guía de Cloudflare para elegir.

### Condiciones comerciales

Lo que pude comprobar en la documentación oficial (plan gratuito de Pages):

- 500 compilaciones al mes.
- 20.000 archivos por sitio.
- 25 MiB por archivo.
- 100 dominios personalizados por proyecto.

**Lo que no pude confirmar:** si los términos de servicio de Cloudflare permiten o limitan el uso comercial o la inserción de anuncios en el plan gratuito. Las páginas de límites y de despliegue no lo mencionan, y las condiciones específicas que revisé no tienen sección sobre Pages. Lee el Acuerdo de Suscripción y los Términos Específicos de Servicio vigentes antes de monetizar, y consulta a Cloudflare si tienes dudas.

### Dominio propio y HTTPS

1. En tu proyecto de Pages: **Custom domains → Set up a custom domain**.
2. Si el DNS del dominio ya está en Cloudflare, el registro se crea desde el panel. Si no, crea el registro `CNAME` que Cloudflare te indique en tu proveedor de DNS.
3. Cloudflare gestiona el certificado HTTPS del dominio; verifica en el panel que el estado sea activo antes de anunciar el sitio.
4. Define `SITE_URL` con el dominio final y vuelve a desplegar para que canonical y sitemap apunten a él.

## Search Console y analítica

**Search Console (pendiente, requiere dominio):**

1. Añade el dominio en Google Search Console y verifícalo (registro DNS `TXT`, o la etiqueta HTML en `BaseLayout.astro`).
2. Envía `https://tu-dominio.com/sitemap-index.xml`.
3. Esto no garantiza la indexación ni el posicionamiento.

**Analítica (no configurada):** el sitio no usa analítica ni cookies de seguimiento. Antes de añadirla, actualiza `src/pages/privacy.astro` y valora si necesitas aviso de consentimiento según tu jurisdicción. Nunca registres el contenido que los usuarios escriben en las herramientas.

## Publicidad

Los espacios están desactivados: `AdSlot.astro` no incluye scripts, identificadores ni redes. Para activarlos en el futuro:

1. Obtén la aprobación de la red publicitaria. Este proyecto no la garantiza.
2. Pega el código de la red dentro de `AdSlot.astro` y pon `PUBLIC_ADS_ENABLED=true`.
3. Actualiza la política de privacidad y, si la red lo exige, añade `public/ads.txt`.
4. No coloques anuncios cerca de los botones de las herramientas ni dentro de los campos de texto.

## Limitaciones conocidas

- Solo se probó en Chrome (sin interfaz, con `puppeteer-core`). Safari, Firefox y dispositivos móviles reales están sin probar. Esas pruebas de navegador no forman parte del repositorio: `npm test` solo ejecuta las pruebas unitarias.
- JSON Formatter y el comparador en modo JSON redondean los enteros de más de 15 dígitos (limitación de `JSON.parse`) y avisan al usuario.
- Con entradas cercanas a los límites (5 MB en JSON, 1 MB por lado en el comparador, 512 KB en SQL), la pestaña puede quedarse un momento sin responder.
- SQL Formatter **formatea, no valida**: solo detecta fragmentos que no puede reconocer (comillas o corchetes sin cerrar). Un SQL con errores lógicos se formatea igualmente.
- Convertidor de timestamp: la detección automática de segundos/milisegundos falla con milisegundos anteriores a marzo de 1973 (hay que elegir la unidad a mano), y las fechas legibles se limitan a los años 1–9999.
- El comparador no resalta diferencias dentro de líneas que apenas se parecen (se muestran como eliminada y añadida).
- Tras instalar dependencias o cambiar la configuración, reinicia `npm run dev` (y borra `node_modules/.vite` si la interfaz deja de hidratar).
- No hay imagen para redes sociales (`og:image`).
- La política de privacidad es un borrador técnico, no asesoramiento legal.
