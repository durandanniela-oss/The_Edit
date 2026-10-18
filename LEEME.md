# THE EDIT: cómo ponerla en línea (solo con GitHub)

THE EDIT es una app web que funciona en tu iPhone y tu laptop con su propio ícono.

| Pieza | Dónde vive | Costo |
|---|---|---|
| La app | Repositorio público **The_Edit**, publicado con GitHub Pages | Gratis |
| Tus prendas, looks, pins, viajes y fotos | Repositorio **privado** `the-edit-data` | Gratis |
| Inteligencia artificial | Tu propia llave de Claude, guardada solo en tus dispositivos | Pagas lo que usas |
| Clima en vivo | Open-Meteo | Gratis, sin cuenta |

Tu app: **https://durandanniela-oss.github.io/The_Edit/**

---

## 1. Crea el repositorio privado para tus datos

1. Entra a **github.com/new**.
2. En **Repository name** escribe `the-edit-data`.
3. Elige **Private**. Es importante: la app no se conecta a un repositorio público.
4. Marca **Add a README file** y presiona **Create repository**.

## 2. Crea la llave de acceso de la app

Esta llave le permite a THE EDIT guardar y leer **solo** en `the-edit-data`.

1. Entra a **github.com/settings/personal-access-tokens/new**.
2. Llena el formulario:
   - **Token name:** `THE EDIT`
   - **Expiration:** *Custom* → un año.
   - **Repository access:** *Only select repositories* → `the-edit-data`.
   - **Permissions → Repository permissions → Contents:** **Read and write**.
3. Presiona **Generate token** y copia la llave (`github_pat_…`). GitHub la muestra una sola vez; guárdala en tus Notas o en tu gestor de contraseñas.

## 3. Sube la versión nueva de la app

En **github.com/durandanniela-oss/The_Edit** presiona **Add file → Upload files**. Desde `Documentos/THE EDIT/docs` arrastra estos archivos y presiona **Commit changes**:

`app.js` · `index.html` · `config.js` · `manifest.webmanifest` · `sw.js` · `styles.css`

Después borra los archivos que ya no se usan. Para cada uno: ábrelo → **⋯** → **Delete file** → **Commit changes**.
- `the-edit-backup.json` (tiene tus datos personales)
- `docs/CNAME`
- `schema.sql`
- `index.ts`

## 4. Conecta la app

1. Abre **https://durandanniela-oss.github.io/The_Edit/**
2. En **Data repository** deja `the-edit-data` y en **GitHub access token** pega tu llave `github_pat_…`.
3. Presiona **Connect**.

Repite este paso una vez en cada dispositivo (iPhone y laptop). Los datos se sincronizan entre los dos.

## 5. Activa la IA

1. En **console.anthropic.com**, crea tu cuenta, agrega crédito en **Billing** (por ejemplo 10 USD) y pon un **límite de gasto mensual**.
2. En **API Keys**, presiona **Create Key** y copia la llave (`sk-ant-…`).
3. En THE EDIT ve a **Profile → AI**, pega la llave y presiona **Save key**. Hazlo en cada dispositivo.

La app usa **Claude Opus 5.5**. Cada acción de IA cuesta aproximadamente entre 1 y 10 centavos de dólar. Si Claude rechaza algo por sus filtros de seguridad, se reintenta automáticamente con un modelo alternativo adecuado.

## 6. Trae lo que ya tenías

En **Profile → Import backup**, elige `Documentos/THE EDIT/migration/the-edit-backup.json`. Trae tu viaje Europe Edit, tu portada y el pin que decodificaste.

## 7. Instálala

- **iPhone:** abre la dirección en **Safari** → **Compartir → Añadir a pantalla de inicio**. Haz el paso 4 dentro del ícono instalado.
- **Mac con Chrome:** presiona el ícono de **Instalar** en la barra de direcciones.
- **Mac con Safari:** menú **Archivo → Añadir al Dock**.

---

## Seguridad

- Tus datos viven en un repositorio **privado** y solo tu llave puede leerlo.
- Las llaves (la de GitHub y la de Claude) se guardan **solo en el navegador de cada dispositivo**. Nunca se suben a GitHub.
- **Si pierdes tu teléfono:** borra la llave en **github.com/settings/personal-access-tokens** y crea una nueva. En console.anthropic.com puedes borrar también la de Claude.
- **Cada año** la llave de GitHub vence. Crea una nueva (paso 2) y vuelve a conectar (paso 4).

## Mantenimiento

- **Actualizar la app:** sube los archivos que cambien al repositorio The_Edit (**Add file → Upload files**). GitHub Pages publica en uno o dos minutos.
- **Respaldo:** en **Profile → Export my data** se descarga un archivo con todo. Además, el historial de `the-edit-data` guarda cada cambio.
- **Probar en tu computadora:**
  ```bash
  python3 -m http.server 8642 --directory docs
  ```
