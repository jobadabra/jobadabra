// Setup failure display copy; tagged diagnostics keep canonical English and private values outside serialized payloads.
export default {
  "openaiRejected": "Dieser Schlüssel wurde abgelehnt. Kopieren Sie ihn erneut unter platform.openai.com → API keys.",
  "anthropicRejected": "Dieser Schlüssel wurde abgelehnt. Kopieren Sie ihn erneut von console.anthropic.com.",
  "badCharacter": "Zeichen {position} (\"{char}\", {code}) kann nicht Teil eines Schlüssels sein: Es sieht wie ein Buchstabe aus einer anderen Tastaturbelegung oder einem Texteditor aus. Kopieren Sie den Schlüssel erneut mit seiner Kopierschaltfläche und fügen Sie ihn hier ein.",
  "freeStartFailed": "Free AI konnte gerade nicht gestartet werden. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
  "freeNotRegular": "Dies ist keine reguläre Installation, daher wird Free AI nicht angefragt.",
  "notionTimeout": "Notion hat innerhalb von 5 Minuten nicht geantwortet. Versuchen Sie es erneut oder nutzen Sie unten „Probleme? Stattdessen ein Token verwenden“.",
  "notionMissingToken": "Notion hat kein Token gesendet. Versuchen Sie es erneut.",
  "browserOpenFailed": "Dein Browser konnte nicht geöffnet werden."
};
