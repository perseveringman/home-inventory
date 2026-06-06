import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type {
  SpeechRecognitionErrorEvent,
  SpeechRecognitionListeningEvent,
  SpeechRecognitionPartialResultEvent,
} from '@capgo/capacitor-speech-recognition';

export interface NativeSpeechSession {
  stop: () => Promise<void>;
  abort: () => Promise<void>;
}

interface StartNativeSpeechOptions {
  language?: string;
  contextualStrings?: string[];
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onEnd: (text: string) => void;
}

export function isNativeSpeechPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

async function loadSpeechRecognition() {
  return import('@capgo/capacitor-speech-recognition');
}

export async function isNativeSpeechAvailable(): Promise<boolean> {
  if (!isNativeSpeechPlatform()) return false;
  try {
    const { SpeechRecognition } = await loadSpeechRecognition();
    const { available } = await SpeechRecognition.available();
    return available;
  } catch {
    return false;
  }
}

export async function startNativeSpeechRecognition({
  language = 'zh-CN',
  contextualStrings = [],
  onTranscript,
  onError,
  onEnd,
}: StartNativeSpeechOptions): Promise<NativeSpeechSession> {
  if (!isNativeSpeechPlatform()) throw new Error('当前环境不支持原生语音识别');

  const { SpeechRecognition } = await loadSpeechRecognition();
  const permissions = await SpeechRecognition.requestPermissions();
  if (permissions.speechRecognition !== 'granted') {
    throw new Error('请允许麦克风和语音识别权限');
  }

  const { available } = await SpeechRecognition.available();
  if (!available) throw new Error('当前设备不支持语音识别');

  const handles: PluginListenerHandle[] = [];
  let latestText = '';
  let finished = false;

  const cleanup = async () => {
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
    handles.length = 0;
  };

  const readLastText = async () => {
    try {
      const last = await SpeechRecognition.getLastPartialResult();
      return (last.text || last.matches?.[0] || '').trim();
    } catch {
      return '';
    }
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    const finalText = (await readLastText()) || latestText;
    await cleanup();
    onEnd(finalText.trim());
  };

  handles.push(
    await SpeechRecognition.addListener('partialResults', (event: SpeechRecognitionPartialResultEvent) => {
      const next = (event.accumulatedText || event.accumulated || event.matches?.[0] || '').trim();
      if (!next) return;
      latestText = next;
      onTranscript(next);
    })
  );
  handles.push(
    await SpeechRecognition.addListener('listeningState', (event: SpeechRecognitionListeningEvent) => {
      if (event.state === 'stopped' || event.status === 'stopped') void finish();
    })
  );
  handles.push(
    await SpeechRecognition.addListener('error', (event: SpeechRecognitionErrorEvent) => {
      onError(event.message || event.code || '语音识别失败');
      void finish();
    })
  );

  try {
    const initial = await SpeechRecognition.start({
      language,
      maxResults: 3,
      partialResults: true,
      addPunctuation: true,
      contextualStrings,
    });
    const firstText = (initial.matches?.[0] || '').trim();
    if (firstText) {
      latestText = firstText;
      onTranscript(firstText);
    }
  } catch (err) {
    await cleanup();
    throw err;
  }

  return {
    stop: async () => {
      try {
        await SpeechRecognition.stop();
      } catch {
        await SpeechRecognition.forceStop({ timeout: 1500 }).catch(() => undefined);
      }
      await finish();
    },
    abort: async () => {
      finished = true;
      await SpeechRecognition.forceStop({ timeout: 500 }).catch(() => undefined);
      await cleanup();
    },
  };
}
