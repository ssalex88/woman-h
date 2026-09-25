/** Adaptador del reconocimiento real del navegador. No contiene transcripciones simuladas. */
export type SpeechResult = { isFinal: boolean; 0: {transcript: string}; length: number }
export type SpeechResultEvent = { results: ArrayLike<SpeechResult> }
export interface SpeechSession {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: {error: string}) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechConstructor = new () => SpeechSession

export function browserSpeech(): SpeechConstructor | undefined {
  if (window.isSecureContext === false) return undefined
  const browser = window as unknown as {SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor}
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition
}

export const speechErrors: Record<string, string> = {
  'not-allowed': 'No se permitió el micrófono. Puedes habilitarlo en los permisos del navegador o seguir escribiendo.',
  'service-not-allowed': 'El navegador no permite el servicio de voz. Puedes seguir escribiendo.',
  'audio-capture': 'No pudimos acceder al micrófono. Comprueba que esté conectado y no lo esté usando otra aplicación.',
  'network': 'No pudimos conectar con el servicio de voz del navegador. Tu texto sigue aquí; puedes escribir.',
  'no-speech': 'No se detectó voz. Puedes volver a intentar o escribir.',
  'language-not-supported': 'Este navegador no admite el reconocimiento en español. Puedes escribir.',
  'aborted': 'Se interrumpió la captura de voz. El texto obtenido sigue disponible para revisar.',
}
