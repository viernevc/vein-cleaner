import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import './styles/index.scss'
import App from './App.vue'
import router from './router'
import { applyThemeClass, resolveTheme } from '@composables/useTheme'

applyThemeClass(resolveTheme(window.vein?.initialTheme ?? 'light'))

const app = createApp(App)
app.use(createPinia())
app.use(router)
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}
app.mount('#app')
