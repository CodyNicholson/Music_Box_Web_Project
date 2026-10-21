-- Sign-in is handled by Google OAuth through Cloudflare Access, so passwords are no longer stored.
ALTER TABLE "users" DROP COLUMN "password_hash";
