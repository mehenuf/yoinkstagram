import '@fontsource-variable/dm-sans';
import '@fontsource/anton/latin-400.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import viceCityHero from './assets/gta6-hero.webp';
import viceCityWaterfront from './assets/gta6-backdrop.webp';
import './styles.css';
import './vice-city.css';

createRoot(document.getElementById('root')!).render(<App />);

// Warm the locally bundled theme assets before the first switch.
void document.fonts.load('400 24px Anton').catch(() => {});
for (const src of [viceCityHero, viceCityWaterfront]) {
  const image = new Image();
  image.src = src;
  void image.decode().catch(() => {});
}
