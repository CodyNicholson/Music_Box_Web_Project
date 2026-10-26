FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
# Dev dependencies stay installed: `npm start` runs `prisma migrate deploy`,
# and the test:db script runs vitest inside this container.
RUN npm ci --no-fund --no-audit
COPY . .
RUN npx prisma generate && npm run build
# The image's built-in unprivileged user. It owns only the /app directory itself (vitest writes a temp
# config file there for `npm run test:db`); the code and node_modules stay root-owned and read-only.
RUN chown node:node /app
USER node
EXPOSE 4000
CMD ["npm", "start"]
