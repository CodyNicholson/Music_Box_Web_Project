<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';
import { isDevHost } from '@/api/http';

const auth = useAuthStore();
const router = useRouter();

async function logout() {
  await auth.logout();
  // In production logout() navigates to the Cloudflare Access logout instead
  if (isDevHost()) router.push({ name: 'auth' });
}
</script>

<template>
  <header class="app-header">
    <RouterLink to="/library" class="brand">
      <img src="/favicon.svg" alt="" width="28" height="28" />
      <span>Music Box</span>
    </RouterLink>
    <nav v-if="auth.isAuthenticated" class="nav">
      <RouterLink to="/library">Library</RouterLink>
      <RouterLink :to="{ name: 'studio' }">New song</RouterLink>
      <span class="user muted">{{ auth.user?.username }}</span>
      <button type="button" class="btn btn-ghost small" @click="logout">Log out</button>
    </nav>
  </header>
  <main class="app-main">
    <RouterView />
  </main>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--text);
  text-decoration: none;
}
.nav {
  display: flex;
  align-items: center;
  gap: 18px;
}
.nav a {
  color: var(--muted);
  text-decoration: none;
}
.nav a.router-link-exact-active {
  color: var(--text);
}
.app-main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
}
@media (max-width: 640px) {
  .app-header,
  .app-main {
    padding-left: 16px;
    padding-right: 16px;
  }
  .user {
    display: none;
  }
}
</style>
