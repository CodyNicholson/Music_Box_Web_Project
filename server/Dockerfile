FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
# Dev dependencies stay installed: `npm start` runs `prisma migrate deploy`,
# and the test:db script runs vitest inside this container.
RUN npm ci --no-fund --no-audit
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 4000
CMD ["npm", "start"]
