<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';
import { ApiError, isDevHost } from '@/api/http';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

// Local development has no Cloudflare Access in front of it; the server must run with ALLOW_DEV_AUTH=true
const isDev = isDevHost();
const devEmail = ref('');
const username = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function run(action: () => Promise<void>) {
  error.value = null;
  busy.value = true;
  try {
    await action();
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/library';
    await router.replace(redirect);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Something went wrong';
  } finally {
    busy.value = false;
  }
}

function register() {
  return run(() => auth.register(username.value));
}

function signInDev() {
  return run(async () => {
    try {
      await auth.devLogin(devEmail.value);
    } catch (err) {
      // No account for this email yet: continue to registration with it
      if (err instanceof ApiError && err.status === 404) {
        auth.cfEmail = devEmail.value.trim().toLowerCase();
        throw new Error('No account for this email yet. Choose a username to create one.');
      }
      throw err;
    }
  });
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card panel">
      <h1>Music Box</h1>
      <p class="muted">Compose on a virtual piano, see it as sheet music, and keep your songs.</p>

      <form v-if="auth.needsRegistration" class="auth-form" @submit.prevent="register">
        <p>
          Signed in with Google as <strong>{{ auth.cfEmail }}</strong>. Choose a username to create your Music Box account.
        </p>
        <label class="field">
          <span>Username</span>
          <input v-model="username" autocomplete="username" minlength="2" maxlength="40" required />
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit" class="btn btn-primary wide" :disabled="busy">
          {{ busy ? 'Please wait…' : 'Create account' }}
        </button>
        <button type="button" class="btn btn-ghost wide" :disabled="busy" @click="auth.logout()">
          Use a different Google account
        </button>
      </form>

      <form v-else-if="isDev" class="auth-form" @submit.prevent="signInDev">
        <p class="muted">Development sign-in (no Cloudflare Access on localhost).</p>
        <label class="field">
          <span>Email</span>
          <input v-model="devEmail" type="email" autocomplete="email" required />
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit" class="btn btn-primary wide" :disabled="busy">
          {{ busy ? 'Please wait…' : 'Sign in' }}
        </button>
      </form>

      <div v-else class="auth-form">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="button" class="btn btn-primary wide" @click="auth.startGoogleLogin()">Continue with Google</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: calc(100vh - 120px);
  display: grid;
  place-items: center;
  padding: 24px 16px;
}
.auth-card {
  width: min(400px, 100%);
  padding: 28px;
}
h1 {
  margin: 0 0 4px;
}
.auth-form {
  display: grid;
  gap: 14px;
  margin-top: 20px;
}
.auth-form p {
  margin: 0;
}
.wide {
  width: 100%;
  padding: 11px;
}
</style>
