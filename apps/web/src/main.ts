import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { i18n } from "./i18n";
import { router } from "./router";
import "element-plus/dist/index.css";
import "./styles/main.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(i18n);
/* Element Plus 组件文案随 App.vue 里的 ElConfigProvider 切换；这里给默认值 */
app.use(ElementPlus, { locale: zhCn });
app.mount("#app");
