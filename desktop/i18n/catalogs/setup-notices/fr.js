// Setup failure display copy; tagged diagnostics keep canonical English and private values outside serialized payloads.
export default {
  "openaiRejected": "Cette clé a été refusée. Copiez-la à nouveau depuis platform.openai.com → API keys.",
  "anthropicRejected": "Cette clé a été refusée. Copiez-la à nouveau depuis console.anthropic.com.",
  "badCharacter": "Le caractère {position} (« {char} », {code}) ne peut pas faire partie d’une clé : il ressemble à une lettre provenant d’une autre disposition de clavier ou d’un éditeur de texte. Copiez à nouveau la clé avec son bouton de copie et collez-la ici.",
  "freeStartFailed": "Free AI n’a pas pu démarrer pour le moment. Vérifiez votre connexion et réessayez.",
  "freeNotRegular": "Cette installation n’est pas standard ; Free AI n’est donc pas sollicité.",
  "notionTimeout": "Notion n’a pas répondu en 5 minutes. Réessayez ou utilisez « Un problème ? Utiliser un jeton à la place » ci-dessous.",
  "notionMissingToken": "Notion n’a pas envoyé de jeton. Réessayez.",
  "browserOpenFailed": "Impossible d’ouvrir votre navigateur."
};
