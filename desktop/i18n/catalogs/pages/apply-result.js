// The Apply to jobs dialog's result after a batch ([ad] try 3): each job's one status chip, the counts line and the next step, in every language.
export const messages = {
  en: {
    job: 'Job', started: 'Started', ready: 'Ready', notEligible: 'Not eligible', failed: 'Could not prepare', notStarted: 'Not started', alreadyOpen: 'Already open', alreadyQueued: 'Already queued', skipped: 'Skipped',
    startedCount: '{count} started', readyCount: '{count} ready', skippedCount: '{count} skipped', failedCount: {one: '{count} could not be prepared', other: '{count} could not be prepared'},
    sessionsHint: 'Follow them in Sessions.',
  },
  de: {
    job: 'Stelle', started: 'Gestartet', ready: 'Bereit', notEligible: 'Nicht geeignet', failed: 'Nicht vorbereitet', notStarted: 'Nicht gestartet', alreadyOpen: 'Schon offen', alreadyQueued: 'Schon eingereiht', skipped: 'Übersprungen',
    startedCount: '{count} gestartet', readyCount: '{count} bereit', skippedCount: '{count} übersprungen', failedCount: {one: '{count} nicht vorbereitet', other: '{count} nicht vorbereitet'},
    sessionsHint: 'Verfolge sie unter Sitzungen.',
  },
  fr: {
    job: 'Offre', started: 'Démarrée', ready: 'Prête', notEligible: 'Non éligible', failed: 'Préparation impossible', notStarted: 'Non démarrée', alreadyOpen: 'Déjà ouverte', alreadyQueued: 'Déjà en file', skipped: 'Ignorée',
    startedCount: {one: '{count} démarrée', many: '{count} démarrées', other: '{count} démarrées'}, readyCount: {one: '{count} prête', many: '{count} prêtes', other: '{count} prêtes'},
    skippedCount: {one: '{count} ignorée', many: '{count} ignorées', other: '{count} ignorées'}, failedCount: {one: '{count} n’a pas pu être préparée', many: '{count} n’ont pas pu être préparées', other: '{count} n’ont pas pu être préparées'},
    sessionsHint: 'Suivez-les dans Sessions.',
  },
  it: {
    job: 'Offerta', started: 'Avviata', ready: 'Pronta', notEligible: 'Non idonea', failed: 'Preparazione non riuscita', notStarted: 'Non avviata', alreadyOpen: 'Già aperta', alreadyQueued: 'Già in coda', skipped: 'Saltata',
    startedCount: {one: '{count} avviata', many: '{count} avviate', other: '{count} avviate'}, readyCount: {one: '{count} pronta', many: '{count} pronte', other: '{count} pronte'},
    skippedCount: {one: '{count} saltata', many: '{count} saltate', other: '{count} saltate'}, failedCount: {one: '{count} non preparata', many: '{count} non preparate', other: '{count} non preparate'},
    sessionsHint: 'Seguile in Sessioni.',
  },
  es: {
    job: 'Oferta', started: 'Iniciada', ready: 'Lista', notEligible: 'No apta', failed: 'No se pudo preparar', notStarted: 'No iniciada', alreadyOpen: 'Ya abierta', alreadyQueued: 'Ya en cola', skipped: 'Omitida',
    startedCount: {one: '{count} iniciada', many: '{count} iniciadas', other: '{count} iniciadas'}, readyCount: {one: '{count} lista', many: '{count} listas', other: '{count} listas'},
    skippedCount: {one: '{count} omitida', many: '{count} omitidas', other: '{count} omitidas'}, failedCount: {one: '{count} no se pudo preparar', many: '{count} no se pudieron preparar', other: '{count} no se pudieron preparar'},
    sessionsHint: 'Síguelas en Sesiones.',
  },
  ro: {
    job: 'Job', started: 'Pornită', ready: 'Pregătită', notEligible: 'Neeligibil', failed: 'Nu s-a putut pregăti', notStarted: 'Nepornită', alreadyOpen: 'Deja deschisă', alreadyQueued: 'Deja în coadă', skipped: 'Omisă',
    startedCount: {one: '{count} pornită', few: '{count} pornite', other: '{count} pornite'}, readyCount: {one: '{count} pregătită', few: '{count} pregătite', other: '{count} pregătite'},
    skippedCount: {one: '{count} omisă', few: '{count} omise', other: '{count} omise'}, failedCount: {one: '{count} nu s-a putut pregăti', few: '{count} nu s-au putut pregăti', other: '{count} nu s-au putut pregăti'},
    sessionsHint: 'Urmărește-le în Sesiuni.',
  },
  ru: {
    job: 'Вакансия', started: 'Запущена', ready: 'Готова', notEligible: 'Не подходит', failed: 'Не удалось подготовить', notStarted: 'Не запущена', alreadyOpen: 'Уже открыта', alreadyQueued: 'Уже в очереди', skipped: 'Пропущена',
    startedCount: {one: 'Запущена: {count}', few: 'Запущено: {count}', many: 'Запущено: {count}', other: 'Запущено: {count}'}, readyCount: {one: 'Готова: {count}', few: 'Готово: {count}', many: 'Готово: {count}', other: 'Готово: {count}'},
    skippedCount: {one: 'Пропущена: {count}', few: 'Пропущено: {count}', many: 'Пропущено: {count}', other: 'Пропущено: {count}'}, failedCount: {one: 'Не подготовлена: {count}', few: 'Не подготовлено: {count}', many: 'Не подготовлено: {count}', other: 'Не подготовлено: {count}'},
    sessionsHint: 'Следите за ними в разделе «Сессии».',
  },
};
