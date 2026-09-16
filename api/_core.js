// Lógica compartida: lectura de Airtable, agrupación de equipos y firma de fotos.
import crypto from "node:crypto";

// IDs fijos de la base "LIGA ESTUDIANTIL GSC" / tabla "INSCRIPCION DE JUGADORES APERTURA 2026".
// Se usan IDs (no nombres) para que renombrar un campo en Airtable no rompa la app.
export const CONFIG = {
  apiUrl: process.env.AIRTABLE_API_URL || "https://api.airtable.com",
  baseId: process.env.AIRTABLE_BASE_ID || "appVab1hoqHolmMKT",
  tableId: process.env.AIRTABLE_TABLE_ID || "tblc9Ve7A2pNVPaRa",
  fields: {
    nombre: "fld7RHc6hXFvhN5Nu", // Estudiante-atleta #1
    colegio: "fldBtnReVTizlgOW1", // Colegio Participante (single select)
    deporte: "fld4QKpUb4JqLZQCq", // Deporte (multiple select)
    rama: "fldlCTIR1cNH9CyvG", // Rama (single select)
    categoria: "fldrEf5C5QXRItjpu", // Categoría (multiple select)
    foto: "fldyNpTo8gkfIaJaY", // "Acta de Nacimiento Jugador o Pasaporte copy" = FOTO del jugador
    // IMPORTANTE: el campo "Acta de Nacimiento Jugador o Pasaporte" (fldYNycjYUl8LIzAi)
    // contiene documentos de identidad y NUNCA se solicita a Airtable.
  },
};

const ORDEN_DEPORTES = ["Fútbol", "Baloncesto", "Voleibol"];

