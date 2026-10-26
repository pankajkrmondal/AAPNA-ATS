/**
 * Frontend feature switches, read from the Vite env files (.env.<mode>).
 *
 * FORMS_LINKS_ENABLED (L08): shows the "Forms & Links" menu item and its
 * shortcuts (drawer, MRF details, Ctrl+K, Dashboard). Off unless the env file
 * says true: the new menu slot waits for Chhaya's sign-off (HR set the menu
 * order on 10 Sep). The page itself is always reachable at /forms-links.
 */
export const FORMS_LINKS_ENABLED = String(import.meta.env.VITE_FORMS_LINKS_ENABLED || '').toLowerCase() === 'true';

export default { FORMS_LINKS_ENABLED };
