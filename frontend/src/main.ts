import { createApp } from 'vue'
import { createPinia } from 'pinia'
import AppRoot from './app/AppRoot.vue'
import { router } from './app/router'
import { i18n } from './i18n'
import './styles/main.css'

createApp(AppRoot).use(createPinia()).use(router).use(i18n).mount('#app')
