(() => {
  "use strict";

  const COLORES = { "Fútbol": "var(--futbol)", "Baloncesto": "var(--baloncesto)", "Voleibol": "var(--voleibol)" };
  const COLORES_PDF = { "Fútbol": [31, 138, 76], "Baloncesto": [217, 100, 30], "Voleibol": [45, 98, 200] };
  const AZUL = [11, 42, 91];

  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(location.search);
  const school = (params.get("school") || params.get("colegio") || "").trim();

  let datos = null;
  let filtro = "Todos";

  // ---------- Utilidades ----------
  function iniciales(nombre) {
    const p = nombre.split(" ").filter(Boolean);
    return ((p[0] || "")[0] || "").concat((p[1] || "")[0] || "").toUpperCase();
  }

  function el(tag, attrs = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.style.cssText = v;
      else n.setAttribute(k, v);
    }
    for (const h of hijos) if (h != null) n.append(h);
    return n;
  }

  let toastTimer;
  function toast(msg, ms = 3500) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  function mostrarEstado(titulo, texto) {
    const c = $("#contenido");
    c.replaceChildren(el("div", { class: "estado" }, el("h2", { text: titulo }), el("p", { text: texto })));
  }

  function nombreEquipo(e) {
    return `${e.deporte} ${e.rama}`;
  }

  // ---------- Datos ----------
  async function cargar(forzar = false) {
    const url = `/api/equipos?school=${encodeURIComponent(school)}${forzar ? `&t=${Date.now()}` : ""}`;
    const r = await fetch(url, { cache: forzar ? "no-store" : "default" });
    let body = null;
    try { body = await r.json(); } catch { /* respuesta no JSON */ }
    if (!r.ok) {
      const err = new Error((body && body.error) || "No se pudo cargar la información.");
      err.status = r.status;
      throw err;
    }
    return body;
  }

  // ---------- Render ----------
  function render() {
    const { colegio, equipos, totalJugadores } = datos;
    document.title = `${colegio} · Fichas de inscripción`;
    $("#titulo").textContent = colegio;
    $("#meta").textContent = `${equipos.length} ${equipos.length === 1 ? "equipo" : "equipos"} · ${totalJugadores} jugadores`;

    if (!equipos.length) {
      $("#filtros").hidden = true;
      mostrarEstado("Aún no hay jugadores inscritos", "Cuando se registren jugadores para este colegio aparecerán aquí.");
      return;
    }

    // Filtros por deporte
    const deportes = [...new Set(equipos.map((e) => e.deporte))];
    const nav = $("#filtros");
    nav.replaceChildren();
    if (deportes.length > 1) {
      for (const d of ["Todos", ...deportes]) {
        const n = d === "Todos" ? equipos.length : equipos.filter((e) => e.deporte === d).length;
        const b = el("button", { type: "button", class: "chip", "aria-pressed": String(filtro === d) }, d, el("span", { class: "n", text: ` (${n})` }));
        b.addEventListener("click", () => { filtro = d; render(); window.scrollTo({ top: 0 }); });
        nav.append(b);
      }
      nav.hidden = false;
      const activo = nav.querySelector('[aria-pressed="true"]');
      if (activo && filtro !== "Todos") activo.scrollIntoView({ block: "nearest", inline: "center" });
    } else {
      nav.hidden = true;
    }

    const tpl = $("#tpl-equipo");
    const frag = document.createDocumentFragment();
    for (const d of deportes) {
      if (filtro !== "Todos" && filtro !== d) continue;
      const lista = equipos.filter((e) => e.deporte === d);
      const sec = el("section", { class: "deporte", style: `--c:${COLORES[d] || "var(--otro)"}` },
        el("h2", { class: "deporte__titulo" }, d, el("span", { class: "n", text: `${lista.length} ${lista.length === 1 ? "equipo" : "equipos"}` })));

      for (const e of lista) {
        const art = tpl.content.firstElementChild.cloneNode(true);
        art.id = e.id;
        art.querySelector(".equipo__titulo").textContent = nombreEquipo(e);
        art.querySelector(".equipo__sub").textContent = `Categoría ${e.categoria} · ${e.jugadores.length} ${e.jugadores.length === 1 ? "jugador" : "jugadores"}`;
        const btn = art.querySelector(".btn--pdf");
        btn.setAttribute("aria-label", `Descargar PDF de ${nombreEquipo(e)} categoría ${e.categoria}`);
        btn.addEventListener("click", () => descargarPDF(e.id, btn));

        const ul = art.querySelector(".jugadores");
        for (const j of e.jugadores) {
          const foto = el("div", { class: "foto" });
          if (j.foto) {
            const img = el("img", { src: j.foto, alt: `Foto de ${j.nombre}`, loading: "lazy", decoding: "async" });
            img.addEventListener("error", () => {
              foto.replaceChildren(el("span", { class: "foto__ini", text: iniciales(j.nombre) }));
            }, { once: true });
            foto.append(img);
          } else {
            foto.classList.add("foto--sin");
            foto.append(el("span", { class: "foto__ini", text: iniciales(j.nombre), "aria-hidden": "true" }));
          }
          ul.append(el("li", { class: "jugador" }, foto, el("p", { class: "jugador__nombre", text: j.nombre })));
        }
        sec.append(art);
      }
      frag.append(sec);
    }
    $("#contenido").replaceChildren(frag);
  }

  // ---------- PDF ----------
  class FotoCaducada extends Error {}

  function cargarImagen(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("imagen"));
      img.src = src;
    });
  }

  // Descarga la foto (mismo dominio) y la recorta a 4:5 como JPEG.
  async function fotoDataURL(url, reintentable) {
    const r = await fetch(url);
    if (r.status === 410 && reintentable) throw new FotoCaducada();
    if (!r.ok) return null;
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    try {
      const img = await cargarImagen(obj);
      const W = 400, H = 500;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      const escala = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * escala, h = img.naturalHeight * escala;
      // Recorte centrado, ligeramente cargado hacia arriba (caras).
      ctx.drawImage(img, (W - w) / 2, Math.min(0, (H - h) * 0.3), w, h);
      return c.toDataURL("image/jpeg", 0.85);
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(obj);
    }
  }

  async function mapLimit(items, limite, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    });
    await Promise.all(workers);
    return out;
  }

  async function descargarPDF(equipoId, btn) {
    if (!window.jspdf) { toast("El generador de PDF no cargó. Recarga la página."); return; }
    const etiqueta = btn.querySelector("span");
    const textoOriginal = etiqueta.textContent;
    btn.disabled = true;
    try {
      let equipo = datos.equipos.find((e) => e.id === equipoId);
      let fotos;
      for (let intento = 0; intento < 2; intento++) {
        try {
          let hechas = 0;
          etiqueta.textContent = "Preparando fotos…";
          fotos = await mapLimit(equipo.jugadores, 6, async (j) => {
            const d = j.foto ? await fotoDataURL(j.foto, intento === 0) : null;
            hechas++;
            etiqueta.textContent = `Fotos ${hechas}/${equipo.jugadores.length}`;
            return d;
          });
          break;
        } catch (err) {
          if (!(err instanceof FotoCaducada) || intento > 0) throw err;
          // Los enlaces de Airtable caducan: pedir datos frescos y reintentar.
          etiqueta.textContent = "Actualizando datos…";
          datos = await cargar(true);
          equipo = datos.equipos.find((e) => e.id === equipoId);
          if (!equipo) throw new Error("El equipo ya no existe.");
        }
      }
      etiqueta.textContent = "Generando PDF…";
      await new Promise((r) => setTimeout(r, 30));
      const doc = construirPDF(datos.colegio, equipo, fotos);
      const nombre = `Ficha - ${datos.colegio} - ${equipo.deporte} ${equipo.rama} ${equipo.categoria}.pdf`
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // sin tildes: evita nombres "download" en algunos navegadores
        .replace(/[^\x20-\x7E]/g, "")
        .replace(/[\\/:*?"<>|]+/g, "-");
      guardarArchivo(doc.output("blob"), nombre);
      toast("PDF descargado");
    } catch (err) {
      console.error(err);
      toast("No se pudo generar el PDF. Intenta de nuevo.");
    } finally {
      etiqueta.textContent = textoOriginal;
      btn.disabled = false;
    }
  }

  function guardarArchivo(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function construirPDF(colegio, equipo, fotos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const PW = 210, PH = 297, M = 12;
    const COLS = 5, GAP_X = 5;
    const cw = (PW - 2 * M - GAP_X * (COLS - 1)) / COLS; // ~33.2 mm
    const ph = cw * 1.25; // foto 4:5
    const cellH = ph + 11;
    const color = COLORES_PDF[equipo.deporte] || [107, 114, 128];
    const fecha = new Date().toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" });

    function encabezadoCompleto() {
      doc.setFillColor(...AZUL);
      doc.rect(0, 0, PW, 24, "F");
      doc.setFillColor(...color);
      doc.rect(0, 24, PW, 1.6, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("LA LIGA ESTUDIANTIL", M, 11);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Ficha de inscripción de equipo", M, 17.5);

      doc.setTextColor(18, 24, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      const tituloLineas = doc.splitTextToSize(colegio, PW - 2 * M).slice(0, 2);
      doc.text(tituloLineas, M, 36);
      let y = 36 + (tituloLineas.length - 1) * 7;

      y += 8;
      doc.setFontSize(12);
      doc.setTextColor(...color);
      doc.text(`${equipo.deporte} ${equipo.rama}`, M, y);
      const anchoDep = doc.getTextWidth(`${equipo.deporte} ${equipo.rama}`);
      doc.setTextColor(18, 24, 38);
      doc.setFont("helvetica", "normal");
      doc.text(`  ·  Categoría ${equipo.categoria}  ·  ${equipo.jugadores.length} ${equipo.jugadores.length === 1 ? "jugador" : "jugadores"}`, M + anchoDep, y);

      y += 4;
      doc.setDrawColor(221, 226, 234);
      doc.setLineWidth(0.3);
      doc.line(M, y, PW - M, y);
      return y + 5;
    }

    function encabezadoCorto() {
      doc.setFillColor(...AZUL);
      doc.rect(0, 0, PW, 12, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      const t = `${colegio}  ·  ${equipo.deporte} ${equipo.rama}  ·  Categoría ${equipo.categoria}`;
      doc.text(doc.splitTextToSize(t, PW - 2 * M)[0], M, 7.8);
      return 18;
    }

    const pieY = PH - 8;
    let y = encabezadoCompleto();
    let col = 0;

    equipo.jugadores.forEach((j, i) => {
      if (col === 0 && y + cellH > pieY - 4) {
        doc.addPage();
        y = encabezadoCorto();
      }
      const x = M + col * (cw + GAP_X);
      const dataUrl = fotos[i];
      if (dataUrl) {
        doc.addImage(dataUrl, "JPEG", x, y, cw, ph, undefined, "FAST");
      } else {
        doc.setFillColor(238, 241, 246);
        doc.rect(x, y, cw, ph, "F");
        doc.setTextColor(140, 148, 160);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.text(iniciales(j.nombre) || "?", x + cw / 2, y + ph / 2 + 2, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text("Sin foto", x + cw / 2, y + ph - 3, { align: "center" });
      }
      doc.setDrawColor(210, 216, 226);
      doc.setLineWidth(0.25);
      doc.rect(x, y, cw, ph);

      doc.setTextColor(18, 24, 38);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      let lineas = doc.splitTextToSize(j.nombre, cw);
      if (lineas.length > 2) {
        lineas = lineas.slice(0, 2);
        let l = lineas[1];
        while (l.length > 1 && doc.getTextWidth(l + "...") > cw) l = l.slice(0, -1);
        lineas[1] = l + "...";
      }
      doc.text(lineas, x + cw / 2, y + ph + 3.8, { align: "center", lineHeightFactor: 1.15 });

      col++;
      if (col === COLS) { col = 0; y += cellH; }
    });

    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 128, 140);
      doc.text(`Generado el ${fecha}`, M, pieY);
      doc.text(`Página ${p} de ${total}`, PW - M, pieY, { align: "right" });
    }
    return doc;
  }

  // ---------- Inicio ----------
  async function iniciar() {
    if (!school) {
      $("#titulo").textContent = "Enlace incompleto";
      mostrarEstado("Falta el colegio en el enlace", "Usa el enlace personal que te envió la organización de La Liga Estudiantil.");
      return;
    }
    try {
      datos = await cargar();
      render();
    } catch (err) {
      $("#titulo").textContent = err.status === 404 ? "Colegio no encontrado" : "No se pudo cargar";
      mostrarEstado(
        err.status === 404 ? "No encontramos ese colegio" : "Hubo un problema al cargar los equipos",
        err.status === 404 ? "Revisa que el enlace esté completo o pide uno nuevo a la organización." : `${err.message} Intenta recargar la página.`
      );
    }
  }

  iniciar();
})();
