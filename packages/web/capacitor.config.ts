import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zhouyanbo.homeinventory',
  appName: '家居收纳',
  webDir: 'dist',
  // 与 web 的 paper 主色一致，避免状态栏 / home indicator 区域露出 WebView 黑底
  backgroundColor: '#f4ede1',
  // 默认不开启自动 https，避免本地构建踩到证书问题
  ios: {
    // 让 WebView 铺满整个屏幕（包括安全区下方），web 端用 env(safe-area-inset-*) 自行处理
    // 用 'always' 会让 iOS 在顶部/底部多留一道空白，叠加 web 的 safe-area padding 后会出现双重留白
    contentInset: 'never',
    backgroundColor: '#f4ede1',
    // 允许 WebView 加载所需资源（如远程图片）
    limitsNavigationsToAppBoundDomains: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#f4ede1',
      showSpinner: false,
    },
  },
};

export default config;
