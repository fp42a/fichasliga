import { verificarFirma, hostPermitido } from "./_core.js";

// GET /api/foto?u=<url base64url>&s=<firma>
// Sirve la foto desde el mismo dominio (necesario para armar el PDF en el navegador).
export default async function handler(req, res) {
  try {
    const url = Buffer.from(String(req.query.u || ""), "base64url").toString("utf8");
    if (!hostPermitido(url) || !verificarFirma(url, req.query.s)) {
      res.status(403).send("Enlace de foto no válido");
      return;
    }
    const r = await fetch(url);
    if (!r.ok) {
      // Las URLs de Airtable caducan (~2 h). El navegador recarga los datos si esto pasa.
      res.setHeader("Cache-Control", "no-store");
      res.status(r.status === 410 || r.status === 403 ? 410 : 502).send("Foto no disponible");
      return;
    }
    const tipo = r.headers.get("content-type") || "image/jpeg";
    if (!tipo.startsWith("image/")) {
      res.status(415).send("No es una imagen");
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", tipo);
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error al cargar la foto");
  }
}
