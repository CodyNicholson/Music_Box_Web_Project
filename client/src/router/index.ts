import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/login', name: 'auth', component: () => import('@/views/AuthView.vue'), meta: { guestOnly: true } },
    { path: '/library', name: 'library', component: () => import('@/views/LibraryView.vue'), meta: { requiresAuth: true } },
    {
      path: '/studio/:id?',
      name: 'studio',
      component: () => import('@/views/StudioView.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/library' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.ensureSession();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'auth', query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'library' };
  }
});

export default router;
