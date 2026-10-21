import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { isDevHost, registerSessionHandlers } from './api/http';
import { useAuthStore } from './stores/authStore';
import './assets/main.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

registerSessionHandlers({
  onSessionRefreshed: (session) => useAuthStore().applySession(session),
  onSessionExpired: () => {
    useAuthStore().clearSession();
    // In production the page reloads into the Cloudflare Access sign-in instead
    const current = router.currentRoute.value;
    if (isDevHost() && current.meta.requiresAuth) router.push({ name: 'auth', query: { redirect: current.fullPath } });
  },
});

app.mount('#app');
