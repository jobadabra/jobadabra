// Counted page nouns use native plural forms; numbers are supplied already formatted.
const rows = {
  "form": ["form~forms", "Formular~Formulare", "formulaire~formulaires", "modulo~moduli", "formulario~formularios", "formular~formulare~de formulare", "форма~формы~форм~формы"],
  "job": ["job~jobs", "Stelle~Stellen", "offre~offres", "offerta~offerte", "empleo~empleos", "job~joburi~de joburi", "вакансия~вакансии~вакансий~вакансии"],
  "site": ["site~sites", "Website~Websites", "site~sites", "sito~siti", "sitio~sitios", "site~site-uri~de site-uri", "сайт~сайта~сайтов~сайта"],
  "report": ["report~reports", "Bericht~Berichte", "rapport~rapports", "rapporto~rapporti", "informe~informes", "raport~rapoarte~de rapoarte", "отчёт~отчёта~отчётов~отчёта"],
  "detail": ["detail~details", "Detail~Details", "détail~détails", "dettaglio~dettagli", "detalle~detalles", "detaliu~detalii~de detalii", "подробность~подробности~подробностей~подробности"],
  "job role": ["job role~job roles", "Berufsrolle~Berufsrollen", "poste~postes", "ruolo~ruoli", "puesto~puestos", "rol~roluri~de roluri", "должность~должности~должностей~должности"],
  "role": ["role~roles", "Rolle~Rollen", "poste~postes", "ruolo~ruoli", "puesto~puestos", "rol~roluri~de roluri", "должность~должности~должностей~должности"],
  "version": ["version~versions", "Version~Versionen", "version~versions", "versione~versioni", "versión~versiones", "versiune~versiuni~de versiuni", "версия~версии~версий~версии"],
  "more detail": ["more detail~more details", "weiteres Detail~weitere Details", "détail supplémentaire~détails supplémentaires", "dettaglio in più~dettagli in più", "detalle adicional~detalles adicionales", "detaliu în plus~detalii în plus~de detalii în plus", "дополнительная подробность~дополнительные подробности~дополнительных подробностей~дополнительной подробности"],
  "line": ["line~lines", "Zeile~Zeilen", "ligne~lignes", "riga~righe", "línea~líneas", "rând~rânduri~de rânduri", "строка~строки~строк~строки"],
  "email": ["email~emails", "E-Mail~E-Mails", "e-mail~e-mails", "email ricevuta~email ricevute", "correo~correos", "e-mail~e-mailuri~de e-mailuri", "письмо~письма~писем~письма"],
  "application update": ["application update~application updates", "Bewerbungsaktualisierung~Bewerbungsaktualisierungen", "mise à jour de candidature~mises à jour de candidature", "aggiornamento candidatura~aggiornamenti candidatura", "actualización de solicitud~actualizaciones de solicitud", "actualizare de candidatură~actualizări de candidatură~de actualizări de candidatură", "обновление отклика~обновления отклика~обновлений откликов~обновления отклика"],
  "new job": ["new job~new jobs", "neue Stelle~neue Stellen", "nouvelle offre~nouvelles offres", "nuova offerta~nuove offerte", "nuevo empleo~nuevos empleos", "job nou~joburi noi~de joburi noi", "новая вакансия~новые вакансии~новых вакансий~новой вакансии"],
  "new bullet": ["new bullet~new bullets", "neuer Punkt~neue Punkte", "nouveau point~nouveaux points", "nuovo punto~nuovi punti", "nuevo punto~nuevos puntos", "punct nou~puncte noi~de puncte noi", "новый пункт~новых пункта~новых пунктов~нового пункта"],
  "skill": ["skill~skills", "Fähigkeit~Fähigkeiten", "compétence~compétences", "competenza~competenze", "habilidad~habilidades", "competență~competențe~de competențe", "навык~навыка~навыков~навыка"],
  "language": ["language~languages", "Sprache~Sprachen", "langue~langues", "lingua~lingue", "idioma~idiomas", "limbă~limbi~de limbi", "язык~языка~языков~языка"],
  "school": ["school~schools", "Bildungseinrichtung~Bildungseinrichtungen", "établissement~établissements", "istituto~istituti", "centro educativo~centros educativos", "instituție~instituții~de instituții", "учебное заведение~учебных заведения~учебных заведений~учебного заведения"],
  "row": ["row~rows", "Zeile~Zeilen", "ligne~lignes", "riga~righe", "fila~filas", "rând~rânduri~de rânduri", "строка~строки~строк~строки"],
  "position": ["position~positions", "Position~Positionen", "poste~postes", "posizione~posizioni", "puesto~puestos", "poziție~poziții~de poziții", "должность~должности~должностей~должности"],
  "detail line": ["detail line~detail lines", "Detailzeile~Detailzeilen", "ligne de détail~lignes de détail", "riga di dettaglio~righe di dettaglio", "línea de detalle~líneas de detalle", "rând de detalii~rânduri de detalii~de rânduri de detalii", "строка данных~строки данных~строк данных~строки данных"],
  "CV": ["CV~CVs", "Lebenslauf~Lebensläufe", "CV adapté~CV adaptés", "CV adattato~CV adattati", "CV adaptado~CV adaptados", "CV~CV-uri~de CV-uri", "резюме~резюме~резюме~резюме"],
  "application": ["application~applications", "Bewerbung~Bewerbungen", "candidature~candidatures", "candidatura~candidature", "solicitud~solicitudes", "candidatură~candidaturi~de candidaturi", "отклик~отклика~откликов~отклика"],
};
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const categories = locale => locale === 'ru' ? ['one', 'few', 'many', 'other'] : locale === 'ro' ? ['one', 'few', 'other'] : ['one', 'other'];
export const messages = Object.fromEntries(locales.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([key, translations]) => [key.replaceAll(' ', '_'), Object.fromEntries(translations[index].split('~').map((word, form) => [categories(locale)[form], `{shown} ${word}`]))]))]));
