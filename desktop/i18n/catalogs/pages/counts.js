// Counted page messages use each display language's plural categories and named values.
export const messages = {
  en: {
    board: {one: '{count} application on the board', other: '{count} applications on the board'},
    sent: {one: 'Sent {count} job', other: 'Sent {count} jobs'},
    filled: 'Filled {count}', filling: 'Filling {current} of {total}',
    menuStep: '{current} of {total}',
  },
  de: {
    board: {one: '{count} Bewerbung auf dem Board', other: '{count} Bewerbungen auf dem Board'},
    sent: {one: '{count} Stelle gesendet', other: '{count} Stellen gesendet'},
    filled: '{count} ausgefüllt', filling: '{current} von {total} wird ausgefüllt',
    menuStep: '{current} von {total}',
  },
  fr: {
    board: {"one":"{count} candidature sur le tableau","other":"{count} candidatures sur le tableau","many":"{count} candidatures sur le tableau"},
    sent: {"one":"{count} offre envoyée","other":"{count} offres envoyées","many":"{count} offres envoyées"},
    filled: '{count} remplis', filling: 'Remplissage : {current} sur {total}',
    menuStep: '{current} sur {total}',
  },
  it: {
    board: {"one":"{count} candidatura sulla bacheca","other":"{count} candidature sulla bacheca","many":"{count} candidature sulla bacheca"},
    sent: {"one":"{count} offerta inviata","other":"{count} offerte inviate","many":"{count} offerte inviate"},
    filled: '{count} compilati', filling: 'Compilazione: {current} di {total}',
    menuStep: '{current} di {total}',
  },
  es: {
    board: {"one":"{count} solicitud en el tablero","other":"{count} solicitudes en el tablero","many":"{count} solicitudes en el tablero"},
    sent: {"one":"{count} empleo enviado","other":"{count} empleos enviados","many":"{count} empleos enviados"},
    filled: '{count} rellenados', filling: 'Rellenando {current} de {total}',
    menuStep: '{current} de {total}',
  },
  ro: {
    board: {one: '{count} candidatură pe panou', few: '{count} candidaturi pe panou', other: '{count} de candidaturi pe panou'},
    sent: {one: '{count} job trimis', few: '{count} joburi trimise', other: '{count} de joburi trimise'},
    filled: '{count} completate', filling: 'Se completează {current} din {total}',
    menuStep: '{current} din {total}',
  },
  ru: {
    board: {one: '{count} отклик на доске', few: '{count} отклика на доске', many: '{count} откликов на доске', other: '{count} отклика на доске'},
    sent: {one: 'Отправлена {count} вакансия', few: 'Отправлены {count} вакансии', many: 'Отправлено {count} вакансий', other: 'Отправлено {count} вакансии'},
    filled: 'Заполнено: {count}', filling: 'Заполняется {current} из {total}',
    menuStep: '{current} из {total}',
  },
};
