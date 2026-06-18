import { defineConfig } from 'astro/config';

// App 100% estática servida por Firebase Hosting.
// Los componentes interactivos son Web Components (Lit) cargados en cliente,
// por lo que no se necesita ninguna integración de framework para SSR.
export default defineConfig({
  output: 'static',
  site: 'https://el-juego-kanban.web.app',
  devToolbar: { enabled: false },
});