function token() {
  const t = process.env.AIRTABLE_TOKEN;
  if (!t) throw httpError(500, "Falta configurar AIRTABLE_TOKEN en el servidor.");
  return t;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function airtableGet(path, params) {
  const url = new URL(CONFIG.apiUrl + path);
  for (const [k, v] of params || []) url.searchParams.append(k, v);
  let lastErr;
  for (let intento = 0; intento < 4; intento++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (r.status === 429) {
      // Límite de Airtable (5 req/s por base): esperar y reintentar.
      await new Promise((res) => setTimeout(res, 1000 * (intento + 1)));
      lastErr = httpError(503, "Airtable está ocupado, intenta de nuevo en unos segundos.");
      continue;
    }
    if (!r.ok) {
      const body = await r.text();
      console.error("Airtable error", r.status, body.slice(0, 500));
      throw httpError(502, "No se pudo leer Airtable (revisa el token y sus permisos).");
    }
    return r.json();
  }
  throw lastErr;
}

// ---- Catálogo de colegios (opciones del campo "Colegio Participante") ----
let catalogo = null; // { at, campoNombre, colegios: Map<slug, nombre> }
const CATALOGO_TTL = 10 * 60 * 1000;

export async function getCatalogo() {
  if (catalogo && Date.now() - catalogo.at < CATALOGO_TTL) return catalogo;
  const meta = await airtableGet(`/v0/meta/bases/${CONFIG.baseId}/tables`);
  const tabla = meta.tables.find((t) => t.id === CONFIG.tableId);
  if (!tabla) throw httpError(500, "No se encontró la tabla de inscripción en Airtable.");
  const campo = tabla.fields.find((f) => f.id === CONFIG.fields.colegio);
  if (!campo) throw httpError(500, "No se encontró el campo 'Colegio Participante'.");
  const colegios = new Map();
  for (const c of campo.options?.choices || []) {
    const slug = slugify(c.name);
    if (slug && !colegios.has(slug)) colegios.set(slug, c.name);
  }
  catalogo = { at: Date.now(), campoNombre: campo.name, colegios };
  return catalogo;
}

// ---- Firma de URLs de fotos (evita que /api/foto sea un proxy abierto) ----
function secreto() {
  return process.env.FOTO_SECRET || crypto.createHash("sha256").update("fotos:" + token()).digest("hex");
}

export function firmar(url) {
  return crypto.createHmac("sha256", secreto()).update(url).digest("base64url").slice(0, 32);
}

export function verificarFirma(url, sig) {
  const esperado = firmar(url);
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(sig || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hostPermitido(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname.endsWith(".airtableusercontent.com") || u.hostname === "dl.airtable.com");
  } catch {
    return false;
  }
}

function urlFoto(adjuntos) {
  const a = (adjuntos || []).find((x) => (x.type || "").startsWith("image/")) || null;
  if (!a) return null;
  const url = a.thumbnails?.large?.url || a.thumbnails?.full?.url || a.url;
  if (!url || !hostPermitido(url)) return null;
  return `/api/foto?u=${encodeURIComponent(Buffer.from(url).toString("base64url"))}&s=${firmar(url)}`;
}

// ---- Categorías ----
function etiquetaCategoria(nombre) {
  const anios = (String(nombre).match(/\d{4}/g) || []).map(Number).sort((a, b) => a - b);
  return anios.length ? anios.join("-") : String(nombre).replace(/\(.*\)/, "").replace(/[,\s]+$/, "").trim();
}

function esCategoriaVoleibol(nombre) {
  return /VOLEIBOL/i.test(nombre);
}

// Empareja cada deporte con las categorías que le corresponden.
// Si un registro tiene datos inconsistentes (p. ej. Fútbol con categoría de VOLEIBOL),
// se usan sus categorías tal cual para que el jugador no desaparezca.
function paresDeporteCategoria(deportes, categorias) {
  let deps = deportes.slice();
  if (!deps.length) {
    deps = [categorias.some(esCategoriaVoleibol) ? "Voleibol" : "Sin deporte"];
  }
  const pares = [];
  for (const d of deps) {
    const propias = categorias.filter((c) => (d === "Voleibol") === esCategoriaVoleibol(c));
    const usar = propias.length ? propias : categorias.length ? categorias : ["Sin categoría"];
    for (const c of usar) pares.push([d, c]);
  }
  return pares;
}

// ---- Consulta principal ----
export async function getEquipos(schoolParam) {
  const slug = slugify(schoolParam);
  if (!slug) throw httpError(400, "Falta el parámetro ?school= en el enlace.");
  const cat = await getCatalogo();
  const nombreColegio = cat.colegios.get(slug);
  if (!nombreColegio) throw httpError(404, "No encontramos ese colegio. Revisa el enlace que te enviaron.");

  const F = CONFIG.fields;
  const valor = nombreColegio.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const campo = cat.campoNombre.replace(/}/g, "\\}");
  const formula = `{${campo}} = '${valor}'`;

  const registros = [];
  let offset;
  do {
    const params = [
      ["filterByFormula", formula],
      ["returnFieldsByFieldId", "true"],
      ["pageSize", "100"],
      ["fields[]", F.nombre],
      ["fields[]", F.colegio],
      ["fields[]", F.deporte],
      ["fields[]", F.rama],
      ["fields[]", F.categoria],
      ["fields[]", F.foto],
    ];
    if (offset) params.push(["offset", offset]);
    const page = await airtableGet(`/v0/${CONFIG.baseId}/${CONFIG.tableId}`, params);
    registros.push(...page.records);
    offset = page.offset;
  } while (offset);

  const equipos = new Map();
  const unicos = new Set();
  for (const r of registros) {
    const f = r.fields || {};
    // Doble verificación: solo jugadores de este colegio.
    if (slugify(f[F.colegio]) !== slug) continue;
    const nombre = String(f[F.nombre] || "").replace(/\s+/g, " ").trim();
    if (!nombre) continue;
    const rama = f[F.rama] === "Femenina" ? "Femenino" : f[F.rama] === "Masculino" ? "Masculino" : "Sin rama";
    const deportes = Array.isArray(f[F.deporte]) ? f[F.deporte] : f[F.deporte] ? [f[F.deporte]] : [];
    const categorias = Array.isArray(f[F.categoria]) ? f[F.categoria] : f[F.categoria] ? [f[F.categoria]] : [];
    const foto = urlFoto(f[F.foto]);
    unicos.add(r.id);
    for (const [deporte, categoriaRaw] of paresDeporteCategoria(deportes, categorias)) {
      const categoria = etiquetaCategoria(categoriaRaw);
      const key = `${deporte}|${rama}|${categoria}`;
      if (!equipos.has(key)) equipos.set(key, { id: slugify(key), deporte, rama, categoria, jugadores: [] });
      equipos.get(key).jugadores.push({ id: r.id, nombre, foto });
    }
  }

  const lista = [...equipos.values()];
  for (const e of lista) e.jugadores.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const idxDep = (d) => (ORDEN_DEPORTES.indexOf(d) + 1 || 99);
  lista.sort(
    (a, b) =>
      idxDep(a.deporte) - idxDep(b.deporte) ||
      a.deporte.localeCompare(b.deporte, "es") ||
      a.rama.localeCompare(b.rama, "es") ||
      a.categoria.localeCompare(b.categoria, "es", { numeric: true })
  );

  return {
    colegio: nombreColegio.replace(/\s+/g, " ").trim(),
    slug,
    totalJugadores: unicos.size,
    totalEquipos: lista.length,
    actualizado: new Date().toISOString(),
    equipos: lista,
  };
}

export function enviarError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.status ? err.message : "Error inesperado en el servidor." });
}
