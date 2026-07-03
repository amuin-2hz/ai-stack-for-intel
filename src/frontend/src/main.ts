import { createApp } from "vue";
import App from "./App.vue";
import Antd from "ant-design-vue";
import "ant-design-vue/dist/reset.css";
import "./styles/tokens.css";
import "./styles.css";
import "./styles/chat.css";
import "./styles/engine-dashboard.css";
import "./styles/models.css";
import router from "./router";

// 声明 Electron API 类型
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getAppVersion: () => Promise<string>;
      platform: string;
    };
  }
}

const app = createApp(App);
app.use(Antd);
app.use(router);
app.mount("#app");
