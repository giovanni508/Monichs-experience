import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import './styles/main.css';
import { App } from './core/App.js';

const app = new App();
app.boot().catch((err) => {
  // In fiera non mostriamo errori a schermo: li registriamo in console e riproviamo dopo poco
  console.error('[Inside Monichs] errore di avvio', err);
  setTimeout(() => location.reload(), 8000);
});
