// Reusable dynamic page labels in all seven supported display languages.
const locales = ["en","de","fr","it","es","ro","ru"];
const rows = {
  toSend: ["To send: {answer}","Zu senden: {answer}","À envoyer : {answer}","Da inviare: {answer}","Para enviar: {answer}","De trimis: {answer}","К отправке: {answer}"],
  agreed: ["Agreed: {answer}","Zugestimmt: {answer}","Accepté : {answer}","Concordato: {answer}","Acordado: {answer}","Acceptat: {answer}","Согласовано: {answer}"],
  filled: ["Filled in the form: {answer}","Im Formular ausgefüllt: {answer}","Rempli dans le formulaire : {answer}","Compilato nel modulo: {answer}","Rellenado en formulario: {answer}","Completat în formular: {answer}","Заполнено в форме: {answer}"],
};

export const messages = Object.fromEntries(locales.map((locale, index) => [locale, Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]]))]));
