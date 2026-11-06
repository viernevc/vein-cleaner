import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import CleanerView from '../views/CleanerView.vue'
import AnalyzeView from '../views/AnalyzeView.vue'
import DuplicatesView from '../views/DuplicatesView.vue'
import SettingsView from '../views/SettingsView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { title: '概览' } },
    { path: '/clean', name: 'clean', component: CleanerView, meta: { title: '一键清理' } },
    { path: '/analyze', name: 'analyze', component: AnalyzeView, meta: { title: '空间分析' } },
    { path: '/duplicates', name: 'duplicates', component: DuplicatesView, meta: { title: '重复文件' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '设置' } }
  ]
})

export default router
