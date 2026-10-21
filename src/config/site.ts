/**
 * Configuración del sitio. Todo se define por variables de entorno (ver .env.example);
 * sin ellas, el sitio compila igual pero sin URLs absolutas, anuncios ni correo de contacto.
 */
export const siteName = 'DevTools';

/** Anuncios desactivados salvo que se active explícitamente. */
export const adsEnabled = import.meta.env.PUBLIC_ADS_ENABLED === 'true';

/** Correo de contacto público; vacío si no se ha configurado. */
export const contactEmail: string = import.meta.env.PUBLIC_CONTACT_EMAIL ?? '';
