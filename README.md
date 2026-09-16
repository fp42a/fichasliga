# Fichas de inscripción · La Liga Estudiantil

Web app que muestra los equipos de **un colegio**, leyendo **en vivo** la tabla
`INSCRIPCION DE JUGADORES APERTURA 2026` de la base `LIGA ESTUDIANTIL GSC` en Airtable.

- Enlace por colegio: `https://TU-PROYECTO.vercel.app/?school=colegio-americano`
- Agrupa por **deporte → rama → categoría**. Cada jugador aparece con su nombre y su foto.
- Cada equipo tiene un botón **Descargar PDF** (A4, 20 jugadores en la primera página y 25 en las siguientes).
- Funciona en celular y en computadora, y respeta el modo oscuro.

## Cómo funciona

```
Navegador ──► /api/equipos?school=…  ──► Airtable (con el token guardado en Vercel)
          ──► /api/foto?u=…&s=…      ──► fotos de Airtable (enlaces firmados)
```

- El token de Airtable **solo vive en Vercel**. El navegador nunca lo ve.
- La API solo pide a Airtable 6 campos: nombre, colegio, deporte, rama, categoría y foto.
  El campo **"Acta de Nacimiento Jugador o Pasaporte"** (documentos de identidad) **nunca se consulta**.
- `/api/foto` solo entrega imágenes de Airtable con una firma válida, así que no sirve como proxy abierto.
- Los datos se guardan en caché 60 s y la lista de colegios, 10 min. Un cambio en Airtable aparece en la app en 1 a 10 minutos.

## Publicar en Vercel (una sola vez)

### 1. Crear el token de Airtable
1. Entra a <https://airtable.com/create/tokens> y haz clic en **Create token**.
2. Nombre: `Fichas Liga (solo lectura)`.
3. En **Scopes** agrega **solo** estos dos:
   - `data.records:read`
   - `schema.bases:read`
4. En **Access** agrega **únicamente** la base **LIGA ESTUDIANTIL GSC**.
5. Haz clic en **Create token** y copia el token (empieza con `pat…`). No lo compartas por chat ni por correo.

### 2. Subir el código a GitHub
1. En GitHub crea un repositorio **privado**, por ejemplo `fichas-liga`.
2. Descomprime el zip y arrastra **todo el contenido** de la carpeta (`api/`, `lib/`, `public/`, `package.json`, `vercel.json`, etc.) a **Add file → Upload files**. Luego haz clic en **Commit**.

### 3. Crear el proyecto en Vercel
1. En <https://vercel.com/new>, importa el repositorio `fichas-liga`.
2. En **Framework Preset** elige **Other**. Deja los demás campos como están.
3. Abre **Environment Variables** y agrega:
   - `AIRTABLE_TOKEN` = el token del paso 1
   - `FOTO_SECRET` = cualquier texto largo y aleatorio (recomendado)
4. Haz clic en **Deploy**.
5. Prueba con: `https://TU-PROYECTO.vercel.app/?school=colegio-americano`

> Usa siempre el dominio de producción (`TU-PROYECTO.vercel.app`). Los enlaces de *preview* de Vercel piden iniciar sesión.
> Si los colegios ven una pantalla de login de Vercel, entra a **Settings → Deployment Protection** y elige **Standard Protection**, que deja el dominio de producción público.
>
> Nota sobre el plan: el plan gratuito (Hobby) de Vercel es para uso personal y no comercial. Para uso de GSC corresponde el plan Pro.

**Alternativa por terminal:** `npx vercel` → `npx vercel env add AIRTABLE_TOKEN` → `npx vercel --prod`.

## Enlaces para enviar

El archivo `enlaces-colegios.csv` trae el enlace y un mensaje listo para WhatsApp para cada colegio.
Antes de enviarlo, reemplaza `TU-PROYECTO.vercel.app` por tu dominio real (con Buscar y reemplazar en Excel o Google Sheets).

El enlace es el nombre del colegio **tal como aparece en el campo "Colegio Participante"**,
sin tildes, en minúsculas y con guiones. También funciona con el nombre escrito normal:
`?school=Colegio Americano`.

## Mantenimiento

- **Colegio nuevo:** agrégalo como opción en "Colegio Participante". Su enlace funciona de inmediato.
- **Cuidado al renombrar una opción de colegio:** su enlace cambia y el anterior deja de funcionar.
- **Jugadores sin colegio** no aparecen en ningún enlace. Hoy hay 454.
- **Jugadores inscritos en 2 o más categorías** aparecen en cada una.
- Si un registro tiene deporte y categoría que no coinciden (por ejemplo, Fútbol con una categoría de VOLEIBOL), el jugador aparece con esa combinación para que el colegio lo vea y lo corrija.
- **Otra tabla** (por ejemplo, Clausura): define `AIRTABLE_TABLE_ID` en Vercel. La tabla nueva debe tener los mismos IDs de campo. Si no, actualiza `CONFIG.fields` en `lib/core.js`.

## Privacidad

Cualquiera que tenga el enlace, o que adivine el nombre de un colegio, puede ver nombres y fotos de sus jugadores.
El sitio está marcado `noindex` para que no aparezca en buscadores. Para más control, los enlaces se pueden
cambiar a códigos aleatorios sin rehacer la app.

## Archivos

| Archivo | Qué hace |
|---|---|
| `api/equipos.js` | Endpoint que devuelve los equipos del colegio |
| `api/foto.js` | Proxy firmado de fotos (necesario para generar el PDF) |
| `lib/core.js` | Lectura de Airtable, agrupación y firmas |
| `public/index.html`, `app.js`, `styles.css` | Interfaz y generación del PDF |
| `public/vendor/jspdf.umd.min.js` | Librería jsPDF 2.5.2 (MIT) |
