import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  getConfig,
  setApiAuthToken,
  setApiBase,
  setUserApiKey,
  type AiProvider,
} from '@home-inventory/core';
import './styles/index.css';
import App from './App';
import { getStorage, initStore } from './stores/useStore';

const DEFAULT_NATIVE_API_BASE_URL = 'https://home-inventory-seven-ashy.vercel.app';

// 注入 API host：
// - 浏览器同源部署时留空，走相对路径（Vite dev / Vercel functions）。
// - Capacitor iOS/Android 等原生壳没有同源后端，
//   通过 VITE_API_BASE_URL 指向独立部署的 API（例如腾讯云轻量服）。
setApiBase(
  import.meta.env.VITE_API_BASE_URL ||
    (Capacitor.isNativePlatform() ? DEFAULT_NATIVE_API_BASE_URL : '')
);
// 独立后端启用了 AI_PROXY_TOKEN 时，把同样的值打进 bundle，
// 调用 /api/ai/* 时自动带 Authorization: Bearer <token>。
// 注意：这个 token 会随前端代码分发，不能当作"私密凭证"，
// 仅作为防扫描的最小屏障；防滥用还需配合 ALLOWED_ORIGINS / 限流。
setApiAuthToken(import.meta.env.VITE_API_PROXY_TOKEN);

const USER_KEY_CONFIG_KEYS: Record<AiProvider, string> = {
  minimax: 'userApiKey_minimax',
  doubao: 'userApiKey_doubao',
  openrouter: 'userApiKey_openrouter',
  deepseek: 'userApiKey_deepseek',
  claude: 'userApiKey_claude',
};

async function loadUserApiKeys() {
  const storage = getStorage();
  for (const provider of Object.keys(USER_KEY_CONFIG_KEYS) as AiProvider[]) {
    const key = await getConfig<string>(storage, USER_KEY_CONFIG_KEYS[provider], '');
    if (key) setUserApiKey(provider, key);
  }
}

async function bootstrap() {
  await initStore();
  await loadUserApiKeys();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

bootstrap();
