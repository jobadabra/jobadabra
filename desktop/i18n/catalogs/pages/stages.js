// Display names for application stages; persisted stage identifiers never change.
const rows = {
  confirmation: ['Confirmation received','Bestätigung erhalten','Confirmation reçue','Conferma ricevuta','Confirmación recibida','Confirmare primită','Подтверждение получено'],
  interviewing: ['Interviewing','In Gesprächen','Entretiens en cours','Colloqui in corso','En entrevistas','În interviuri','Прохождение собеседований'],
  noResponse: ['No response','Keine Antwort','Sans réponse','Nessuna risposta','Sin respuesta','Fără răspuns','Нет ответа'],
  withdrawn: ['Withdrawn','Zurückgezogen','Retiré','Ritirato','Retirado','Retras','Отозвано'],
};
export const messages = Object.fromEntries(['en','de','fr','it','es','ro','ru'].map((locale, index) => [locale,
  Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]]))]));
