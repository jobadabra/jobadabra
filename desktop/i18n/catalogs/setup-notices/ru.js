// Setup failure display copy; tagged diagnostics keep canonical English and private values outside serialized payloads.
export default {
  "openaiRejected": "Этот ключ отклонён. Скопируйте его заново на platform.openai.com → API keys.",
  "anthropicRejected": "Этот ключ отклонён. Скопируйте его заново на console.anthropic.com.",
  "badCharacter": "Символ {position} («{char}», {code}) не может быть частью ключа: похоже, это буква из другой раскладки клавиатуры или текстового редактора. Скопируйте ключ заново кнопкой копирования и вставьте его сюда.",
  "freeStartFailed": "Не удалось запустить Free AI. Проверьте подключение и повторите попытку.",
  "freeNotRegular": "Это нестандартная установка, поэтому запрос к Free AI не выполняется.",
  "notionTimeout": "Notion не ответил за 5 минут. Повторите попытку или выберите ниже «Не получается? Использовать токен».",
  "notionMissingToken": "Notion не отправил токен. Повторите попытку."
};
