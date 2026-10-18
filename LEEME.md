# THE EDIT — cómo ponerla en línea

THE EDIT ahora es una app web independiente. Funciona en tu iPhone y tu laptop con su propio ícono y su propia dirección web, y no necesita claude.ai.

| Pieza | Para qué sirve | Servicio | Costo |
|---|---|---|---|
| La app | Las pantallas de THE EDIT | **GitHub Pages** | Gratis |
| Base de datos, fotos e inicio de sesión | Tus prendas, looks, pins y viajes, privados para ti | **Supabase** | Gratis (500 MB de datos y 1 GB de fotos) |
| Inteligencia artificial | Decodificar pins, estilista, portada y lectura de moodboard | **API de Claude (Anthropic)** | Pagas lo que usas |
| Clima en vivo | Clima de hoy y pronóstico del viaje | **Open-Meteo** | Gratis, sin cuenta |

Cuenta con unos 30–45 minutos la primera vez. Solo necesitas un navegador.

---

## 1. Crea tu base de datos en Supabase

1. Entra a **supabase.com**, crea una cuenta y presiona **New project**.
   - Nombre: `the-edit`
   - Región: la más cercana a ti, por ejemplo *East US*.
   - Guarda la contraseña de la base de datos en un lugar seguro.
2. Cuando el proyecto esté listo, ve a **SQL Editor → New query**.
3. Abre el archivo `supabase/schema.sql` de esta carpeta, copia todo, pégalo y presiona **Run**. Debe decir *Success*.

## 2. Conecta la app con tu proyecto

1. En Supabase ve a **Project Settings → API** (o **API Keys**).
2. Copia la **Project URL** y la **anon / publishable key**.
3. Abre `docs/config.js` y reemplaza los dos valores:
   ```js
   SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ… o sb_publishable_…',
   ```
   Esa llave puede ser pública: tus datos están protegidos por tu inicio de sesión y por las reglas que creó el paso 1.

## 3. Crea tu llave de la API de Claude

1. Entra a **console.anthropic.com** y crea una cuenta.
2. En **Billing**, agrega crédito (empieza con poco, por ejemplo 10 USD). Te recomiendo poner un **límite de gasto mensual**.
3. En **API Keys → Create Key**, copia la llave (`sk-ant-…`). No la pegues en ningún archivo de la app.

**Cuánto cuesta:** la app usa **Claude Opus 5.5**. Cada acción de IA (decodificar un pin, pedir looks, escribir la portada) cuesta aproximadamente entre 1 y 10 centavos de dólar. Leer tu moodboard con 8 fotos es lo más caro. Con uso normal, la mayoría de los meses son pocos dólares.

## 4. Sube la función de IA

Esta función guarda tu llave de Claude en el servidor, así nunca llega al navegador.

1. En Supabase ve a **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre de la función: **`ai`**, exactamente así.
3. Borra el código de ejemplo, pega todo `supabase/functions/ai/index.ts` y presiona **Deploy**.
4. Ve a **Edge Functions → Secrets** y agrega:
   - `ANTHROPIC_API_KEY` = tu llave `sk-ant-…`
   - `ALLOWED_EMAIL` = tu correo. Así solo tu cuenta puede usar la IA.

La función también importa imágenes desde enlaces de Pinterest. Solo acepta enlaces de Pinterest, para que nadie la pueda usar con otros sitios.

Si Claude rechaza alguna petición por sus filtros de seguridad, la función la reintenta automáticamente con un modelo alternativo adecuado.

## 5. Publica la app en GitHub Pages

Tu repositorio es **github.com/durandanniela-oss/The_Edit**.

1. En el repositorio presiona **Add file → Upload files**.
2. Desde Finder (`Documentos/THE EDIT`), arrastra las carpetas **`docs`** y **`supabase`** a la página y presiona **Commit changes**. La carpeta `migration/` tiene tus datos personales: **no la subas**.
3. Ve a **Settings → Pages**. En **Source** elige **Deploy from a branch**, en **Branch** elige **main** y la carpeta **/docs**, y presiona **Save**.
4. En uno o dos minutos tu app está en **https://durandanniela-oss.github.io/The_Edit/**
5. Regresa a Supabase, ve a **Authentication → URL Configuration** y pon esa dirección en **Site URL**.

Que el código sea público no expone tus datos. Tu ropa, tus fotos y tus viajes viven en Supabase, protegidos por tu contraseña, y la llave de Claude vive en los secretos de Supabase, nunca en GitHub.

## 6. Crea tu cuenta y ciérrala para los demás

1. Abre tu dirección de GitHub Pages y presiona **Create my account** con tu correo y una contraseña.
2. Si te llega un correo de confirmación, ábrelo y luego regresa a iniciar sesión.
3. En Supabase ve a **Authentication → Sign In / Providers** (o **Settings**) y **desactiva "Allow new users to sign up"**. Con eso nadie más puede crear una cuenta.

## 7. Trae lo que ya tenías

En la app, ve a **Profile → Import backup** y elige `migration/the-edit-backup.json`. Trae tu viaje **Europe Edit**, tu foto de portada y el pin que ya decodificaste.

## 8. Instálala

- **iPhone:** abre tu dirección en **Safari**, toca **Compartir → Añadir a pantalla de inicio**. Aparece con tu ícono de THE EDIT y se abre a pantalla completa, sin barra del navegador. Inicia sesión una vez dentro del ícono.
- **Mac con Chrome:** en la barra de direcciones toca el ícono de **Instalar**.
- **Mac con Safari:** en el menú **Archivo → Añadir al Dock**.

---

## Lo que cambió respecto a la versión de claude.ai

- **Clima en vivo:** pon tu ciudad en Profile y el clima de hoy se llena solo. En cada viaje, **Fill in the forecast** agrega el pronóstico de cada ciudad, hasta unos 16 días antes.
- **Enlaces de Pinterest:** en *Save inspiration* pega el enlace de un pin y la app trae la imagen. Si Pinterest no lo permite, sube una captura.
- **Guardar collages:** *Export* descarga el PNG. En el iPhone abre el menú de compartir para guardarlo en Fotos.
- **Respaldo:** *Profile → Export my data* descarga un archivo con todos tus datos.

## Mantenimiento

- **Actualizar la app:** cuando te entregue cambios, sube de nuevo los archivos que cambiaron a la carpeta `docs` del repositorio (**Add file → Upload files**). GitHub Pages los publica en uno o dos minutos.
- **Supabase gratis se pausa** si pasa una semana sin que nadie abra la app. Para reactivarla, entra a supabase.com y presiona **Restore**. Tus datos no se pierden.
- **Probar en tu computadora:** desde esta carpeta, en la Terminal:
  ```bash
  python3 -m http.server 8642 --directory docs
  ```
  Luego abre `http://localhost:8642`.

## Archivos

```
docs/                     ← la app, lo que publica GitHub Pages
  index.html, styles.css, app.js, config.js
  manifest.webmanifest, sw.js, icons/
supabase/
  schema.sql              ← paso 1
  functions/ai/index.ts   ← paso 4
migration/
  the-edit-backup.json    ← paso 7
```
