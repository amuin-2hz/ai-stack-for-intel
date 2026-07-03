import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomePage.vue'),
    meta: {
      titleKey: 'dashboard',
      descKey: 'pageDashboardDesc',
    },
  },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('../views/ChatPage.vue'),
    meta: {
      titleKey: 'chat',
      descKey: 'pageChatDesc',
    },
  },
  {
    path: '/models',
    name: 'models',
    component: () => import('../views/ModelsPage.vue'),
    meta: {
      titleKey: 'models',
      descKey: 'pageModelsDesc',
    },
  },
  {
    path: '/engines',
    name: 'engines',
    component: () => import('../views/EnginesPage.vue'),
    meta: {
      titleKey: 'engines',
      descKey: 'pageEnginesDesc',
    },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsPage.vue'),
    meta: {
      titleKey: 'settings',
      descKey: 'pageSettingsDesc',
    },
  },
  {
    // Catch-all redirect
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

const router = createRouter({
  // Hash history for Electron file:// compatibility
  history: createWebHashHistory(),
  routes,
});

export default router;
