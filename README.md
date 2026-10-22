# CORTE

Editor de video en el navegador: sube tus clips, ordénalos, agrega texto y exporta **sin marca de agua**.

## Cómo usarlo

```bash
npm install
npm run dev
```

Abre la URL de Vite, sube videos que te pertenezcan, edita en la timeline y pulsa **Descargar sin marca**.

## Qué incluye (MVP)

- Subida múltiple / drag & drop
- Timeline: ordenar, recortar, borrar
- Overlay de texto
- Formatos 9:16, 16:9 y 1:1
- Exportación local a WebM (sin watermark)

## Notas

- El render ocurre en tu navegador (MediaRecorder + canvas).
- El audio de los clips aún no se mezcla en la exportación (preview silenciado).
- No descarga ni quita marcas de agua de TikTok u otras plataformas.
