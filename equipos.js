import { getEquipos, enviarError } from "../lib/core.js";

// GET /api/equipos?school=nombre-del-colegio
export default async function handler(req, res) {
  try {
    const data = await getEquipos(req.query.school);
    // Caché corta en el CDN de Vercel: datos casi en vivo sin saturar Airtable.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    enviarError(res, err);
  }
}
