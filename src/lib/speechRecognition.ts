/** Minimal typings for Web Speech API (Chromium). */
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionEventLike = {
  results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }>;
};

type SRConstructor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SRConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionAvailable(): boolean {
  return getSpeechRecognitionCtor() != null;
}
